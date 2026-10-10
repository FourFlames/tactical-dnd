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
const lastPing = new Map();
const lastAct = new Map();
// The seat's creature whose turn it is, with where it stands in its turn; null if it isn't theirs.
function myTurn(seat, s = C.loadState()) {
  if (!s || !s.turnOrder || !s.turnOrder.length) return null;
  const id = s.turnOrder[s.turnIdx];
  if (!seat.creatures.includes(id) || !s.creatures[id]) return null;
  const u = s.undo;
  const canUndo = !!(u && u.id === id && u.round === s.round && u.turnIdx === s.turnIdx && !u.rolled);
  return Object.assign({ id, name: s.creatures[id].name, features: C.featuresOf(s.creatures[id]), canUndo }, C.turnInfo(s, id));
}
async function answerOffer(res, seat, msg) {
  const o = C.readOffers().find((x) => x.offer === msg.offer && x.player === seat.player);
  if (!o) return json(res, 404, { error: 'That offer is gone.' });
  if (o.answer) return json(res, 409, { error: 'Already answered.' });
  let text = msg.accept ? 'Yes, do it.' : 'No, never mind.';
  if (msg.accept && o.ruling) {
    const rl = o.ruling;
    const r = await runEngine(['ruling', o.creature, rl.skill, String(rl.dc), '--about', rl.about, '--success', rl.success, '--fail', rl.fail]);
    if (!r.ok) return json(res, 400, { error: r.out });
    text = 'Yes. ' + r.out.split('\n')[0] + ' (DM: apply the outcome.)';
  }
  C.appendIntent({ id: crypto.randomBytes(6).toString('hex'), t: Date.now(), player: seat.player, creature: o.creature, kind: 'answer', to: o.offer, accept: !!msg.accept, text });
  return json(res, 200, { ok: true, text });
}
// The instant answer a player gets the moment their message lands, before the DM reads it.
function receipt(s, seat, entry) {
  const dm = C.dmPresence();
  const current = s && s.turnOrder && s.turnOrder.length ? s.creatures[s.turnOrder[s.turnIdx]] : null;
  const mine = current && seat.creatures.includes(current.id);
  const what = entry.kind === 'inspect' ? 'Question delivered.' : 'Delivered.';
  const when = dm.listening ? 'The DM is listening and will answer in a moment.'
    : 'The DM is busy resolving something; they\'ll be flagged about this with their very next move.';
  const turn = entry.kind === 'inspect' || !current || mine ? '' : ` It's ${current.name}'s turn, so this is noted as your plan.`;
  return `${what} ${when}${turn}`;
}
// Join codes are short enough to guess, so an address that keeps missing gets locked out for a while.
const misses = new Map();
const LOCKOUT = 10 * 60 * 1000;
function seatFor(req, token) {
  const ip = req.socket.remoteAddress, now = Date.now();
  const m = misses.get(ip);
  if (m && m.count >= 10 && now - m.since < LOCKOUT) return { locked: true };
  const seat = C.seatByToken(token);
  if (seat) return seat;
  if (!m || now - m.since > LOCKOUT) misses.set(ip, { count: 1, since: now }); else m.count++;
  return null;
}

// The person at this machine plays any player-controlled creature that has no remote seat.
function seatOf(req, token) {
  if (token !== 'local') return seatFor(req, token);
  if (!isLocal(req)) return null;
  const s = C.loadState();
  const creatures = s ? Object.keys(s.creatures).filter((id) => s.creatures[id].controller === 'player' && !s.creatures[id].player) : [];
  return { player: 'local', creatures };
}

// ---------- player actions ----------
// Buttons in the viewer run ordinary engine commands, one at a time, for the creature whose turn
// it is, and only if that creature belongs to the player. The engine stays the only thing that
// changes the game. Each result is filed as an `auto` intent for the DM: quiet ones (plain moves,
// dash, dodge, undo) wait for the next loud one (rolls, end of turn) to wake the DM.
const { execFile } = require('child_process');
let engineQueue = Promise.resolve();
function runEngine(args) {
  const job = engineQueue.then(() => new Promise((resolve) => {
    execFile(process.execPath, [path.join(__dirname, 'engine.js'), ...args], { cwd: __dirname, timeout: 20000 }, (err, stdout) => {
      const out = String(stdout || '').split('\n\n📨')[0].trim();
      resolve({ ok: !/^REJECTED:/.test(out) && !(err && !out), out: out.replace(/^REJECTED:\s*/, '') });
    });
  }));
  engineQueue = job.catch(() => {});
  return job;
}
const ACTS = {
  // name: (ctx) => { args, quiet?, check?() } ; check returns an error string to refuse
  move: ({ id, msg }) => ({ args: ['move', id, String(msg.cell || ''), ...(msg.jump ? ['--jump'] : []), ...(msg.fastClimb ? ['--fast-climb'] : [])], quietIf: (out) => !/Athletics|PROVOKES|falls|prone|over the edge/i.test(out) }),
  dash: ({ id, msg, ti, f }) => econ(ti, f, msg.as, ['dash', id], true),
  disengage: ({ id, msg, ti, f }) => econ(ti, f, msg.as, ['disengage', id], true),
  dodge: ({ id, ti }) => (ti.action ? { error: 'Your action is already spent.' } : { args: ['dodge', id], quiet: true }),
  hide: ({ id, msg, ti, f }) => {
    const e = econ(ti, f, msg.as, null);
    return e.error ? e : { pre: ['use', id, msg.as === 'bonus' ? 'bonus' : 'action'], args: ['check', id, 'stealth', '--about', 'hide'] };
  },
  attack: ({ id, msg, ti }) => (ti.action ? { error: 'Your action is already spent.' }
    : { args: ['attack', id, String(msg.target || ''), String(msg.weapon || ''), ...(msg.sneak ? ['--sneak'] : [])] }),
  check: ({ id, msg }) => (/^[a-z-]{2,20}$/.test(msg.skill || '') ? { args: ['check', id, msg.skill, '--about', String(msg.about || 'look closer').slice(0, 120)] } : { error: 'Pick a skill.' }),
  undo: ({ id }) => ({ args: ['undo', id], quiet: true }),
  end: ({ id }) => ({ args: ['next'], label: 'ends the turn' }),
};
function econ(ti, f, as, args, quiet) {
  if (as === 'bonus') {
    if (!f.cunningAction && !f.nimbleEscape) return { error: 'You have nothing that makes that a bonus action.' };
    if (ti.bonus) return { error: 'Your bonus action is already spent.' };
  } else if (ti.action) return { error: 'Your action is already spent.' };
  return { args: args && [...args, ...(as === 'bonus' ? ['--as', 'bonus'] : [])], quiet };
}

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
  // Short, typable join links: /j/ember-wolf-42 opens the viewer with that seat.
  const join = /^\/j\/([^/]+)$/.exec(url.pathname);
  if (join) {
    let code = ''; try { code = C.normCode(decodeURIComponent(join[1])); } catch { /* bad escape */ }
    res.writeHead(302, { Location: '/?seat=' + encodeURIComponent(code) });
    return res.end();
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
    const seat = seatOf(req, url.searchParams.get('token'));
    if (seat && seat.locked) return json(res, 429, { error: 'Too many wrong codes. Wait a few minutes, then check the code with the DM.' });
    if (!seat) return json(res, 404, { error: 'This link is not (or no longer) a seat at the table. Ask the DM for a new one.' });
    const intents = C.readIntents().filter((e) => e.player === seat.player && ((e.kind !== 'auto' && e.kind !== 'answer') || e.replies.length)).slice(-8)
      .map(({ id, t, creature, text, kind, target, cell, z, handled, seenAt, replies, done }) => ({ id, t, creature, text, kind, target, cell, z, handled, seenAt, replies, done }));
    const offers = C.readOffers().filter((o) => o.player === seat.player && !o.answer).slice(-3)
      .map(({ offer, t, creature, text, ruling }) => ({ offer, t, creature, text, ruling: ruling ? { skill: ruling.skill, dc: ruling.dc } : null }));
    return json(res, 200, { player: seat.player, creatures: seat.creatures, intents, offers, turn: myTurn(seat), dm: C.dmPresence() });
  }
  // Route preview for click-to-move: the path the engine would take, its cost, the rolls on the
  // way (with their DCs) and any opportunity attacks. Read-only.
  if (url.pathname === '/api/path') {
    const seat = seatOf(req, url.searchParams.get('token'));
    const s = C.loadState();
    const turn = seat && !seat.locked && myTurn(seat, s);
    if (!turn) return json(res, 403, { error: 'Not your turn.' });
    const cell = String(url.searchParams.get('cell') || '').toUpperCase();
    const p = C.parseCell(cell);
    if (!/^[A-Z]\d{1,2}$/.test(cell) || !C.inBounds(s, p.x, p.y)) return json(res, 400, { error: 'Off the map.' });
    if (s.creatures[turn.id].pos === cell) return json(res, 200, { ok: false, reason: 'here' });
    if (C.occupant(s, p.x, p.y, turn.id)) return json(res, 200, { ok: false, reason: 'occupied' });
    const opts = { jump: url.searchParams.has('jump'), fastClimb: url.searchParams.has('fastClimb'), running: turn.used >= 10 };
    let route = null;
    try { route = C.findPath(s, turn.id, cell, opts); } catch { /* treated as no route */ }
    if (!route) return json(res, 200, { ok: false, reason: 'no route' });
    const walked = [s.creatures[turn.id].pos];
    for (const st of route.steps) walked.push(...(st.over || []), st.to);
    const checks = route.steps.filter((st) => st.check).map((st) => ({ kind: st.kind, dc: st.dc, to: st.to }));
    const provokers = C.provokersAlong(s, turn.id, walked).map((id) => s.creatures[id].name);
    const dashLeft = turn.dash ? null : turn.left + C.speedOf(s.creatures[turn.id]) * (C.hasCond(s.creatures[turn.id], 'prone') ? 0.5 : 1);
    return json(res, 200, { ok: route.cost <= turn.left, cost: route.cost, left: turn.left, dashLeft, path: walked, checks, provokers });
  }
  if (url.pathname === '/api/act' && req.method === 'POST') {
    return readBody(req, 2048, async (body) => {
      let msg; try { msg = JSON.parse(body); } catch { return json(res, 400, { error: 'Bad request.' }); }
      const seat = seatOf(req, msg.token);
      if (!seat || seat.locked) return json(res, 403, { error: 'This link is not a seat at the table.' });
      if (Date.now() - (lastAct.get(seat.player) || 0) < 150) return json(res, 429, { error: 'Easy.' });
      lastAct.set(seat.player, Date.now());
      if (msg.action === 'answer') return answerOffer(res, seat, msg);
      const s = C.loadState();
      const turn = myTurn(seat, s);
      if (!turn) return json(res, 403, { error: 'It isn\'t your turn.' });
      const make = ACTS[msg.action];
      if (!make) return json(res, 400, { error: 'Unknown action.' });
      const plan = make({ id: turn.id, msg, ti: turn, f: C.featuresOf(s.creatures[turn.id]) });
      if (plan.error) return json(res, 400, { error: plan.error });
      if (plan.pre) { const r = await runEngine(plan.pre); if (!r.ok) return json(res, 400, { error: r.out }); }
      const r = await runEngine(plan.args);
      if (!r.ok) return json(res, 400, { error: r.out });
      const quiet = plan.quietIf ? plan.quietIf(r.out) : !!plan.quiet;
      const first = r.out.split('\n')[0];
      C.appendIntent({ id: crypto.randomBytes(6).toString('hex'), t: Date.now(), player: seat.player, creature: turn.id, kind: 'auto', quiet, text: plan.label ? `${s.creatures[turn.id].name} ${plan.label}. ${first}` : first });
      return json(res, 200, { ok: true, text: first, quiet });
    });
  }
  // What a party member can tell about a creature or square. Seated players look through their
  // own characters; anyone else through the party member whose turn it is (or the first one).
  if (url.pathname === '/api/look') {
    const s = C.loadState();
    if (!s) return json(res, 404, { error: 'No encounter loaded.' });
    const token = url.searchParams.get('token');
    let mine;
    if (token) {
      const seat = seatOf(req, token);
      if (!seat || seat.locked) return json(res, 403, { error: 'This link is not a seat at the table.' });
      mine = seat.creatures;
    } else mine = Object.keys(s.creatures).filter((id) => s.creatures[id].side === 'party');
    const current = s.turnOrder ? s.turnOrder[s.turnIdx] : null;
    const want = url.searchParams.get('from');
    const from = mine.includes(want) ? want : mine.includes(current) ? current : mine.find((id) => s.creatures[id] && s.creatures[id].pos);
    const id = url.searchParams.get('id'), cell = url.searchParams.get('cell'), z = url.searchParams.get('z');
    if (!from) return json(res, 404, { error: 'You have no character on the map.' });
    if (!id && !/^[A-Za-z]\d{1,2}$/.test(cell || '')) return json(res, 400, { error: 'Look at what?' });
    const l = C.look(s, from, id ? { id } : { cell: cell.toUpperCase(), z: z === null || z === '' ? undefined : Number(z) });
    if (!l) return json(res, 404, { error: 'Your character knows nothing about that.' });
    return json(res, 200, l);
  }
  // Pings: a short-lived marker every viewer draws, for "this square, right here".
  if (url.pathname === '/api/ping' && req.method === 'POST') {
    return readBody(req, 1024, (body) => {
      let msg; try { msg = JSON.parse(body); } catch { return json(res, 400, { error: 'Bad request.' }); }
      let who = 'the table';
      if (msg.token) {
        const seat = seatOf(req, msg.token);
        if (!seat || seat.locked) return json(res, 403, { error: 'This link is not a seat at the table.' });
        who = seat.player;
      } else if (!isLocal(req)) return json(res, 403, { error: 'Join with a seat link to ping.' });
      if (Date.now() - (lastPing.get(who) || 0) < 600) return json(res, 429, { error: 'Easy.' });
      lastPing.set(who, Date.now());
      const s = C.loadState();
      if (!s) return json(res, 404, { error: 'No encounter loaded.' });
      const p = C.parseCell(String(msg.cell || ''));
      if (!C.inBounds(s, p.x, p.y)) return json(res, 400, { error: 'Off the map.' });
      // Only name a creature the players can see, so a ping from the DM view can't give one away.
      const knows = C.partyKnows(s);
      const c = msg.target && s.creatures[msg.target];
      const ping = { who, cell: C.cellId(p.x, p.y), z: Number(msg.z) || 0, label: c && knows.creature(c) ? c.name : null, t: Date.now() };
      for (const cl of clients) cl.write(`event: ping\ndata: ${JSON.stringify(ping)}\n\n`);
      return json(res, 200, ping);
    });
  }
  if (url.pathname === '/api/intent' && req.method === 'POST') {
    return readBody(req, 4096, (body) => {
      let msg; try { msg = JSON.parse(body); } catch { return json(res, 400, { error: 'Bad request.' }); }
      const seat = seatOf(req, msg.token);
      if (seat && seat.locked) return json(res, 429, { error: 'Too many wrong codes. Wait a few minutes.' });
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
      if (msg.kind === 'inspect') entry.kind = 'inspect';
      // What the player was pointing at, if anything: a creature id or a square (+ height).
      if (s && msg.target && s.creatures[msg.target]) entry.target = msg.target;
      else if (s && /^[A-Za-z]\d{1,2}$/.test(msg.cell || '')) { entry.cell = String(msg.cell).toUpperCase(); if (Number(msg.z)) entry.z = Number(msg.z); }
      C.appendIntent(entry);
      return json(res, 200, Object.assign(entry, { receipt: receipt(s, seat, entry) }));
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
// listening.json is touched every second while the DM listens, so push only when presence flips.
let wasListening = false;
setInterval(() => { const now = C.dmPresence().listening; if (now !== wasListening) { wasListening = now; notify(); } }, 1000);
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20000);

server.listen(PORT, HOST, () => {
  console.log(`Battlemap viewer: http://localhost:${PORT}`);
  console.log(`DM view (spoilers, this machine only): http://localhost:${PORT}/?dm`);
  console.log('Remote players: node engine.js seat <player> <id> prints their personal link.');
});
