FROM node:24-alpine

# Chromium and the libraries it needs (Node comes from the base image)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Chromium path for chrome-launcher
ENV CHROME_PATH=/usr/bin/chromium-browser

# Install bdg globally
RUN npm install -g browser-debugger-cli

# Run as the unprivileged "node" user from the base image.
# bdg adds --no-sandbox automatically inside containers (Docker's default
# seccomp profile blocks Chrome's sandbox for every user).
USER node
WORKDIR /home/node

# Default command shows help
CMD ["bdg", "--help"]
