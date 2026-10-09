#!/usr/bin/env node
// Tiny local server for the battlemap viewer. No dependencies.
// Serves viewer.html (and its 3D modules in viewer/), the computed view (player or DM), and pushes a refresh
// event whenever the engine writes state.json or log.jsonl.
// Remote players open their personal link (/?seat=<token>, from `node engine.js seat`)
// and declare actions, which land in intents.jsonl for the DM. The DM view only
// answers requests from this machine.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./lib/core');

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_TEXT = 600;
const clients = new Set();
const lastPost = new Map();

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, 'application/json', JSON.stringify(obj));
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

function readBody(req, limit, cb) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > limit) req.destroy(); });
  req.on('end', () => cb(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'viewer.html')));
  }
  // The 3D map's modules. Only plain file names inside viewer/, nothing else on disk.
  const mod = /^\/viewer\/([a-z0-9-]+\.js)$/.exec(url.pathname);
  if (mod) {
    const file = path.join(__dirname, 'viewer', mod[1]);
    if (!fs.existsSync(file)) return send(res, 404, 'text/plain', 'not found');
    return send(res, 200, 'text/javascript; charset=utf-8', fs.readFileSync(file));
  }
  if (url.pathname === '/api/state') {
    const wantDm = url.searchParams.get('view') === 'dm';
    if (wantDm && !isLocal(req)) return json(res, 403, { error: 'The DM view is only available on the DM\'s machine.' });
    try {
      const s = C.loadState();
      if (!s) return json(res, 200, { empty: true });
      return json(res, 200, C.view(s, wantDm ? 'dm' : 'player'));
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }
  if (url.pathname === '/api/seat') {
    const seat = C.seatByToken(url.searchParams.get('token'));
    if (!seat) return json(res, 404, { error: 'This link is not (or no longer) a seat at the table. Ask the DM for a new one.' });
    const intents = C.readIntents().filter((e) => e.player === seat.player).slice(-8)
      .map(({ id, t, creature, text, handled }) => ({ id, t, creature, text, handled }));
    return json(res, 200, { player: seat.player, creatures: seat.creatures, intents });
  }
  if (url.pathname === '/api/intent' && req.method === 'POST') {
    return readBody(req, 4096, (body) => {
      let msg; try { msg = JSON.parse(body); } catch { return json(res, 400, { error: 'Bad request.' }); }
      const seat = C.seatByToken(msg.token);
      if (!seat) return json(res, 403, { error: 'This link is not a seat at the table.' });
      const text = String(msg.text || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_TEXT);
      if (!text) return json(res, 400, { error: 'Say what you do.' });
      if (Date.now() - (lastPost.get(seat.player) || 0) < 1500) return json(res, 429, { error: 'Easy, one at a time.' });
      lastPost.set(seat.player, Date.now());
      // Attach to the creature whose turn it is if this player controls it, else their first creature.
      const s = C.loadState();
      const current = s && s.turnOrder ? s.turnOrder[s.turnIdx] : null;
      const creature = seat.creatures.includes(msg.creature) ? msg.creature : seat.creatures.includes(current) ? current : seat.creatures[0];
      const entry = { id: crypto.randomBytes(6).toString('hex'), t: Date.now(), player: seat.player, creature, text };
      C.appendIntent(entry);
      return json(res, 200, entry);
    });
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
for (const f of [C.STATE, C.LOG, C.INTENTS]) fs.watchFile(f, { interval: 200 }, notify);
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20000);

server.listen(PORT, HOST, () => {
  console.log(`Battlemap viewer: http://localhost:${PORT}`);
  console.log(`DM view (spoilers, this machine only): http://localhost:${PORT}/?dm`);
  console.log('Remote players: node engine.js seat <player> <id> prints their personal link.');
});
