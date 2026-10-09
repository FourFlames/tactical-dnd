#!/usr/bin/env node
// Tiny local server for the battlemap viewer. No dependencies.
// Serves viewer.html, the computed view (player or DM), and pushes a refresh
// event whenever the engine writes state.json or log.jsonl.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const C = require('./lib/core');

const PORT = Number(process.env.PORT || 5173);
const clients = new Set();

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'viewer.html')));
  }
  if (url.pathname === '/api/state') {
    try {
      const s = C.loadState();
      if (!s) return send(res, 200, 'application/json', JSON.stringify({ empty: true }));
      return send(res, 200, 'application/json', JSON.stringify(C.view(s, url.searchParams.get('view') === 'dm' ? 'dm' : 'player')));
    } catch (e) {
      return send(res, 500, 'application/json', JSON.stringify({ error: e.message }));
    }
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  send(res, 404, 'text/plain', 'not found');
});

let pending = null;
function notify() {
  clearTimeout(pending);
  pending = setTimeout(() => { for (const c of clients) c.write('data: change\n\n'); }, 60);
}
// watchFile polls, which survives the engine's write-then-rename saves.
fs.watchFile(C.STATE, { interval: 200 }, notify);
fs.watchFile(C.LOG, { interval: 200 }, notify);
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20000);

server.listen(PORT, () => {
  console.log(`Battlemap viewer: http://localhost:${PORT}`);
  console.log(`DM view (spoilers): http://localhost:${PORT}/?dm`);
});
