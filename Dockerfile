FROM node:20-alpine

# Install Chromium and dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    nodejs \
    npm

# Set Chromium path for chrome-launcher
ENV CHROME_PATH=/usr/bin/chromium-browser
ENV CHROMIUM_FLAGS="--disable-software-rasterizer --disable-dev-shm-usage"

# Install bdg globally
RUN npm install -g browser-debugger-cli

# Create output directory
RUN mkdir -p /root/.bdg

WORKDIR /workspace

# Default command shows help
CMD ["bdg", "--help"]
