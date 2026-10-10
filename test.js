// Smoke tests for the engine. Run: node test.js
// Uses a scratch copy of state so it won't clobber a game in progress.
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const C = require('./lib/core');

const backup = {};
const FILES = [C.STATE, C.LOG, C.SEATS, C.INTENTS, C.LISTEN];
for (const f of FILES) if (fs.existsSync(f)) backup[f] = fs.readFileSync(f);

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

  // height, props and walls along grid lines (watchtower)
  run('load', 'watchtower');
  let wt = C.loadState();
  let wv = C.view(wt, 'dm');
  expect('heights grid feeds the view', wv.cells[0][12].h === 10 && wv.cells[3][9].h === 5 && wv.cells[11][0].h === 0, JSON.stringify(wv.cells[3][9]));
  expect('creature elevation on the platform', wv.creatures.vessa.elev === 10, JSON.stringify(wv.creatures.vessa));
  expect('legend objects reach the view', wv.cells[3][3].obj && wv.cells[3][3].obj.kind === 'crate' && wv.cells[3][3].obj.stand === true, JSON.stringify(wv.cells[3][3]));
  expect('secret door hidden from player view', !C.view(wt, 'player').walls.some((w) => w.id === 'secret1') && wv.walls.some((w) => w.id === 'secret1'), '');
  r = run('place', 'rook', 'D7');
  r = run('move', 'rook', 'D8');
  expect('closed door blocks movement', !r.ok && /No route/.test(r.out), r.out);
  r = run('door', 'door1', 'open');
  expect('door command opens a door', r.ok && /swings open/.test(r.out), r.out);
  r = run('move', 'rook', 'D8');
  expect('open door lets you through', r.ok, r.out);
  run('door', 'door1', 'close');
  run('place', 'rook', 'G9');
  r = run('move', 'rook', 'F9');
  expect('window blocks movement', !r.ok, r.out);
  r = run('range', 'rook', 'band2');
  expect('window allows sight with cover', /line of sight: yes, cover \+2/.test(r.out), r.out);
  run('place', 'rook', 'H10');
  r = run('range', 'rook', 'band2');
  expect('solid wall blocks sight', /line of sight: NO/.test(r.out), r.out);
  run('place', 'rook', 'D6');
  r = run('move', 'rook', 'D7');
  expect('low wall costs 5 ft extra to cross', r.ok && /\(10 ft/.test(r.out), r.out);
  r = run('range', 'rook', 'vessa');
  expect('range reports height difference', /10 ft higher/.test(r.out), r.out);

  // climbing, jumping, falling, and height in distance and sight
  run('load', 'watchtower');
  run('place', 'rook', 'L7');
  r = run('move', 'rook', 'L6');
  expect('climbing a 10-ft ledge costs double (5 + 5 parapet + 20)', r.ok && /\(30 ft/.test(r.out) && /Climbs up 10 ft/.test(r.out), r.out);
  run('load', 'watchtower');
  run('place', 'rook', 'L7');
  r = run('move', 'rook', 'L6', '--fast-climb');
  expect('fast climb rolls Athletics; failure falls', r.ok && (/success/.test(r.out) ? /\(20 ft/.test(r.out) : /falls 10 ft/.test(r.out)), r.out);
  run('load', 'watchtower');
  run('place', 'rook', 'I4');
  r = run('move', 'rook', 'K4');
  expect('stairs cost normal movement', r.ok && /\(10 ft/.test(r.out), r.out);
  run('load', 'watchtower');
  run('place', 'rook', 'A4');
  r = run('move', 'rook', 'F4', '--jump');
  expect('running long jump clears two crates', r.ok && /Jumps 10 ft over D4\/E4/.test(r.out), r.out);
  run('load', 'watchtower');
  run('place', 'rook', 'C4');
  r = run('move', 'rook', 'F4', '--jump');
  expect('standing jump is half as long', r.ok && !/Jumps/.test(r.out), r.out);
  run('place', 'vessa', 'Q2');
  run('place', 'wren', 'K5');
  r = run('move', 'wren', 'M5', '--jump', '--running');
  expect('low-Str jumper needs Athletics to clear a crate', r.ok && /Athletics to jump over L5 \(4 ft high\).*DC 11/.test(r.out), r.out);
  run('load', 'watchtower');
  run('place', 'rook', 'J6');
  run('place', 'vessa', 'K6');
  r = run('attack', 'rook', 'vessa', 'longsword');
  expect('height counts toward reach', !r.ok && /10 ft away/.test(r.out), r.out);
  run('load', 'watchtower');
  run('place', 'vessa', 'N6');
  r = run('range', 'vessa', 'rook');
  const r2 = run('range', 'rook', 'vessa');
  expect('parapet covers the defender, not the shooter leaning over it', !/cover/.test(r.out) && /cover \+2/.test(r2.out), r.out + ' | ' + r2.out);
  run('load', 'watchtower');
  run('place', 'rook', 'L7');
  r = run('move', 'rook', 'L6', '--jump', '--running');
  expect('jump and grab a ledge within reach, then haul up', r.ok && /grabs the lip of the 10-ft ledge/.test(r.out) && /\(25 ft/.test(r.out), r.out);
  run('load', 'watchtower');
  run('place', 'rook', 'L7');
  r = run('move', 'rook', 'L6', '--vault', '--running');
  expect('vaulting onto a ledge: DC 5 + 3 per foot over the high jump', r.ok && /land on their feet.*DC 17/.test(r.out), r.out);
  run('load', 'watchtower');
  run('place', 'wren', 'Q7');
  run('dash', 'wren');
  r = run('move', 'wren', 'Q6', '--jump', '--running');
  expect('a small, weak jumper can\'t reach the lip and climbs', r.ok && /Climbs up 10 ft/.test(r.out), r.out);
  r = run('fall', 'rook', 'H5', '--feet', '30');
  expect('falling into water halves, a check quarters', r.ok && /half damage/.test(r.out) && /DC 13/.test(r.out), r.out);
  run('load', 'watchtower');
  run('place', 'vessa', 'N6');
  r = run('fall', 'band1', 'P8', '--feet', '20');
  expect('fall: 1d6 per 10 ft and prone', r.ok && /2d6/.test(r.out) && /prone/.test(r.out), r.out);
  run('load', 'rope-bridge');
  run('place', 'rook', 'E9');
  r = run('move', 'rook', 'E4', '--jump');
  expect('long jump across a 10-ft chasm', r.ok && /Jumps 10 ft over/.test(r.out), r.out);

  run('load', 'rope-bridge');
  run('place', 'rook', 'F7');
  r = run('move', 'rook', 'E4', '--jump', '--running');
  expect('jumps go in a straight line at any angle (F7 to E4 over the chasm)', r.ok && /F7 → E4 \(15 ft/.test(r.out) && /over F6\/E5/.test(r.out), r.out);
  r = run('move', 'rook', 'F3');
  expect('a diagonal step slips past a low brazier (E4 to F3, 5 ft)', r.ok && /E4 → F3 \(5 ft/.test(r.out), r.out);

  run('load', 'rope-bridge');
  r = run('initiative');
  expect('initiative starts round 1', r.ok && /Round 1/.test(r.out), r.out);
  r = run('next');
  expect('next advances the turn', r.ok && /turn/.test(r.out), r.out);

  for (const f of [C.SEATS, C.INTENTS]) if (fs.existsSync(f)) fs.unlinkSync(f);
  r = run('seat', 'sam', 'wren', '--host', 'http://table.test:5173');
  const token = (C.loadSeats().sam || {}).token;
  expect('seat prints a short word-code link', r.ok && /^[a-z]+-[a-z]+-\d\d$/.test(token) && r.out.includes(`http://table.test:5173/j/${token}`), r.out);
  expect('codes forgive capitals and spaces', C.seatByToken(' ' + token.replace(/-/g, ' ').toUpperCase()) !== null, token);
  expect('seated creature is player-controlled', C.loadState().creatures.wren.player === 'sam', '');
  r = run('wait', 'wren', '--timeout', '0');
  expect('wait times out cleanly', r.ok && /TIMEOUT/.test(r.out), r.out);
  C.appendIntent({ id: 'i1', t: Date.now(), player: 'sam', creature: 'wren', text: 'I loose an arrow at the archer' });
  r = run('wait', 'wren', '--timeout', '5');
  expect('wait returns the declared action', r.ok && /loose an arrow/.test(r.out), r.out);
  r = run('intents');
  expect('handled intents are not repeated', /Nothing new/.test(r.out), r.out);
  expect('declared action reaches the chronicle', C.readLog().some((e) => e.type === 'declare' && /loose an arrow/.test(e.text)), '');
  C.appendIntent({ id: 'beef0001', t: Date.now(), player: 'sam', creature: 'wren', kind: 'inspect', target: 'gob1', text: 'Is that a knife?' });
  r = run('range', 'rook', 'gob1');
  expect('every command flags unread messages', /📨 1 unread from sam/.test(r.out), r.out);
  r = run('listen', '--timeout', '5');
  expect('listen returns any player\'s message with its id', r.ok && /#beef00 \[sam → wren\] INSPECT @gob1 Is that a knife\?/.test(r.out), r.out);
  expect('questions stay out of the chronicle', !C.readLog().some((e) => /knife/.test(e.text)), '');
  r = run('range', 'rook', 'gob1');
  expect('no unread flag once seen', !/unread/.test(r.out), r.out);
  r = run('reply', '#beef', 'Rolling Perception for you.');
  let msg = C.readIntents().find((e) => e.id === 'beef0001');
  expect('reply attaches to the message', r.ok && msg.replies.length === 1 && !msg.done, r.out);
  r = run('reply', 'sam', 'Yes: a hooked knife, for the ropes.', '--done');
  msg = C.readIntents().find((e) => e.id === 'beef0001');
  expect('reply by player name hits their latest, --done closes it', r.ok && msg.replies.length === 2 && msg.done, r.out);
  r = run('describe', 'gob1', 'Carries a hooked knife for the bridge ropes.');
  expect('describe records a fact', r.ok && C.loadState().known.gob1.length === 1, r.out);
  r = run('look', 'rook', 'gob1');
  expect('look shows distance, attacks and known facts', r.ok && /ft from Rook/.test(r.out) && /Longsword (in reach|out of reach)/.test(r.out) && /hooked knife/.test(r.out), r.out);
  r = run('look', 'rook', 'grall');
  expect('look refuses hidden creatures', !r.ok, r.out);
  r = run('look', 'rook', 'F4', '--z', '10');
  expect('look at a square with a height', r.ok && /brazier/i.test(r.out) && /above where you'd stand/.test(r.out), r.out);
  // player buttons: action economy, undo, quiet bundling, offers
  run('load', 'rope-bridge');
  run('initiative');
  r = run('move', 'wren', 'K8');
  r = run('undo', 'wren');
  expect('undo takes back a plain move', r.ok && C.loadState().creatures.wren.pos === 'K9', r.out);
  r = run('undo', 'wren');
  expect('undo only once', !r.ok, r.out);
  r = run('dash', 'wren', '--as', 'bonus');
  let ti = C.turnInfo(C.loadState(), 'wren');
  expect('bonus-action dash leaves the action free', r.ok && ti.bonus && !ti.action && ti.dash, JSON.stringify(ti));
  r = run('dodge', 'wren');
  ti = C.turnInfo(C.loadState(), 'wren');
  expect('dodge spends the action and sets dodging', r.ok && ti.action && C.loadState().creatures.wren.conditions.some((x) => x.name === 'dodging'), r.out);
  run('place', 'rook', 'L3'); run('place', 'gob3', 'M3');
  let plan = C.attackPlan(C.loadState(), 'wren', 'gob3', 'shortbow');
  expect('sneak attack applies with an ally next to the target', plan.sneak === '2d6', JSON.stringify(plan));
  r = run('attack', 'rook', 'gob3', 'longsword');
  ti = C.turnInfo(C.loadState(), 'rook');
  expect('an attack spends the action and logs roll data', r.ok && ti.action && typeof C.readLog().pop().data.nat === 'number', r.out);
  C.appendIntent({ id: 'q0000001', t: Date.now(), player: 'sam', creature: 'wren', kind: 'auto', quiet: true, text: 'Wren moves K9 → K8.' });
  r = run('listen', '--timeout', '1');
  expect('quiet actions alone do not wake listen', /TIMEOUT/.test(r.out), r.out);
  C.appendIntent({ id: 'l0000001', t: Date.now(), player: 'sam', creature: 'wren', kind: 'auto', quiet: false, text: 'Wren attacks.' });
  r = run('listen', '--timeout', '3');
  expect('a loud action wakes listen with the quiet ones bundled', /moves K9/.test(r.out) && /Wren attacks/.test(r.out), r.out);
  C.saveSeats({ sam: { token: 'test-code-11', creatures: ['wren'] } });
  r = run('offer', 'sam', 'Climb the cliff?', '--skill', 'athletics', '--dc', '13', '--about', 'climb', '--success', 'up', '--fail', 'falls');
  const off = C.readOffers().pop();
  expect('offer records terms for the player', r.ok && off.player === 'sam' && off.ruling.dc === 13 && !off.answer, r.out);
  for (const f of [C.SEATS, C.INTENTS]) if (fs.existsSync(f)) fs.unlinkSync(f);
  run('seat', 'sam', 'wren');
  run('load', 'rope-bridge');
  expect('seats survive a reload', C.loadState().creatures.wren.player === 'sam', '');
  r = run('unseat', 'sam');
  expect('unseat revokes the link', r.ok && !C.loadSeats().sam && !C.loadState().creatures.wren.player, r.out);
} finally {
  for (const f of FILES) { if (backup[f]) fs.writeFileSync(f, backup[f]); else if (fs.existsSync(f)) fs.unlinkSync(f); }
}
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
