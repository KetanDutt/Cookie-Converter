#!/usr/bin/env node
/**
 * Minimal static file server for local development — `npm run serve:node`.
 * ============================================================================
 * Node's standard library only: no dependencies, no config, no watch mode.
 * It exists so that contributors without Python (or who want correct
 * `Content-Type` headers for `.md`, `.svg` and `.webmanifest`) can preview
 * the app. Production hosting uses a real static host — see
 * docs/deployment.md.
 *
 * Usage:  node scripts/serve.js [port] [--host 0.0.0.0]
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const portArg = argv.find((arg) => /^\d+$/.test(arg));
const PORT = Number(portArg || process.env.PORT || 8080);
const hostIndex = argv.indexOf('--host');
const HOST = hostIndex !== -1 && argv[hostIndex + 1] ? argv[hostIndex + 1]
  : (process.env.HOST || '0.0.0.0');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  let pathname = decodeURIComponent(parsed.pathname || '/');
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(ROOT, path.normalize(pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(ROOT, '404.html'), (notFoundErr, html) => {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(notFoundErr ? 'Not found' : html);
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Cookie Converter → http://localhost:${PORT}/  (bound to ${HOST})\n`);
});
