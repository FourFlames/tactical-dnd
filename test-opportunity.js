'use strict';
// Every fixture mutation goes through the engine in an isolated workspace folder.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
process.env.TDND_DATA = fs.mkdtempSync(path.join(__dirname, '.oa-test-'));
delete process.env.OPENROUTER_API_KEY;
const C = require('./lib/core');
let checks = 0;
function run(...args) {
  const r = spawnSync(process.execPath, ['engine.js', ...args], { cwd: __dirname, encoding: 'utf8', env: process.env });
  if (r.status !== 0) throw new Error(args.join(' ') + '\n' + r.stdout + r.stderr);
  return r.stdout;
}
function check(name, truth) {
  if (!truth) throw new Error(name);
  checks++; console.log('  ok   ' + name);
}
function fixture(seated = true) {
  if (!seated && C.loadSeats().sam) run('unseat', 'sam');
  run('load', 'rope-bridge');
  for (const id of Object.keys(C.loadState().creatures)) if (id !== 'rook') run('remove', id);
  run('place', 'rook', 'L3');
  run('spawn', JSON.stringify({ id: 'foe', name: 'Runner', side: 'enemy', controller: 'dm', pos: 'M3', hp: 100, ac: 30, speed: 30, initBonus: -100, attacks: [{ name: 'Club', bonus: 1, damage: '1', type: 'bludgeoning', reach: 5 }] }));
  if (seated) run('seat', 'sam', 'rook');
  run('initiative'); run('turn', 'foe');
  check('fixture puts the mover last in the round', C.loadState().turnIdx === 1);
  run('move', 'foe', 'N3');
  return C.loadState().pendingOA[0].id;
}
try {
  let id = fixture();
  let before = C.loadState();
  check('seated reactor receives an offer', C.readOffers().some((o) => o.oa === id && o.player === 'sam'));
  check('next waits at the round boundary', /Waiting for opportunity/.test(run('next')) && C.loadState().round === before.round && C.loadState().turnIdx === before.turnIdx);
  check('repeated auto preserves the pending choice', /Waiting for opportunity/.test(run('auto')) && C.loadState().pendingOA.some((p) => p.id === id));
  run('oa', id);
  check('accept spends the existing reaction', C.loadState().creatures.rook.reactionUsed === true);
  run('auto');
  check('auto resumes past the completed monster turn', C.loadState().round === 2 && C.loadState().turnOrder[C.loadState().turnIdx] === 'rook');
  check('reactor regains its reaction only at its own new turn', !C.loadState().creatures.rook.reactionUsed && !C.loadState().pendingOA.length);
  const stale = spawnSync(process.execPath, ['engine.js', 'oa', id], { cwd: __dirname, encoding: 'utf8', env: process.env });
  check('old offer cannot consume the refreshed reaction', stale.status !== 0 && !C.loadState().creatures.rook.reactionUsed);

  id = fixture(false);
  check('local player choices also pause forced advancement', /Waiting for opportunity/.test(run('next', '--force')) && C.loadState().round === 1);
  run('oa', id, '--drop'); run('auto');
  check('decline resumes without spending the reaction', C.loadState().round === 2 && !C.loadState().creatures.rook.reactionUsed);

  id = fixture();
  run('next'); run('condition', 'rook', 'add', 'stunned'); run('auto');
  check('invalidated reaction does not block advancement', C.loadState().round === 2 && !C.loadState().pendingOA.length);

  id = fixture();
  run('next'); run('use', 'rook', 'reaction'); run('auto');
  check('spending the reaction elsewhere invalidates the old offer', C.loadState().round === 2 && !C.loadState().pendingOA.length);

  id = fixture();
  run('use', 'rook', 'reaction'); run('regain', 'rook', 'reaction');
  check('regaining a reaction cannot revive an earlier choice', !C.loadState().pendingOA.length);

  id = fixture();
  run('turn', 'rook');
  check('turn repair drops choices from the old reaction window', !C.loadState().pendingOA.length);
  console.log(`${checks} opportunity checks passed.`);
} finally {
  fs.rmSync(process.env.TDND_DATA, { recursive: true, force: true });
}
