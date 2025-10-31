# Chrome Setup Guide for bdg

## Quick Setup

### Linux
```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-bdg \
  --no-first-run \
  --no-default-browser-check
```

### macOS
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-bdg \
  --no-first-run \
  --no-default-browser-check
```

### Windows
```powershell
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir=C:\temp\chrome-bdg ^
  --no-first-run ^
  --no-default-browser-check
```

## Chrome 136+ Requirements

Starting with Chrome 136 (May 2025), the `--user-data-dir` flag is **required** when using `--remote-debugging-port`. This is a security enhancement to protect your default Chrome profile.

### Why This Changed

Chrome 136 introduced a security restriction: you can no longer enable remote debugging on your default user profile. You must specify a separate profile directory.

### What Happens Without --user-data-dir

❌ **This no longer works in Chrome 136+:**
```bash
chrome --remote-debugging-port=9222
```

You'll get errors like:
- "DevToolsActivePort file doesn't exist"
- "Cannot connect to Chrome on port 9222"
- Chrome will ignore the debugging flag

✅ **This is required:**
```bash
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-bdg
```

## Understanding Chrome Flags

### Required Flags

**`--remote-debugging-port=9222`**
- Enables Chrome DevTools Protocol
- Opens WebSocket endpoint on port 9222
- Required for bdg to connect

**`--user-data-dir=/tmp/chrome-bdg`** (Chrome 136+)
- Specifies a separate profile directory
- Protects your main Chrome profile
- Can be any writable directory path

### Recommended Flags

**`--no-first-run`**
- Skips "Welcome to Chrome" dialog
- Skips first-run setup wizards
- Prevents sign-in prompts

**`--no-default-browser-check`**
- Stops "Set Chrome as default" prompts
- Cleaner automation experience

**`--disable-search-engine-choice-screen`**
- Disables search engine selection screen (EU requirement)
- Prevents modal blocking automation

**`--ash-no-nudges`** (optional)
- Disables "user education" bubbles
- Prevents UI hints from appearing

**`--disable-sync`** (optional)
- Disables Chrome Sync
- Good for temporary profiles

## Profile Management

### Temporary Profiles

Use `/tmp` or equivalent for one-time usage:

```bash
# Linux/Mac - cleaned up on reboot
--user-data-dir=/tmp/chrome-bdg-$(date +%s)

# Windows - manual cleanup needed
--user-data-dir=C:\temp\chrome-bdg-%RANDOM%
```

### Persistent Profiles

Use a fixed location for reusable profiles:

```bash
# Linux/Mac
--user-data-dir=~/.bdg/chrome-profile

# Windows
--user-data-dir=%USERPROFILE%\.bdg\chrome-profile
```

**Benefits:**
- Login state persists
- Extensions remain installed
- Settings are remembered

**Drawbacks:**
- Takes disk space
- Can accumulate cache
- May need manual cleanup

## Port Configuration

### Default Port (9222)

Most tools use 9222 by default. This is the standard CDP port.

### Custom Port

If port 9222 is already in use:

```bash
chrome --remote-debugging-port=9223 --user-data-dir=/tmp/chrome-bdg
bdg localhost:3000 --port 9223
```

### Finding Used Ports

**Linux/Mac:**
```bash
lsof -i :9222
```

**Windows:**
```powershell
netstat -ano | findstr :9222
```

## Multiple Chrome Instances

You can run multiple Chrome instances with different ports and profiles:

```bash
# Instance 1
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-1 &

# Instance 2
chrome --remote-debugging-port=9223 --user-data-dir=/tmp/chrome-2 &
```

**Important:** Each instance MUST have:
- Unique port
- Unique user-data-dir

## Troubleshooting

### "Port already in use"

**Check what's using the port:**
```bash
# Linux/Mac
lsof -i :9222

# Windows
netstat -ano | findstr :9222
```

**Solutions:**
1. Close other Chrome instances
2. Use a different port: `--remote-debugging-port=9223`
3. Kill the process using the port

### "DevToolsActivePort file doesn't exist"

**Cause:** Chrome 136+ security requirement

**Solution:** Add `--user-data-dir`:
```bash
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-bdg
```

### "Profile is locked"

**Cause:** Another Chrome instance is using the same profile

**Solutions:**
1. Close all Chrome windows
2. Use a different `--user-data-dir`
3. Kill Chrome processes: `pkill chrome` (Linux/Mac)

### Permission Denied on user-data-dir

**Cause:** Directory not writable

**Solutions:**
```bash
# Create directory with proper permissions
mkdir -p /tmp/chrome-bdg
chmod 755 /tmp/chrome-bdg

# Or use your home directory
--user-data-dir=~/chrome-bdg-profile
```

## Automated Setup Scripts

### Linux/Mac Shell Script

```bash
#!/bin/bash
# save as: launch-chrome-debug.sh

CHROME_BIN="google-chrome"  # or "chromium-browser"
PORT=9222
PROFILE_DIR="/tmp/chrome-bdg"

# Kill existing instances
pkill -f "$CHROME_BIN.*remote-debugging-port=$PORT"

# Launch Chrome
$CHROME_BIN \
  --remote-debugging-port=$PORT \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --disable-search-engine-choice-screen \
  > /dev/null 2>&1 &

echo "Chrome started with debugging on port $PORT"
echo "Profile: $PROFILE_DIR"
```

### Windows Batch Script

```batch
@echo off
REM save as: launch-chrome-debug.bat

set CHROME_BIN="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PORT=9222
set PROFILE_DIR=C:\temp\chrome-bdg

REM Kill existing instances
taskkill /F /IM chrome.exe /T >nul 2>&1

REM Launch Chrome
start "" %CHROME_BIN% ^
  --remote-debugging-port=%PORT% ^
  --user-data-dir=%PROFILE_DIR% ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-search-engine-choice-screen

echo Chrome started with debugging on port %PORT%
echo Profile: %PROFILE_DIR%
```

## Verifying Setup

### Check Chrome is listening

```bash
curl http://localhost:9222/json/version
```

**Expected output:**
```json
{
  "Browser": "Chrome/136.0.0.0",
  "Protocol-Version": "1.3",
  "webSocketDebuggerUrl": "ws://localhost:9222/devtools/browser/..."
}
```

### List available tabs

```bash
curl http://localhost:9222/json
```

### Test with bdg

```bash
# Open a tab in Chrome first
bdg localhost:3000
```

## Security Considerations

### Network Exposure

Remote debugging should ONLY be exposed on localhost (127.0.0.1). Never expose it to external networks.

❌ **Dangerous:**
```bash
chrome --remote-debugging-port=0.0.0.0:9222  # Exposed to network!
```

✅ **Safe:**
```bash
chrome --remote-debugging-port=9222  # Localhost only
```

### Profile Isolation

Use separate profiles for automation to avoid exposing your main profile:

- Main profile: Your personal Chrome with logins, passwords, history
- Debug profile: Temporary profile for testing/automation

### Cleanup

Remove temporary profiles after use:

```bash
rm -rf /tmp/chrome-bdg
```

## References

- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Chrome Command Line Switches](https://peter.sh/experiments/chromium-command-line-switches/)
- [Chrome 136+ Security Changes](https://developer.chrome.com/blog/remote-debugging-port)
