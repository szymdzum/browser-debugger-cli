# Docker Usage Guide

## Overview

bdg can work with Chrome running in Docker containers using the `--chrome-ws-url` option to connect to existing Chrome instances.

## Quick Start

### Building the Image

```bash
docker build -t bdg:latest .
```

Build time: ~4 minutes on ARM64 (Apple Silicon)  
Image size: ~946MB (includes Chromium + dependencies)

### Basic Usage

```bash
# Show help
docker run --rm bdg:latest bdg --help

# Show version
docker run --rm bdg:latest bdg --version
```

## Using bdg with External Chrome (NEW)

### Option 1: Chrome in Docker, bdg on Host

```bash
# 1. Start Chrome in Docker
docker run -d --name chrome -p 9222:9222 \
  browserless/chrome \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0

# 2. Get WebSocket URL from Chrome
WS_URL=$(curl -s http://localhost:9222/json | jq -r '.[0].webSocketDebuggerUrl')

# 3. Connect bdg to external Chrome
bdg example.com --chrome-ws-url "$WS_URL"
```

### Option 2: Both in Docker Compose

```yaml
version: '3.8'

services:
  chrome:
    image: browserless/chrome
    ports:
      - "9222:9222"
    command:
      - --remote-debugging-port=9222
      - --remote-debugging-address=0.0.0.0
    networks:
      - bdg-network

  app:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./app:/usr/share/nginx/html:ro
    networks:
      - bdg-network

  bdg:
    build: .
    image: bdg:latest
    volumes:
      - ./output:/root/.bdg
    depends_on:
      - chrome
      - app
    networks:
      - bdg-network
    command: >
      sh -c "
        WS_URL=$$(curl -s http://chrome:9222/json | jq -r '.[0].webSocketDebuggerUrl') &&
        bdg http://app --chrome-ws-url $$WS_URL --timeout 10
      "

networks:
  bdg-network:
    driver: bridge
```

## CLI Option: --chrome-ws-url

Connect to an existing Chrome instance via WebSocket URL instead of launching Chrome.

**Usage:**
```bash
bdg <url> --chrome-ws-url ws://localhost:9222/devtools/page/{targetId}
```

**How to get the WebSocket URL:**
```bash
# Query Chrome's /json endpoint
curl http://localhost:9222/json | jq -r '.[0].webSocketDebuggerUrl'

# Example output:
# ws://localhost:9222/devtools/page/ABC123DEF456
```

**Behavior:**
- ✅ Skips Chrome launch entirely
- ✅ Connects directly to provided WebSocket endpoint
- ✅ All telemetry collection works identically (DOM, network, console)
- ✅ Chrome process is NOT terminated on session end (external ownership)
- ✅ Session metadata shows `chromePid: 0` (indicates external Chrome)

## Architecture Notes

### Docker Image
- **Base image**: `node:20-alpine`
- **Browser**: Chromium 142.0.7444.59 (ARM64 compatible)
- **Environment variables**:
  - `CHROME_PATH=/usr/bin/chromium-browser`
  - `CHROMIUM_FLAGS="--disable-software-rasterizer --disable-dev-shm-usage"`

### External Chrome Mode
When using `--chrome-ws-url`:
- bdg acts as a CDP client only
- Chrome lifecycle is managed externally
- No Chrome launch or termination by bdg
- Suitable for containerized Chrome services

## Known Limitations

### Running bdg Captures Inside Containers (Without External Chrome)

❌ **Not Currently Supported**: bdg's daemon architecture encounters port reservation issues inside containers.

**Root Cause**: 
- Port reservation logic (`net.createServer()`) fails inside containers
- Daemon/worker spawning creates race conditions
- Ports appear in use even when free

**Workaround**: Use `--chrome-ws-url` to connect to external Chrome (see above).

### Container Compatibility Matrix

| Scenario | Status | Notes |
|----------|--------|-------|
| bdg on host → Chrome in Docker | ✅ Works | Use `--chrome-ws-url` |
| Both in Docker Compose | ✅ Works | Use `--chrome-ws-url` |
| bdg launches Chrome in container | ❌ Broken | Port reservation issues |

## Advanced Examples

### CI/CD Pipeline

```yaml
# GitHub Actions example
jobs:
  capture-telemetry:
    runs-on: ubuntu-latest
    services:
      chrome:
        image: browserless/chrome
        ports:
          - 9222:9222
        options: >-
          --remote-debugging-port=9222
          --remote-debugging-address=0.0.0.0
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      
      - name: Install bdg
        run: npm install -g browser-debugger-cli
      
      - name: Capture telemetry
        run: |
          WS_URL=$(curl -s http://localhost:9222/json | jq -r '.[0].webSocketDebuggerUrl')
          bdg https://example.com --chrome-ws-url "$WS_URL" --timeout 10
      
      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: telemetry
          path: ~/.bdg/session.json
```

### Kubernetes Sidecar Pattern

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: bdg-capture
spec:
  containers:
  - name: chrome
    image: browserless/chrome
    ports:
    - containerPort: 9222
    args:
      - --remote-debugging-port=9222
      - --remote-debugging-address=0.0.0.0
  
  - name: bdg
    image: bdg:latest
    volumeMounts:
    - name: output
      mountPath: /root/.bdg
    command:
      - sh
      - -c
      - |
        sleep 5  # Wait for Chrome to start
        WS_URL=$(curl -s http://localhost:9222/json | jq -r '.[0].webSocketDebuggerUrl')
        bdg http://my-app --chrome-ws-url "$WS_URL" --timeout 30
  
  volumes:
  - name: output
    emptyDir: {}
```

## Troubleshooting

### Cannot connect to Chrome

**Error**: `Failed to connect to WebSocket`

**Solutions**:
1. Verify Chrome is running: `curl http://localhost:9222/json`
2. Check WebSocket URL is correct
3. Ensure Chrome was started with `--remote-debugging-address=0.0.0.0`
4. Check network connectivity between containers

### Port already in use

When not using `--chrome-ws-url`, port conflicts may occur inside containers. Use external Chrome mode instead.

### Build timeouts

The Chromium installation takes ~4 minutes and installs 188 packages. This is normal on Alpine Linux.

### ARM64 vs AMD64

The Dockerfile uses Chromium (not Google Chrome) because Chrome doesn't provide ARM64 Linux packages. Chromium works on both architectures.

## Session Metadata

When using external Chrome, session metadata indicates the Chrome PID as `0`:

```json
{
  "chromePid": 0,      // 0 = external Chrome (not managed by bdg)
  "bdgPid": 12345,
  "port": 9222,
  "targetId": "ABC123DEF456",
  "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/ABC123DEF456"
}
```

## Related Documentation

- **Issue #21**: Original feature request for external Chrome support
- **docker-compose.yml**: Example configuration in project root
- **CLI_REFERENCE.md**: Full list of CLI options
