#!/usr/bin/env node

/**
 * Minimal HTTP server for E2E testing
 * Serves static HTML and provides a simple JSON API endpoint
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const FIXTURES_DIR = __dirname;

const server = http.createServer((req, res) => {
  // Handle API endpoint
  if (req.url === '/api/test') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'Test API response' }));
    return;
  }

  // Serve index.html for root and any other path
  const filePath = path.join(FIXTURES_DIR, 'index.html');

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.error(`Test server listening on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.error('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.error('SIGINT received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});
