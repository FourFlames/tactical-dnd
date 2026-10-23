'use strict';
// Exercise the real request handler without a network listener or the live game.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { spawnSync } = require('child_process'), { EventEmitter } = require('events');
fs.mkdirSync(path.join(__dirname, '.session'), { recursive: true });
process.env.TDND_DATA = fs.mkdtempSync(path.join(__dirname, '.session', 'hide-preview-'));
process.env.OPENROUTER_API_KEY = '';
const C = require('./lib/core'), Minds = require('./lib/minds');
function run(...args) {
  const r = spawnSync(process.execPath, ['engine.js', ...args], { encoding: 'utf8', env: process.env });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr); return r.stdout;
}
run('load', 'rope-bridge'); run('place', 'wren', 'H4');
run('remove', 'gob3'); run('remove', 'grall');
run('seat', 'preview-player', 'wren'); run('initiative'); run('turn', 'wren');
let handler;
require('http').createServer = (fn) => { handler = fn; return { listen() {} }; };
require('./server');
function request(url, msg) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    Object.assign(req, { url, method: msg ? 'POST' : 'GET', headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' }, destroy() {} });
    let status;
    const res = { writeHead(s) { status = s; }, end(body) { resolve({ status, body: JSON.parse(body) }); } };
    handler(req, res);
    if (msg) { req.emit('data', Buffer.from(JSON.stringify(msg))); req.emit('end'); }
  });
}
(async () => {
  const token = C.loadSeats()['preview-player'].token;
  const seat = await request('/api/seat?token=' + token);
  assert.strictEqual(seat.body.turn.hide.possible, false);
  assert(seat.body.turn.hide.watchers.some((w) => w.id === 'gob1' && w.los));
  const before = C.loadState();
  const attempted = await request('/api/act', { token, id: 'wren', action: 'hide', as: 'bonus' });
  assert.strictEqual(attempted.status, 400);
  assert(!/Stealth|Goblin/.test(attempted.body.error), 'refusal neither rolls nor exposes observer identities');
  assert.deepStrictEqual(C.loadState(), before, 'refused Hide spends and changes nothing');
  run('terrain', 'F4', 'remove', 'fire-source');
  run('terrain', 'H4', 'add', 'dim');
  run('hide', 'wren', '--total', '1', '--as', 'bonus');
  assert(C.turnInfo(C.loadState(), 'wren').bonus, 'a possible but failed roll still costs its bonus action');
  run('load', 'rope-bridge'); run('place', 'gob1', 'K8');
  const preview = Minds.hidePreview(C.loadState(), 'wren');
  assert(preview.partial && preview.possible);
  assert(!preview.watchers.some((w) => w.id === 'grall'), 'unseen encounter secrets never appear');

  const viewer = fs.readFileSync(path.join(__dirname, 'viewer.html'), 'utf8');
  const leafCode = viewer.slice(viewer.indexOf('function hideLeaf('), viewer.indexOf('async function sendIntent('));
  let turn = { hide: { possible: false, reason: 'Find cover.', watchers: [{ name: 'Known guard', los: true, plainSight: true }] } };
  const ctx = { myTurn: () => turn, actLeaf: (_a, _e, s) => ({ ...s, go() {} }), gated: (_k, s) => s };
  vm.createContext(ctx); vm.runInContext(leafCode, ctx);
  const blocked = ctx.hideLeaf('action', {}, { what: 'Hide' });
  assert(blocked.off && blocked.badge === 'seen' && !blocked.go);
  turn = { hide: preview };
  const partial = ctx.hideLeaf('action', {}, { what: 'Hide' });
  assert(!partial.off && partial.badge === 'seen' && partial.go, 'partial concealment remains usable');
  const wheel = fs.readFileSync(path.join(__dirname, 'viewer/pip-wheel.js'), 'utf8');
  const tooltipCode = wheel.slice(wheel.indexOf('const esc ='), wheel.indexOf('export function createPipWheel'));
  vm.runInContext(tooltipCode, ctx);
  const tip = ctx.tipHtml({ what: 'Hide', watchers: [{ name: '<Guard>', los: true, plainSight: true }] }, true);
  assert(tip.includes('Line of sight') && tip.includes('&lt;Guard&gt;') && tip.includes('clear view'));
  console.log('Hide preview: request safety, action cost, private watchers, blocked/partial leaves and tooltip passed.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
