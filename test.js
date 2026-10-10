// Smoke tests for the engine. Run: node test.js
// Uses a scratch copy of state so it won't clobber a game in progress.
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const C = require('./lib/core');
const R = require('./lib/rules');
const P = require('./lib/power');
const Chars = require('./lib/chars');

const backup = {};
const FILES = [C.STATE, C.LOG, C.SEATS, C.INTENTS, C.LISTEN, Chars.PLAYERS];
const madeChars = [];
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

  // ---------- character builder ----------
  console.log('\ncharacter builder');
  // The starter party, rebuilt from choices, should match the hand-written sheets in the encounter.
  const party = {
    rook: { name: 'Rook', level: 3, species: 'human', class: 'fighter', subclass: 'battle-master', background: 'soldier', bgBonus: { str: 2, con: 1 },
      abilities: { method: 'pointbuy', base: { str: 14, dex: 12, con: 13, int: 10, wis: 12, cha: 10 } },
      picks: { 'species-skill': ['perception'], 'species-feat': ['lucky'], skills: ['history', 'survival'], 'fighting-style': ['protection'], maneuvers: ['precision-attack', 'parry', 'riposte'], 'student-of-war': ['insight'] },
      gear: { armor: 'chain-mail', shield: true, weapons: ['longsword', 'javelin'] } },
    wren: { name: 'Wren', level: 3, species: 'halfling', class: 'rogue', subclass: 'thief', background: 'charlatan', bgBonus: { dex: 2, cha: 1 },
      abilities: { method: 'pointbuy', base: { str: 8, dex: 14, con: 12, int: 13, wis: 12, cha: 13 } },
      picks: { 'bg-feat:skills': ['acrobatics', 'perception', 'stealth'], skills: ['insight', 'investigation', 'athletics', 'intimidation'], expertise: ['stealth', 'investigation'] },
      gear: { armor: 'leather', weapons: ['shortbow', 'shortsword'] } },
    ash: { name: 'Brother Ash', level: 3, species: 'dwarf', class: 'cleric', subclass: 'life', background: 'acolyte', bgBonus: { wis: 2, cha: 1 },
      abilities: { method: 'manual', base: { str: 14, dex: 10, con: 14, int: 10, wis: 14, cha: 11 } },
      picks: { 'divine-order': ['protector'], skills: ['medicine', 'history'], cantrips: ['sacred-flame', 'guidance', 'light'], spells: ['healing-word', 'shield-of-faith', 'spiritual-weapon', 'hold-person', 'guiding-bolt', 'sanctuary'], 'bg-feat:cantrips': ['spare-the-dying', 'thaumaturgy'], 'bg-feat:spell': ['command'] },
      gear: { armor: 'chain-mail', shield: true, weapons: ['mace'] } },
  };
  const enc = JSON.parse(fs.readFileSync('encounters/rope-bridge.json', 'utf8')).creatures;
  for (const [id, b] of Object.entries(party)) {
    const dv = R.derive(b), want = enc[id], got = dv.creature;
    const diffs = [];
    // Wren's sheet has 20 HP; the rules give 21 (8 + 5 + 5 + CON +1 x 3): the hand-written sheet is one short.
    if (got.hp !== want.hp && !(id === 'wren' && got.hp === 21)) diffs.push(`hp ${got.hp} vs ${want.hp}`);
    if (got.ac !== want.ac) diffs.push(`ac ${got.ac} vs ${want.ac}`);
    for (const k of Object.keys(want.stats)) if (got.stats[k] !== want.stats[k]) diffs.push(`${k} ${got.stats[k]} vs ${want.stats[k]}`);
    for (const [k, v] of Object.entries(want.saves)) if (got.saves[k] !== v) diffs.push(`save ${k} ${got.saves[k]} vs ${v}`);
    for (const [k, v] of Object.entries(want.skills)) if (got.skills[k] !== v) diffs.push(`skill ${k} ${got.skills[k]} vs ${v}`);
    for (const a of want.attacks) {
      const m = got.attacks.find((x) => x.name === a.name && !!x.range === !!a.range) || got.attacks.find((x) => a.range && x.name === a.name + ' (thrown)');
      if (!m || m.bonus !== a.bonus || m.damage !== a.damage) diffs.push(`attack ${a.name}: ${m ? m.bonus + ' ' + m.damage : 'missing'} vs ${a.bonus} ${a.damage}`);
    }
    expect(`builder reproduces ${want.name}'s sheet`, !diffs.length && !dv.errors.length && !dv.todo.length, diffs.concat(dv.errors.map((e) => e.msg), dv.todo.map((t) => t.msg)).join('; '));
  }
  expect('hand-entered scores wait for the DM', R.derive(party.ash).status === 'needs-dm', R.derive(party.ash).status);
  expect('features the engine reads come through', R.derive(party.wren).creature.features.includes('Sneak Attack +2d6') && C.featuresOf(R.derive(party.wren).creature).cunningAction, JSON.stringify(R.derive(party.wren).creature.features));
  // Every class and subclass, at several levels, filled with recommended picks, comes out complete.
  const broken = [];
  for (const [cid, cls] of Object.entries(R.CLASSES)) for (const sub of Object.keys(cls.subclasses)) for (const lv of [1, 3, 5, 11, 20]) {
    const b = R.recommend({ name: 'T', level: lv, class: cid, subclass: lv >= 3 ? sub : null, species: 'human' });
    const dv = R.derive(b);
    if (dv.status !== 'ready') broken.push(`${cid}/${sub} ${lv}: ${[...dv.errors.map((e) => e.msg), ...dv.todo.map((t) => t.msg)].join(' ')}`);
    if (!(dv.creature.hp > 0) || !(dv.creature.ac >= 10)) broken.push(`${cid} ${lv}: hp ${dv.creature.hp} ac ${dv.creature.ac}`);
  }
  expect('recommended builds are complete for every class, subclass and level', !broken.length, broken.slice(0, 5).join('\n       '));
  const bad = R.derive(Object.assign({}, party.rook, { abilities: { method: 'standard', base: { str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 } } }));
  expect('the standard array is enforced', bad.errors.some((e) => e.step === 'abilities'), JSON.stringify(bad.errors));
  // Power: official content priced with the vocabulary sits within its budget and the creep allowance.
  const offScale = P.BENCHMARKS.filter((b) => !b.weak).map((b) => [b.name, P.benchCost(b) / P.SLOTS[b.slot].budget]).filter(([, x]) => x < 0.6 || x > 1 + P.DEFAULTS.creep);
  expect('official benchmarks sit inside their budgets', !offScale.length, JSON.stringify(offScale));
  const sneaky = [{ kind: 'skill', skill: 'stealth' }, { kind: 'advantage', scope: 'skill', text: 'Stealth in dim light' }, { kind: 'minor', text: 'blend into crowds' }];
  const strong = P.rate({ slot: 'origin-feat', effects: [{ kind: 'ac', value: 2 }] }, { level: 3 });
  const fine = P.rate({ slot: 'origin-feat', effects: sneaky }, { level: 3 });
  expect('homebrew over budget needs the DM; on par does not', strong.verdict === 'over' && strong.needsDm && !fine.needsDm && ['fair', 'creep', 'under'].includes(fine.verdict), `${strong.verdict} ${fine.verdict} ${fine.cost}`);
  // Storage, suggestions and the DM's commands.
  C.saveSeats({});
  const tester = Chars.register('test-player-x');
  expect('a new player gets a code', !!tester.code && Chars.profileByCode(tester.code).name === 'test-player-x', JSON.stringify(tester));
  const ch = Chars.create(tester.name, 'Testy McTest', 3);
  madeChars.push(ch.id);
  ch.build = Chars.mergeBuild(ch.build, Object.assign({}, party.rook, { name: 'Testy McTest',
    abilities: Object.assign({}, party.rook.abilities, { rolls: [18, 18, 18, 18, 18, 18], approved: true }),
    homebrew: [{ id: 'hb1', name: 'Shadowstep', slot: 'origin-feat', text: 'Sneaky.', effects: sneaky, status: 'approved' }] }));
  expect('players can\'t forge rolls or approvals', !ch.build.abilities.rolls && !ch.build.abilities.approved && ch.build.homebrew[0].status === 'draft', JSON.stringify([ch.build.abilities, ch.build.homebrew[0].status]));
  expect('on-par homebrew is usable without the DM', !Chars.useHomebrew(ch, 'hb1').error && ch.build.homebrew[0].status === 'auto', ch.build.homebrew[0].status);
  Chars.save(ch);
  r = run('suggest', ch.id, 'Try Alert instead of Lucky: you act first and set up your allies.', '--patch', '{"picks.species-feat":["alert"]}');
  const sg = Chars.load(ch.id).suggestions[0];
  expect('suggest records a suggestion with a patch', r.ok && sg && sg.status === 'open' && sg.patch['picks.species-feat'][0] === 'alert' && /init 1→3/.test(r.out), r.out);
  let c2 = Chars.load(ch.id);
  Chars.answerSuggestion(tester.name, c2, sg.id, 'discuss', 'Does Alert stack with anything?');
  Chars.save(c2);
  r = run('listen', '--timeout', '3');
  expect('builder messages wake listen', /builder:testy-mctest/.test(r.out) && /Does Alert stack/.test(r.out), r.out);
  run('char', ch.id, 'reply', sg.id, 'It adds your proficiency bonus to initiative.');
  c2 = Chars.load(ch.id);
  expect('the DM can answer in the suggestion thread', c2.suggestions[0].thread.length === 2 && c2.suggestions[0].thread[1].who === 'dm', JSON.stringify(c2.suggestions[0].thread));
  Chars.answerSuggestion(tester.name, c2, sg.id, 'accept'); Chars.save(c2);
  c2 = Chars.load(ch.id);
  expect('accepting applies the change', c2.build.picks['species-feat'][0] === 'alert' && Chars.derive(c2).creature.initBonus === 3, JSON.stringify(c2.build.picks['species-feat']));
  c2.build.homebrew.push({ id: 'hb2', name: 'Iron Hide', slot: 'origin-feat', text: '+2 AC', effects: [{ kind: 'ac', value: 2 }], status: 'draft' });
  expect('over-budget homebrew is refused automatic use', !!Chars.useHomebrew(c2, 'hb2').error, '');
  Chars.sendHomebrew(tester.name, c2, 'hb2', 'I want to be a wall'); Chars.save(c2);
  expect('sent homebrew waits for the DM', Chars.derive(c2).status === 'needs-dm', Chars.derive(c2).status);
  r = run('char', ch.id, 'decline', 'hb2', 'Too much at 3rd level; try +1 AC while you have a shield.');
  expect('the DM can decline with a reason', r.ok && Chars.load(ch.id).build.homebrew[1].status === 'declined', r.out);
  r = run('suggest', ch.id, 'Here is a version that works.', '--patch', '{"homebrew.hb2":{"name":"Iron Hide","slot":"origin-feat","text":"+1 AC while you hold a shield.","effects":[{"kind":"ac","value":1,"when":"often"}]},"picks.species-feat":["hb:hb2"]}');
  c2 = Chars.load(ch.id);
  Chars.answerSuggestion(tester.name, c2, c2.suggestions[1].id, 'accept'); Chars.save(c2);
  expect('a DM-written homebrew is approved on accept and applies', c2.build.homebrew[1].status === 'approved' && Chars.derive(c2).creature.ac === 19, `${c2.build.homebrew[1].status} ac ${Chars.derive(c2).creature.ac}`);
  run('load', 'rope-bridge');
  C.saveSeats({ 'test-player-x': { token: tester.code, creatures: [] } });
  r = run('char', ch.id, 'spawn', 'G8');
  const sp = C.loadState().creatures[ch.id];
  expect('a ready character joins the encounter, seated to its owner', r.ok && sp && sp.pos === 'G8' && sp.player === 'test-player-x' && C.loadSeats()['test-player-x'].creatures.includes(ch.id), r.out);
  C.saveSeats({});
  r = run('seat', 'test-player-x', ch.id);
  expect('seating reuses the player\'s sign-in code', C.loadSeats()['test-player-x'].token === tester.code, r.out);
} finally {
  for (const id of madeChars) { const f = require('path').join(Chars.DIR, id + '.json'); if (fs.existsSync(f)) fs.unlinkSync(f); }
  for (const f of FILES) { if (backup[f]) fs.writeFileSync(f, backup[f]); else if (fs.existsSync(f)) fs.unlinkSync(f); }
}
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
