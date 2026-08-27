# Persistent ChatGPT Tunnel on macOS

Use this optional setup when you want ChatGPT to reach this local MCP whenever your Mac is logged in, awake, and online. It keeps the server private: `tunnel-client` makes an outbound connection to OpenAI and starts the built stdio server locally.

This is for a private developer-mode connection, not public plugin distribution. See the current [OpenAI Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) for Platform permissions, tunnel creation, and ChatGPT connection steps.

## Prerequisites

- Build this repository with `pnpm build`.
- Install the current `tunnel-client` binary from OpenAI.
- Create an OpenAI tunnel, associate it with the ChatGPT workspace that will use it, and create a runtime API key with **Tunnels Read + Use**.
- Configure a local stdio profile that starts this server. The official guide shows the base `tunnel-client init` flow.

Do not store the runtime key in this repository, `.env`, a shell startup file, or a LaunchAgent plist.

## Store the runtime key locally

Keep the key in a private file that the tunnel profile references. The profile contains only a `file:` reference, never the literal key.

```zsh
umask 077
mkdir -p "$HOME/.config/tunnel-client/credentials"
chmod 700 "$HOME/.config/tunnel-client/credentials"
read -rs "CONTROL_PLANE_API_KEY?Paste the OpenAI tunnel runtime key: "
printf "\n"
printf '%s' "$CONTROL_PLANE_API_KEY" \
  > "$HOME/.config/tunnel-client/credentials/youtube-mcp-runtime-api-key"
chmod 600 "$HOME/.config/tunnel-client/credentials/youtube-mcp-runtime-api-key"
unset CONTROL_PLANE_API_KEY
```

Use a descriptive local profile name such as `youtube-mcp`. Its control-plane configuration should look like this, replacing `YOUR_USERNAME` with your macOS account name:

```yaml
control_plane:
  tunnel_id: tunnel_...
  api_key: file:/Users/YOUR_USERNAME/.config/tunnel-client/credentials/youtube-mcp-runtime-api-key
```

Run the profile diagnostic before installing a service:

```zsh
tunnel-client doctor --profile youtube-mcp --explain
```

## Start it automatically after login

Create `~/Library/LaunchAgents/com.example.youtube-mcp-tunnel.plist`. Replace `YOUR_USERNAME` and the `tunnel-client` path with your local paths. Add the directory containing Node to `PATH`; Homebrew installations commonly use `/opt/homebrew/bin`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.example.youtube-mcp-tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/YOUR_USERNAME/bin/tunnel-client</string>
    <string>run</string>
    <string>--profile-dir</string>
    <string>/Users/YOUR_USERNAME/.config/tunnel-client</string>
    <string>--profile</string>
    <string>youtube-mcp</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/Users/YOUR_USERNAME/Library/Logs/youtube-mcp-tunnel.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOUR_USERNAME/Library/Logs/youtube-mcp-tunnel-error.log</string>
</dict>
</plist>
```

Load it for the current login session:

```zsh
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.example.youtube-mcp-tunnel.plist"
launchctl kickstart -k "gui/$(id -u)/com.example.youtube-mcp-tunnel"
```

The LaunchAgent starts after login and restarts the client when it exits. It does not keep the Mac awake or make the MCP available while the Mac is powered off or asleep.

## Verify and troubleshoot

```zsh
tunnel-client doctor --profile youtube-mcp --explain
launchctl print "gui/$(id -u)/com.example.youtube-mcp-tunnel"
tail -f "$HOME/Library/Logs/youtube-mcp-tunnel-error.log"
```

The tunnel client also exposes loopback-only `/healthz`, `/readyz`, and `/ui` endpoints while it is running. In ChatGPT, create a developer-mode app with **Tunnel** as the connection type, then select the associated tunnel.
