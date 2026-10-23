// Per-observer Hide regressions, with all saved changes made by engine commands.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '.session');
fs.mkdirSync(root, { recursive: true });
process.env.TDND_DATA = fs.mkdtempSync(path.join(root, 'hide-observers-'));
process.env.OPENROUTER_API_KEY = '';
const C = require('./lib/core');
const Minds = require('./lib/minds');
function run(...args) {
  const r = spawnSync(process.execPath, ['engine.js', ...args], { cwd: __dirname, env: process.env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}

run('load', 'rope-bridge');
run('place', 'gob1', 'K8');
let before = C.loadState();
const preview = Minds.hidePreview(before, 'wren', { player: true });
assert.strictEqual(preview.possible, true);
assert.strictEqual(preview.partial, true);
assert.strictEqual(preview.watchers.find((r) => r.id === 'gob1').plainSight, true);
assert(!preview.watchers.some((r) => r.id === 'grall'), 'secret encounter creature is absent');
assert(!JSON.stringify(preview).includes('passive'), 'no secret perception scores');
assert.deepStrictEqual(C.loadState(), before, 'preview does not mutate saved state');
run('hide', 'wren', '--total', '30');
let s = C.loadState();
assert.strictEqual(s.creatures.wren.hidden, true);
assert(s.creatures.wren.hideState.detectedBy.includes('gob1'));
assert(!s.creatures.wren.hideState.detectedBy.includes('gob2'));
assert(C.observerSees(s, s.creatures.gob1, s.creatures.wren));
assert(!C.observerSees(s, s.creatures.gob2, s.creatures.wren));
assert(!C.attackPlan(s, 'wren', 'gob1', 'shortsword').notes.includes('unseen attacker'));
assert(C.attackPlan(s, 'wren', 'gob2', 'shortbow').notes.includes('unseen attacker'));
assert(C.attackPlan(s, 'gob2', 'wren', 'shortbow').notes.includes('unseen target'));
assert(C.provokeDetail(s, 'wren', ['K9', 'K10']).some((r) => r.id === 'gob1'), 'watcher who sees departure can react');
run('place', 'gob2', 'L9');
assert(C.loadState().creatures.wren.hideState.detectedBy.includes('gob2'), 'ordinary watcher remembers new exposure');
run('place', 'gob2', 'D2');
assert(C.loadState().creatures.wren.hideState.detectedBy.includes('gob2'), 'ordinary watcher detection persists');
run('condition', 'gob1', 'add', 'blinded');
s = C.loadState();
assert(s.creatures.wren.hideState.detectedBy.includes('gob1'), 'knowledge survives loss of sight');
assert(!C.observerSees(s, s.creatures.gob1, s.creatures.wren), 'knowledge alone is not sight');
assert(!C.provokeDetail(s, 'wren', ['K9', 'K10']).some((r) => r.id === 'gob1'), 'watcher without sight cannot react');
run('reveal', 'wren');
assert.strictEqual(C.loadState().creatures.wren.hideState, undefined);

run('load', 'tollhouse');
run('hide', 'wren', '--total', '30');
s = C.loadState();
assert(s.creatures.wren.hideState);
assert(!s.creatures.wren.hideState.detectedBy.includes('bram'));
// Search helper is exercised on an in-memory snapshot; the live game is untouched.
const found = Minds.search(s, 'bram', 'B11', 40);
assert(found.includes('wren'));
assert(s.creatures.wren.hideState.detectedBy.includes('bram'));
assert(!s.creatures.wren.hideState.detectedBy.includes('tilly'));
assert.strictEqual(s.creatures.wren.stealth, 30, 'one watcher cannot erase other watchers concealment');
assert.strictEqual(s.creatures.wren.hidden, true);
run('place', 'wren', 'G12');
s = C.loadState();
assert(s.creatures.wren.hideState.detectedBy.includes('bram'));
assert(!s.creatures.wren.hideState.detectedBy.includes('tilly'), 'scan detection does not spread globally');
assert(s.creatures.wren.stealth === 30);
console.log('Observer Hide: mixed detection, target-specific advantage, sight versus knowledge, safe preview, Search and scan passed.');
