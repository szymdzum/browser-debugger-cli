# Exit Codes Reference

**bdg** uses semantic exit codes based on [Square's exit code system](https://developer.squareup.com/blog/command-line-observability-with-semantic-exit-codes/) for agent-friendly error handling.

## Exit Code Ranges

| Range | Category | Description |
|-------|----------|-------------|
| 0 | Success | Operation completed successfully |
| 1 | Generic failure | Backward compatibility (avoid using) |
| 80-99 | User errors | Invalid input, permissions, resource issues |
| 100-119 | Software errors | Bugs, integration failures, timeouts |

## User Errors (80-99)

Errors caused by invalid user input, missing resources, or permission issues.

### 80: INVALID_URL
**Cause**: Malformed or invalid URL provided
```bash
bdg not-a-url
# Exit code: 80
# Error: Invalid URL format
```

**Fix**: Provide a valid URL with protocol
```bash
bdg https://example.com
```

---

### 81: INVALID_ARGUMENTS
**Cause**: Invalid command-line arguments or parameters
```bash
bdg cdp Runtime.evaluate --params 'not-valid-json'
# Exit code: 81
# Error: Error parsing --params: Invalid JSON
```

**Fix**: Ensure arguments match expected format
```bash
bdg cdp Runtime.evaluate --params '{"expression":"document.title","returnByValue":true}'
```

---

### 82: PERMISSION_DENIED
**Cause**: Insufficient permissions to perform operation
```bash
bdg page screenshot /root/screenshot.png
# Exit code: 82
# Error: Permission denied: Cannot write to /root/
```

**Fix**: Use a writable directory
```bash
bdg page screenshot ~/screenshots/page.png
```

---

### 83: RESOURCE_NOT_FOUND
**Cause**: Requested resource does not exist
```bash
bdg dom wait "#nonexistent-element" --timeout 5
# Exit code: 83
# Error: Element not found after 5s
```

**Fix**: Verify selector or increase timeout
```bash
bdg dom wait "#actual-element" --timeout 15
```

---

### 84: RESOURCE_ALREADY_EXISTS
**Cause**: Resource already exists (e.g., session, file)
```bash
bdg https://example.com
# If session already running:
# Exit code: 84
# Error: Session already running
```

**Fix**: Stop existing session first
```bash
bdg stop && bdg https://example.com
```

---

### 85: RESOURCE_BUSY
**Cause**: Resource is currently in use
```bash
bdg https://example.com --port 9222
# If port already in use:
# Exit code: 85
# Error: Port 9222 is busy
```

**Fix**: Use a different port or stop conflicting process
```bash
bdg https://example.com --port 9223
```

---

### 86: DAEMON_ALREADY_RUNNING
**Cause**: Daemon process is already running
```bash
# Internal error - should not occur in normal usage
```

**Fix**: Clean up stale daemon
```bash
bdg cleanup --force
```

---

## Software Errors (100-119)

Errors caused by software bugs, integration failures, or system issues.

### 100: CHROME_LAUNCH_FAILURE
**Cause**: Failed to launch Chrome browser
```bash
bdg https://example.com
# Exit code: 100
# Error: Chrome launch failed
```

**Common causes**:
- Chrome not installed
- Chrome binary not found
- Insufficient system resources

**Fix**: Install Chrome or specify custom path
```bash
# macOS
brew install --cask google-chrome

# Or specify custom Chrome path
export CHROME_PATH=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
bdg https://example.com
```

---

### 101: CDP_CONNECTION_FAILURE
**Cause**: Failed to connect to Chrome DevTools Protocol
```bash
bdg https://example.com
# Exit code: 101
# Error: CDP connection failed
```

**Common causes**:
- Chrome crashed during startup
- WebSocket connection rejected
- Firewall blocking local connection

**Fix**: Retry or use different port
```bash
bdg https://example.com --port 9223
```

---

### 102: CDP_TIMEOUT
**Cause**: CDP operation exceeded timeout
```bash
bdg dom wait "#slow-element" --timeout 5
# Exit code: 102
# Error: CDP operation timeout
```

**Fix**: Increase timeout or check network
```bash
bdg dom wait "#slow-element" --timeout 30
```

---

### 103: SESSION_FILE_ERROR
**Cause**: Failed to read/write session files
```bash
# Session file I/O error
# Exit code: 103
```

**Common causes**:
- Disk full
- Permission denied on `~/.bdg/`
- Corrupted session files

**Fix**: Check disk space and permissions
```bash
df -h  # Check disk space
ls -la ~/.bdg/  # Check permissions
bdg cleanup --force  # Clean stale files
```

---

### 104: UNHANDLED_EXCEPTION
**Cause**: Unexpected error in worker process
```bash
# Internal error - indicates a bug
# Exit code: 104
```

**Fix**: Report issue with logs
```bash
bdg status --verbose  # Capture state
# Report at: https://github.com/anthropics/browser-debugger-cli/issues
```

---

### 105: SIGNAL_HANDLER_ERROR
**Cause**: Error in signal handler (SIGTERM, SIGINT)
```bash
# Internal error - indicates a bug
# Exit code: 105
```

**Fix**: Clean up and retry
```bash
bdg cleanup --aggressive
```

---

## Command-Specific Exit Codes

### DOM Wait (`bdg dom wait <selector>`)

| Code | Meaning | Fix |
|------|---------|-----|
| 0 | Element found | - |
| 81 | Invalid selector | Check CSS selector syntax |
| 83 | Element not found | Increase timeout or verify selector |
| 102 | Wait timeout | Element didn't appear within timeout |

**Example:**
```bash
# Success
bdg dom wait "h1"
echo $?  # 0

# Element not found
bdg dom wait "#missing" --timeout 5
echo $?  # 83

# Timeout (element appeared after deadline)
bdg dom wait "#slow-element" --timeout 1
echo $?  # 102
```

---

### Page Screenshot (`bdg page screenshot <path>`)

| Code | Meaning | Fix |
|------|---------|-----|
| 0 | Screenshot captured | - |
| 81 | Invalid arguments | Check format/quality values |
| 82 | Permission denied | Use writable directory |
| 103 | File write failed | Check disk space and path |
| 102 | CDP timeout | Retry operation |

**Example:**
```bash
# Success
bdg page screenshot ~/screenshot.png
echo $?  # 0

# Permission denied
bdg page screenshot /root/screenshot.png
echo $?  # 82

# Invalid format
bdg page screenshot output.bmp
echo $?  # 81
```

---

## Exit Code Handling in Scripts

### Bash Example
```bash
#!/bin/bash

bdg https://example.com --timeout 30

case $? in
  0)
    echo "Session started successfully"
    ;;
  80)
    echo "Invalid URL provided"
    exit 1
    ;;
  85)
    echo "Port busy, retrying with different port..."
    bdg https://example.com --port 9223
    ;;
  100)
    echo "Chrome launch failed - is Chrome installed?"
    exit 1
    ;;
  102)
    echo "Timeout - try increasing --timeout value"
    exit 1
    ;;
  *)
    echo "Unknown error: $?"
    exit 1
    ;;
esac
```

### Python Example
```python
import subprocess
import sys

result = subprocess.run(
    ["bdg", "https://example.com"],
    capture_output=True
)

if result.returncode == 0:
    print("Success")
elif result.returncode == 80:
    print("Invalid URL", file=sys.stderr)
    sys.exit(1)
elif result.returncode in range(80, 100):
    print(f"User error: {result.returncode}", file=sys.stderr)
    sys.exit(1)
elif result.returncode in range(100, 120):
    print(f"Software error: {result.returncode}", file=sys.stderr)
    sys.exit(1)
else:
    print(f"Unknown error: {result.returncode}", file=sys.stderr)
    sys.exit(1)
```

### Node.js Example
```javascript
import { spawn } from 'child_process';

const proc = spawn('bdg', ['https://example.com']);

proc.on('exit', (code) => {
  if (code === 0) {
    console.log('Success');
  } else if (code >= 80 && code < 100) {
    console.error(`User error: ${code}`);
    process.exit(1);
  } else if (code >= 100 && code < 120) {
    console.error(`Software error: ${code}`);
    process.exit(1);
  } else {
    console.error(`Unknown error: ${code}`);
    process.exit(1);
  }
});
```

---

## Agent-Friendly Patterns

### Retry Logic
```bash
#!/bin/bash

MAX_RETRIES=3
RETRY_DELAY=2

for i in $(seq 1 $MAX_RETRIES); do
  bdg https://example.com
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    echo "Success!"
    exit 0
  elif [ $EXIT_CODE -ge 80 ] && [ $EXIT_CODE -lt 100 ]; then
    # User error - don't retry
    echo "User error: $EXIT_CODE"
    exit $EXIT_CODE
  else
    # Software error - retry with backoff
    echo "Attempt $i failed (code $EXIT_CODE), retrying..."
    sleep $((RETRY_DELAY * i))
  fi
done

echo "Failed after $MAX_RETRIES attempts"
exit 1
```

### Error Classification
```bash
#!/bin/bash

classify_error() {
  local code=$1

  if [ $code -eq 0 ]; then
    echo "success"
  elif [ $code -ge 80 ] && [ $code -lt 100 ]; then
    echo "user_error"
  elif [ $code -ge 100 ] && [ $code -lt 120 ]; then
    echo "software_error"
  else
    echo "unknown"
  fi
}

bdg https://example.com
EXIT_CODE=$?
ERROR_TYPE=$(classify_error $EXIT_CODE)

case $ERROR_TYPE in
  success)
    echo "Operation succeeded"
    ;;
  user_error)
    echo "Fix your input and try again"
    exit 1
    ;;
  software_error)
    echo "System issue - retry later or report bug"
    exit 1
    ;;
  *)
    echo "Unexpected error"
    exit 1
    ;;
esac
```

---

## Source Code Reference

Exit codes are defined in [`src/utils/exitCodes.ts`](../src/utils/exitCodes.ts):

```typescript
export const EXIT_CODES = {
  SUCCESS: 0,
  GENERIC_FAILURE: 1,

  // User errors (80-99)
  INVALID_URL: 80,
  INVALID_ARGUMENTS: 81,
  PERMISSION_DENIED: 82,
  RESOURCE_NOT_FOUND: 83,
  RESOURCE_ALREADY_EXISTS: 84,
  RESOURCE_BUSY: 85,
  DAEMON_ALREADY_RUNNING: 86,

  // Software errors (100-119)
  CHROME_LAUNCH_FAILURE: 100,
  CDP_CONNECTION_FAILURE: 101,
  CDP_TIMEOUT: 102,
  SESSION_FILE_ERROR: 103,
  UNHANDLED_EXCEPTION: 104,
  SIGNAL_HANDLER_ERROR: 105,
} as const;
```

---

## Related Documentation

- [Agent-Friendly CLI Principles](AGENT_FRIENDLY_TOOLS.md)
- [CLI Reference](CLI_REFERENCE.md)
- [Schema Migration Plan](roadmap/SCHEMA_MIGRATION_PLAN.md)
- [Square's Exit Code System](https://developer.squareup.com/blog/command-line-observability-with-semantic-exit-codes/)
