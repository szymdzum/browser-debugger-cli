# Troubleshooting Guide

Common issues and solutions for **bdg** (Browser Debugger CLI).

## Chrome Launch Failures

When Chrome fails to launch, bdg automatically displays diagnostic information including:
- Detected Chrome installations on your system
- Default Chrome binary path
- Actionable troubleshooting steps

### Common Issues

#### 1. No Chrome installations detected
```bash
# Install Chrome from https://www.google.com/chrome/
```

#### 2. Port already in use
```bash
# Use a different port
bdg localhost:3000 --port 9223

# Or use strict mode to fail fast
bdg localhost:3000 --port-strict
```

#### 3. Permission denied
```bash
# Check Chrome binary permissions
ls -l $(which google-chrome)  # Linux
ls -l /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome  # macOS

# Fix permissions if needed
chmod +x /path/to/chrome/binary
```

#### 4. Connection timeout
```bash
# Increase retry attempts and polling interval
bdg localhost:3000 \
  --max-connection-retries 100 \
  --connection-poll-interval 1000  # 1 second intervals
```

## Daemon Issues

### Check daemon status
```bash
bdg status --verbose
# Shows: Daemon PID, Worker PID, Chrome PID, target info
```

### Daemon not responding
```bash
# Kill stale daemon
bdg cleanup --force

# Check for stale processes
ps aux | grep -E "node.*daemon|node.*worker"

# Kill all Chrome processes
bdg cleanup --aggressive
```

### IPC connection failed
```bash
# Verify socket exists
ls -la ~/.bdg/daemon.sock

# Remove stale socket
rm ~/.bdg/daemon.sock
bdg cleanup
```

## Session Lock Issues

If session lock is stuck after a crash:
```bash
# Force cleanup of stale session files
bdg cleanup --force

# Check for stale PID
bdg status

# Manual cleanup (last resort)
rm -rf ~/.bdg/daemon.*
```

## Common Error Messages

### "Session already running"
**Cause:** Another bdg session is active
**Solution:** 
```bash
bdg status           # Check current session
bdg stop             # Stop existing session
bdg localhost:3000   # Start new session
```

### "Daemon not running"
**Cause:** Daemon process stopped or crashed
**Solution:**
```bash
bdg cleanup          # Clean up stale files
bdg localhost:3000   # Start fresh session
```

### "Session target not found (tab may have been closed)"
**Cause:** The browser tab was closed while session was active
**Solution:**
```bash
bdg stop             # Stop current session
bdg localhost:3000   # Start new session with open tab
```

### "No Chrome installations detected"
**Cause:** Chrome is not installed or not in PATH
**Solution:**
- Install Chrome from https://www.google.com/chrome/
- Or specify Chrome path via environment variable

## Debug Mode

For detailed logging, check the daemon and worker logs:
```bash
# View daemon logs (if logging is enabled)
tail -f ~/.bdg/daemon.log

# Check session metadata
cat ~/.bdg/session.meta.json | jq
```

## Getting Help

If you encounter an issue not covered here:
1. Check `bdg --help` for command usage
2. Review the [CLI Reference](./CLI_REFERENCE.md)
3. Open an issue on GitHub with:
   - Output of `bdg status --json`
   - Error message
   - Steps to reproduce
