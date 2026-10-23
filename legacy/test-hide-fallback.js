// Regression: ordinary encounters must judge Hide without an NPC-minds object.
// All scenario changes go through the engine in a unique scratch data folder.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const scratchRoot = path.join(__dirname, '.session');
fs.mkdirSync(scratchRoot, { recursive: true });
const data = fs.mkdtempSync(path.join(scratchRoot, 'hide-fallback-'));
const env = { ...process.env, TDND_DATA: data, OPENROUTER_API_KEY: '' };
function run(...args) {
  const r = spawnSync(process.execPath, ['engine.js', ...args], { cwd: __dirname, env, encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  assert.strictEqual(r.status, 0, out);
  return out;
}
const state = () => JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8'));

run('load', 'rope-bridge');
assert.strictEqual(state().minds, undefined, 'scenario must exercise the missing-minds fallback');
let out = run('hide', 'wren', '--total', '30');
assert.match(out, /slips out of sight/);
assert.match(out, /Goblin Cutter.*passive 9 < 30/);
assert.strictEqual(state().creatures.wren.hidden, true);

out = run('hide', 'wren', '--total', '1');
assert.match(out, /tries to hide.*but is seen/);
assert.match(out, /Goblin Cutter.*passive 9 >= 1/);
assert.strictEqual(state().creatures.wren.hidden, false);

run('place', 'wren', 'H4');
run('remove', 'gob3');
run('remove', 'grall');
out = run('hide', 'wren', '--total', '30');
assert.match(out, /nothing to hide behind/);
assert.strictEqual(state().creatures.wren.hidden, false);

run('load', 'rope-bridge');
out = run('hide', 'wren', '--auto');
assert.match(out, /Stealth/);
assert.doesNotMatch(out, /REJECTED|undefined/);
console.log('Hide fallback: high/low totals, plain-sight refusal, and automatic roll passed.');
