import AppKit
import ApplicationServices
import Foundation

struct NativeFailure: Error {
    let code: String
}

// SIGTERM requests cooperative cleanup so a timed-out MCP call does not leave its window open.
final class Cancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var stopped = false
    func cancel() { lock.lock(); stopped = true; lock.unlock() }
    var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return value
}

func labels(_ element: AXUIElement) -> [String] {
    [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute]
        .compactMap { attribute(element, $0) as? String }
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
}

func frame(_ element: AXUIElement) -> CGRect? {
    guard let origin = attribute(element, kAXPositionAttribute),
          let dimensions = attribute(element, kAXSizeAttribute),
          CFGetTypeID(origin) == AXValueGetTypeID(),
          CFGetTypeID(dimensions) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(origin as! AXValue, .cgPoint, &point),
          AXValueGetValue(dimensions as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}

func button(_ nodes: [AXUIElement], named name: String) -> AXUIElement? {
    nodes.first { attribute($0, kAXRoleAttribute) as? String == kAXButtonRole && labels($0).contains(name) }
}

// Refresh AppKit's foreground cache before each input guard. The system-wide AX
// focused-application query can fail even when application-level AX access works.
func focusedProcess() -> pid_t? {
    RunLoop.current.run(until: Date().addingTimeInterval(0.01))
    return NSWorkspace.shared.frontmostApplication?.processIdentifier
}

struct CaptionRow: Codable, Equatable {
    let timestamp: String
    let text: String
}

struct NativeTranscript: Encodable {
    let videoId: String
    let selectedLanguage: String
    let rows: [CaptionRow]
}

/** Reuse a matching dedicated-profile tab; otherwise own one new request window. */
final class FirefoxTranscriptReader {
    let pid: pid_t
    let root: AXUIElement
    let url: URL
    let videoId: String
    let cancellation: Cancellation
    let started = Date()
    let deadline = Date().addingTimeInterval(60)
    var stage = "native_window" { didSet { if stage != oldValue { logStage() } } }
    var observedRows = 0
    var selectedLanguageSeen = false
    var panelFound = false
    private var window: AXUIElement?

    func logStage() {
        let fields: [String: Any] = ["event": "youtube_native_firefox_stage", "videoId": videoId, "stage": stage,
                                     "durationMs": Int(Date().timeIntervalSince(started) * 1000), "observedRows": observedRows,
                                     "selectedLanguageSeen": selectedLanguageSeen]
        if let data = try? JSONSerialization.data(withJSONObject: fields) { FileHandle.standardError.write(data + Data([10])) }
    }

    init(pid: pid_t, url: URL, videoId: String, cancellation: Cancellation) {
        self.pid = pid
        self.root = AXUIElementCreateApplication(pid)
        self.url = url
        self.videoId = videoId
        self.cancellation = cancellation
        AXUIElementSetMessagingTimeout(root, 1)
    }

    func checkDeadline() throws {
        if cancellation.isCancelled { throw NativeFailure(code: "cancelled") }
        if Date() >= deadline { throw NativeFailure(code: "timeout") }
    }

    // A bounded walk includes offscreen rows, rather than exporting only the visible viewport.
    func tree(_ element: AXUIElement) throws -> [AXUIElement] {
        var result = [AXUIElement]()
        func visit(_ current: AXUIElement, depth: Int) throws {
            try checkDeadline()
            guard depth <= 50, result.count < 40_000 else { throw NativeFailure(code: "tree_limit") }
            result.append(current)
            for child in attribute(current, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
                try visit(child, depth: depth + 1)
            }
        }
        try visit(element, depth: 0)
        return result
    }

    func requireFocus() throws {
        try checkDeadline()
        guard focusedProcess() == pid else {
            throw NativeFailure(code: "focus_lost")
        }
        if let window {
            guard let focused = attribute(root, kAXFocusedWindowAttribute),
                  CFEqual(focused, window) else { throw NativeFailure(code: "window_focus_lost") }
        }
    }

    func key(_ code: CGKeyCode, flags: CGEventFlags = []) throws {
        try requireFocus()
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
            event?.flags = flags
            event?.post(tap: .cghidEventTap)
            Thread.sleep(forTimeInterval: 0.05)
        }
    }

    // Hit-testing prevents a stale rectangle or an overlapping window from receiving a click.
    @discardableResult
    func checkHit(_ point: CGPoint, target: AXUIElement? = nil) throws -> Bool {
        try requireFocus()
        var hit: AXUIElement?
        guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &hit) == .success,
              let hit else { throw NativeFailure(code: "target_obscured") }
        var hitPid: pid_t = 0
        AXUIElementGetPid(hit, &hitPid)
        guard hitPid == pid else { throw NativeFailure(code: "target_obscured") }
        var ancestor = hit
        var targetFound = target == nil
        for _ in 0..<50 {
            if let target, CFEqual(ancestor, target) { targetFound = true }
            if let window, CFEqual(ancestor, window) { return targetFound }
            guard let parent = attribute(ancestor, kAXParentAttribute) else { break }
            ancestor = parent as! AXUIElement
        }
        throw NativeFailure(code: "target_obscured")
    }

    func click(_ element: AXUIElement) throws {
        guard let bounds = frame(element), bounds.width > 0, bounds.height > 0 else {
            throw NativeFailure(code: "target_missing")
        }
        let point = CGPoint(x: bounds.midX, y: bounds.midY)
        guard try checkHit(point, target: element) else { throw NativeFailure(code: "target_obscured") }
        for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
            let event = CGEvent(mouseEventSource: CGEventSource(stateID: .hidSystemState), mouseType: type,
                                mouseCursorPosition: point, mouseButton: .left)
            if type != .mouseMoved {
                event?.setIntegerValueField(.mouseEventClickState, value: 1)
                event?.setDoubleValueField(.mouseEventPressure, value: type == .leftMouseDown ? 1 : 0)
            }
            event?.post(tap: .cghidEventTap)
            Thread.sleep(forTimeInterval: 0.08)
        }
    }

    /** Returns false after scrolling; the caller must re-find the target before clicking. */
    func revealAndClick(_ element: AXUIElement) throws -> Bool {
        guard let window, let bounds = frame(window), let target = frame(element) else {
            throw NativeFailure(code: "target_missing")
        }
        let center = CGPoint(x: target.midX, y: target.midY)
        if target.midY > bounds.minY + 100 && target.midY < bounds.maxY - 30,
           try checkHit(center, target: element) {
            try click(element)
            return true
        }
        let point = CGPoint(x: bounds.midX, y: bounds.midY)
        try checkHit(point)
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        let distance = Int32(max(-600, min(600, bounds.midY - target.midY)))
        CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1,
                wheel1: distance, wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
        return false
    }

    // For LfGenpmOjDQ, four fresh-page trials succeeded with this preparation;
    // the matched delay without pointer movement failed. This is not a guarantee
    // about YouTube's verification rules, and the original 60-second deadline applies.
    func prepareTranscriptClick(_ window: AXUIElement) throws {
        guard let bounds = frame(window) else { throw NativeFailure(code: "target_missing") }
        let points = [CGPoint(x: bounds.minX + bounds.width * 0.30, y: bounds.minY + bounds.height * 0.40),
                      CGPoint(x: bounds.minX + bounds.width * 0.60, y: bounds.minY + bounds.height * 0.40),
                      CGPoint(x: bounds.minX + bounds.width * 0.60, y: bounds.minY + bounds.height * 0.65),
                      CGPoint(x: bounds.minX + bounds.width * 0.30, y: bounds.minY + bounds.height * 0.65),
                      CGPoint(x: bounds.minX + bounds.width * 0.30, y: bounds.minY + bounds.height * 0.40)]
        for index in 0..<4 {
            for step in 1...8 {
                let fraction = CGFloat(step) / 8
                let point = CGPoint(x: points[index].x + (points[index + 1].x - points[index].x) * fraction,
                                    y: points[index].y + (points[index + 1].y - points[index].y) * fraction)
                try checkHit(point)
                CGEvent(mouseEventSource: CGEventSource(stateID: .hidSystemState), mouseType: .mouseMoved,
                        mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
                Thread.sleep(forTimeInterval: 0.25)
            }
        }
        let settleUntil = Date().addingTimeInterval(28)
        while Date() < settleUntil {
            try requireFocus()
            Thread.sleep(forTimeInterval: 0.1)
        }
    }

    func read() throws -> NativeTranscript {
        guard AXIsProcessTrusted() else { throw NativeFailure(code: "accessibility_required") }
        guard let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier == "org.mozilla.firefox" else {
            throw NativeFailure(code: "browser_missing")
        }
        let previousApp = NSWorkspace.shared.frontmostApplication
        let existing = attribute(root, kAXWindowsAttribute) as? [AXUIElement] ?? []
        app.activate(options: [.activateAllWindows])
        let activationDeadline = Date().addingTimeInterval(3)
        while focusedProcess() != pid && Date() < activationDeadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        AXUIElementSetAttributeValue(root, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        // Preserve the loaded page's browser context when the requested video is already open.
        window = try existing.first { candidate in
            guard (frame(candidate)?.height ?? 0) > 100 else { return false }
            return try hasRequestedVideo(candidate)
        }
        let ownsWindow = window == nil
        var requestTab: AXUIElement?
        if ownsWindow { try key(45, flags: .maskCommand) }
        defer {
            let restoreFocus = focusedProcess() == pid && window.map { own in
                attribute(root, kAXFocusedWindowAttribute).map { CFEqual($0, own) } ?? false
            } == true
            if ownsWindow, let window { closeRequestWindowIfUnchanged(window, requestTab: requestTab) }
            if restoreFocus { previousApp?.activate() }
        }
        let windowDeadline = Date().addingTimeInterval(5)
        while window == nil && Date() < windowDeadline {
            try checkDeadline()
            let created = (attribute(root, kAXWindowsAttribute) as? [AXUIElement] ?? []).filter { candidate in
                !existing.contains { CFEqual(candidate, $0) }
            }
            guard created.count <= 1 else { throw NativeFailure(code: "window_ambiguous") }
            window = created.first
            Thread.sleep(forTimeInterval: 0.1)
        }
        guard let window else { throw NativeFailure(code: "window_missing") }
        AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        Thread.sleep(forTimeInterval: 0.5)
        try requireFocus()
        if ownsWindow {
            requestTab = try singleBrowserTab(window)
            guard let address = try tree(window).first(where: { attribute($0, kAXRoleAttribute) as? String == "AXComboBox" }) else {
                throw NativeFailure(code: "navigation_failed")
            }
            AXUIElementSetAttributeValue(address, kAXFocusedAttribute as CFString, kCFBooleanTrue)
            guard AXUIElementSetAttributeValue(address, kAXValueAttribute as CFString, url.absoluteString as CFString) == .success else {
                throw NativeFailure(code: "navigation_failed")
            }
            Thread.sleep(forTimeInterval: 0.1)
            try key(36)
        }
        stage = "native_page"
        var expanded = button(try tree(window), named: "Show transcript") != nil
        var pointerPrepared = false
        var opened = false
        var openedAt = Date.distantFuture
        var retried = false
        var previousRows = [CaptionRow]()
        while true {
            try requireFocus()
            AXUIElementSetAttributeValue(root, "AXManualAccessibility" as CFString, kCFBooleanTrue)
            let nodes = try tree(window)
            let buttons = nodes.filter { attribute($0, kAXRoleAttribute) as? String == kAXButtonRole }
            let previousCount = observedRows
            observedRows = buttons.filter { labels($0).contains { $0.range(of: "^[0-9]+ (hours?|minutes?|seconds?)\\b", options: .regularExpression) != nil } }.count
            selectedLanguageSeen = buttons.flatMap(labels).contains { $0 == "English" || $0 == "English (auto-generated)" }
            if previousCount != observedRows { logStage() }
            // Refuse redirects or a user navigation before interacting with page controls.
            guard try hasRequestedVideo(window) else {
                throw NativeFailure(code: "navigation_changed")
            }
            if let close = button(nodes, named: "Close transcript"), let result = try transcriptPanel(close) {
                panelFound = true
                if !result.rows.isEmpty {
                    if result.rows == previousRows { return result }
                    previousRows = result.rows
                    Thread.sleep(forTimeInterval: 0.35)
                    continue
                }
            }
            // One native reopen reproduced recovery from an initially empty panel for LfGenpmOjDQ.
            if opened && observedRows == 0 && !retried && Date().timeIntervalSince(openedAt) > 5,
               let close = button(nodes, named: "Close transcript"), try revealAndClick(close) {
                opened = false
                retried = true
                previousRows = []
                continue
            }
            if !expanded {
                stage = "native_description"
                if let more = button(nodes, named: "more"), try revealAndClick(more) { expanded = true }
            } else if !opened {
                stage = "native_transcript_open"
                if let show = button(nodes, named: "Show transcript") {
                    if !pointerPrepared {
                        stage = "native_pointer_prepare"
                        try prepareTranscriptClick(window)
                        pointerPrepared = true
                        continue // Re-find the control after pointer movement and settling.
                    }
                    if try revealAndClick(show) {
                        opened = true
                        openedAt = Date()
                    }
                }
            } else { stage = "native_transcript_rows" }
            Thread.sleep(forTimeInterval: 0.35)
        }
    }

    // Only call for a request-created window. User-added tabs, a replacement tab,
    // changed navigation, or unreadable/expired state must leave the window open.
    func closeRequestWindowIfUnchanged(_ candidate: AXUIElement, requestTab: AXUIElement?) {
        guard let requestTab, let currentTab = try? singleBrowserTab(candidate),
              CFEqual(currentTab, requestTab), (try? hasRequestedVideo(candidate)) == true,
              let close = attribute(candidate, kAXCloseButtonAttribute) else { return }
        AXUIElementPerformAction(close as! AXUIElement, kAXPressAction as CFString)
    }

    // AXTabs excludes the tab strip's New Tab button; missing or ambiguous state
    // must leave the window open. The request deadline also bounds cleanup reads.
    func singleBrowserTab(_ candidate: AXUIElement) throws -> AXUIElement? {
        let groups = try tree(candidate).filter { attribute($0, kAXRoleAttribute) as? String == kAXTabGroupRole }
        guard groups.count == 1,
              let tabs = attribute(groups[0], "AXTabs") as? [AXUIElement], tabs.count == 1 else { return nil }
        return tabs[0]
    }

    func hasRequestedVideo(_ candidate: AXUIElement) throws -> Bool {
        let address = try tree(candidate).first { attribute($0, kAXRoleAttribute) as? String == "AXComboBox" }
            .flatMap { attribute($0, kAXValueAttribute) as? String } ?? ""
        let actual = URLComponents(string: address.hasPrefix("https://") ? address : "https://" + address)
        return actual?.host == "www.youtube.com" && actual?.path == "/watch" &&
            actual?.queryItems?.first(where: { $0.name == "v" })?.value == videoId
    }

    // Anchor to the transcript panel so comment and chapter buttons cannot become caption rows.
    func transcriptPanel(_ closeButton: AXUIElement) throws -> NativeTranscript? {
        guard let window, let ancestors = try path(to: closeButton, in: window) else { return nil }
        for ancestor in ancestors.reversed() {
            let nodes = try tree(ancestor)
            let buttons = nodes.filter { attribute($0, kAXRoleAttribute) as? String == kAXButtonRole }
            let selected = buttons.flatMap(labels).filter { $0 == "English" || $0 == "English (auto-generated)" }
            if Set(selected).count == 1 {
                let rawRows = buttons.compactMap { labels($0).first { $0.range(of: "^[0-9]+ (hours?|minutes?|seconds?)\\b", options: .regularExpression) != nil } }
                guard rawRows.count <= 20_000 else { throw NativeFailure(code: "row_limit") }
                let rows = try rawRows.map(parseCaptionRow)
                return NativeTranscript(videoId: videoId, selectedLanguage: selected[0], rows: rows)
            }
        }
        return nil
    }

    // Firefox can omit AXParent for web elements; derive the path from its authoritative child tree.
    func path(to target: AXUIElement, in element: AXUIElement, depth: Int = 0) throws -> [AXUIElement]? {
        try checkDeadline()
        guard depth <= 50 else { throw NativeFailure(code: "tree_limit") }
        if CFEqual(element, target) { return [element] }
        for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
            if let descendants = try path(to: target, in: child, depth: depth + 1) { return [element] + descendants }
        }
        return nil
    }
}

/** Firefox exposes timestamps as English accessibility names, including hour-long videos. */
func parseCaptionRow(_ label: String) throws -> CaptionRow {
    let pattern = try NSRegularExpression(pattern: "^((?:[0-9]+ (?:hours?|minutes?|seconds?)(?:, )?)+) (.+)$", options: [.dotMatchesLineSeparators])
    let range = NSRange(label.startIndex..., in: label)
    guard let match = pattern.firstMatch(in: label, range: range),
          let timeRange = Range(match.range(at: 1), in: label), let textRange = Range(match.range(at: 2), in: label) else {
        throw NativeFailure(code: "row_invalid")
    }
    let time = String(label[timeRange])
    let units = try NSRegularExpression(pattern: "([0-9]+) (hour|minute|second)s?")
    var seconds = 0
    for unit in units.matches(in: time, range: NSRange(time.startIndex..., in: time)) {
        guard let number = Range(unit.range(at: 1), in: time), let kind = Range(unit.range(at: 2), in: time),
              let value = Int(time[number]) else { throw NativeFailure(code: "row_invalid") }
        seconds += value * (time[kind] == "hour" ? 3600 : time[kind] == "minute" ? 60 : 1)
    }
    return CaptionRow(timestamp: String(format: "%d:%02d", seconds / 60, seconds % 60), text: String(label[textRange]))
}

#if !NATIVE_CLEANUP_TESTS
let cancellation = Cancellation()
signal(SIGTERM, SIG_IGN)
let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
termination.setEventHandler { cancellation.cancel() }
termination.resume()
var reader: FirefoxTranscriptReader?
do {
    let args = CommandLine.arguments
    guard args.count == 3, let pid = Int32(args[1]), pid > 0, let url = URL(string: args[2]),
          let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), parts.scheme == "https",
          parts.host == "www.youtube.com", parts.path == "/watch", parts.queryItems?.count == 1,
          let videoId = parts.queryItems?.first?.value, parts.queryItems?.first?.name == "v",
          videoId.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else {
        throw NativeFailure(code: "input_invalid")
    }
    // Native input is a desktop-wide resource, including across separate MCP processes.
    let lockPath = FileManager.default.temporaryDirectory.appendingPathComponent("youtube-mcp-native-firefox.lock").path
    let lock = open(lockPath, O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    guard lock >= 0 else { throw NativeFailure(code: "busy") }
    defer { close(lock) }
    guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { throw NativeFailure(code: "busy") }
    let activeReader = FirefoxTranscriptReader(pid: pid, url: url, videoId: videoId, cancellation: cancellation)
    reader = activeReader
    let result = try activeReader.read()
    FileHandle.standardOutput.write(try JSONEncoder().encode(result))
} catch {
    // Only fixed error codes leave the helper; raw OS errors can contain private paths.
    let failure: [String: Any] = ["error": ["code": (error as? NativeFailure)?.code ?? "native_error", "stage": reader?.stage ?? "native_setup", "observedRows": reader?.observedRows ?? 0, "selectedLanguageSeen": reader?.selectedLanguageSeen ?? false, "panelFound": reader?.panelFound ?? false]]
    if let data = try? JSONSerialization.data(withJSONObject: failure) { FileHandle.standardOutput.write(data) }
}

#endif
