// Smoke tests for the engine. Run: node test.js
// Uses a scratch copy of state so it won't clobber a game in progress.
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const C = require('./lib/core');

const backup = {};
for (const f of [C.STATE, C.LOG]) if (fs.existsSync(f)) backup[f] = fs.readFileSync(f);

let pass = 0, failed = 0;
function run(...args) {
  const r = spawnSync('node', ['engine.js', ...args], { cwd: __dirname, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}
function expect(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}\n       ${detail}`); }
}

try {
  run('load', 'rope-bridge');
  let r = run('move', 'rook', 'B1');
  expect('walls are rejected', !r.ok && /can't be entered/.test(r.out), r.out);
  r = run('move', 'rook', 'C5');
  expect('chasm is rejected', !r.ok, r.out);
  r = run('move', 'rook', 'H4');
  expect('crossing the bridge within speed', r.ok, r.out);
  r = run('move', 'rook', 'O2');
  expect('speed limit enforced', !r.ok && /needs \d+ ft/.test(r.out), r.out);
  r = run('dash', 'rook'); r = run('move', 'rook', 'L4');
  expect('dash doubles movement', r.ok, r.out);
  r = run('attack', 'rook', 'gob3', 'longsword');
  expect('melee reach enforced', !r.ok && /reach/.test(r.out), r.out);
  r = run('range', 'wren', 'gob2');
  expect('range reports LOS', /line of sight/.test(r.out), r.out);

  const st = C.loadState();
  const pv = C.view(st, 'player'), dv = C.view(st, 'dm');
  expect('hidden bugbear absent from player view', !pv.creatures.grall, JSON.stringify(Object.keys(pv.creatures)));
  expect('hidden bugbear present in DM view', !!dv.creatures.grall, '');
  expect('enemy HP hidden from player view', pv.creatures.gob1 && pv.creatures.gob1.hp === undefined, JSON.stringify(pv.creatures.gob1));

  r = run('ruling', 'rook', 'athletics', '12');
  expect('ruling requires stakes up front', !r.ok && /--about/.test(r.out), r.out);
  r = run('terrain', 'G4:H4', 'add', 'burning');
  expect('terrain range edit', r.ok && /G4, H4/.test(r.out), r.out);

  run('load', 'rope-bridge');
  run('place', 'rook', 'G3');
  r = run('shove', 'rook', 'gob1');
  expect('library command (ext/shove.js) runs', r.ok && /shoves/.test(r.out), r.out);

  r = run('initiative');
  expect('initiative starts round 1', r.ok && /Round 1/.test(r.out), r.out);
  r = run('next');
  expect('next advances the turn', r.ok && /turn/.test(r.out), r.out);
} finally {
  for (const f of [C.STATE, C.LOG]) { if (backup[f]) fs.writeFileSync(f, backup[f]); else if (fs.existsSync(f)) fs.unlinkSync(f); }
}
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
