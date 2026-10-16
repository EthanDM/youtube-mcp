import AppKit
import ApplicationServices
import Foundation

// Replace AX reads/actions at the operating-system boundary. The production reader
// runs unchanged, but these tests cannot inspect or close any real browser window.
var attributes: [CFHashCode: [String: CFTypeRef]] = [:]
var closeActions: [AXUIElement] = []

@discardableResult
func AXUIElementCopyAttributeValue(_ element: AXUIElement, _ name: CFString,
                                   _ output: UnsafeMutablePointer<CFTypeRef?>) -> AXError {
    output.pointee = attributes[CFHash(element)]?[name as String]
    return output.pointee == nil ? .noValue : .success
}

@discardableResult
func AXUIElementPerformAction(_ element: AXUIElement, _ action: CFString) -> AXError {
    precondition(action as String == kAXPressAction)
    closeActions.append(element)
    return .success
}

let window = AXUIElementCreateApplication(2_000_001)
let group = AXUIElementCreateApplication(2_000_002)
let originalTab = AXUIElementCreateApplication(2_000_003)
let addedTab = AXUIElementCreateApplication(2_000_004)
let address = AXUIElementCreateApplication(2_000_005)
let closeButton = AXUIElementCreateApplication(2_000_006)
let requestedURL = "https://www.youtube.com/watch?v=LfGenpmOjDQ"

func configure(tabs: [AXUIElement]?, url: String) {
    closeActions = []
    attributes = [
        CFHash(window): [kAXChildrenAttribute: [group, address] as NSArray,
                         kAXCloseButtonAttribute: closeButton],
        CFHash(group): [kAXRoleAttribute: kAXTabGroupRole as CFString,
                        kAXChildrenAttribute: (tabs ?? []) as NSArray],
        CFHash(address): [kAXRoleAttribute: "AXComboBox" as CFString,
                          kAXValueAttribute: url as CFString],
    ]
    if let tabs { attributes[CFHash(group)]?["AXTabs"] = tabs as NSArray }
}

let cases: [(String, [AXUIElement]?, String, Bool, Bool)] = [
    ("unchanged", [originalTab], requestedURL, true, false),
    ("added-tab", [originalTab, addedTab], requestedURL, false, false),
    ("replacement-tab", [addedTab], requestedURL, false, false),
    ("changed-navigation", [originalTab], "https://example.com/", false, false),
    ("unreadable-tabs", nil, requestedURL, false, false),
    ("missing-identity", [originalTab], requestedURL, false, false),
    ("cancelled-request", [originalTab], requestedURL, false, true),
]
var passed: [String] = []
for (name, tabs, url, shouldClose, cancelled) in cases {
    configure(tabs: tabs, url: url)
    let cancellation = Cancellation()
    if cancelled { cancellation.cancel() }
    let reader = FirefoxTranscriptReader(pid: 2_000_001, url: URL(string: requestedURL)!,
                                         videoId: "LfGenpmOjDQ", cancellation: cancellation)
    reader.closeRequestWindowIfUnchanged(window, requestTab: name == "missing-identity" ? nil : originalTab)
    precondition(closeActions.count == (shouldClose ? 1 : 0), "Unexpected close action: \(name)")
    if shouldClose { precondition(CFEqual(closeActions[0], closeButton)) }
    passed.append(name)
}
print(String(data: try JSONSerialization.data(withJSONObject: ["passed": passed]), encoding: .utf8)!)
