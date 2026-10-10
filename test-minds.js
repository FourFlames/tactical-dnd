// Tests for NPC minds (lib/minds.js): the scenarios and invariants from docs/stealth.md.
// Run: node test-minds.js   (backs up and restores any game in progress, like test.js)
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const C = require('./lib/core');

const FILES = [C.STATE, C.LOG, C.SEATS, C.INTENTS, C.LISTEN];
const backup = {};
for (const f of FILES) if (fs.existsSync(f)) backup[f] = fs.readFileSync(f);

let pass = 0, failed = 0;
function run(...args) {
  const r = spawnSync('node', ['engine.js', ...args], { cwd: __dirname, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}
function expect(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}\n       ${String(detail).slice(0, 600)}`); }
}
const S = () => C.loadState();
const M = (id) => S().minds[id];
// Edit the scratch game directly to set up a scenario (tests only; the DM never does this).
function setup(fn) { const s = S(); fn(s); C.saveState(s); }
const brief = (id) => run('mind', id, 'brief').out;
const decide = (id, obj) => run('mind', id, 'decide', JSON.stringify(obj));

try {
  // ---------- loading ----------
  let r = run('load', 'tollhouse');
  expect('tollhouse loads with five minds', r.ok && /bram, tilly, fang, hask, morrow/.test(r.out), r.out);
  expect('nobody starts alarmed (party is behind the hedge)', Object.values(S().minds).every((m) => m.alarm.level === 'routine'), JSON.stringify(Object.values(S().minds).map((m) => [m.id, m.alarm.level])));
  expect('comrades are tracked by sight (Bram sees Fang)', M('bram').tracks.fang && M('bram').tracks.fang.inView, JSON.stringify(M('bram').tracks));
  expect('the captain sees no one from the office', Object.keys(M('morrow').tracks).length === 0, JSON.stringify(M('morrow').tracks));

  // ---------- invariant: briefs hold no hidden truth ----------
  let b = brief('morrow');
  expect('brief never names the party', !/wren|rook|halfling|chain mail/i.test(b), b.slice(0, 400));
  expect('brief never shows creature positions it hasn\'t perceived', !/B11|A12|S6/.test(b.split('MAP YOU KNOW')[0]), b.split('MAP YOU KNOW')[0]);
  expect('brief has the answer format and a version', /HOW TO ANSWER/.test(b) && /brief v\d+/.test(b), b.slice(-300));

  // ---------- Scenario A: lost visual contact ----------
  run('load', 'tollhouse');
  run('place', 'wren', 'H13'); // in Bram's torchlight, in front of him
  r = run('move', 'wren', 'H12');
  let bm = M('bram');
  let key = Object.values(bm.tracks).find((t) => t.side === 'hostile' || t.side === 'unknown');
  expect('A: Bram sees the intruder in his torchlight', key && key.inView, JSON.stringify(bm.tracks) + r.out);
  // she slips away behind the hedge, quietly (a scripted jump: perception runs on the next command)
  setup((s) => Object.assign(s.creatures.wren, { pos: 'A11', hidden: true, stealth: 25 }));
  run('roll', '1d4');
  bm = M('bram');
  const tr = bm.tracks[key.key];
  expect('A: losing sight is recorded as an observation', bm.obs.some((o) => o.kind === 'lost' && o.subject === key.key), JSON.stringify(bm.obs.slice(-3)));
  expect('A: the track keeps the last SEEN square, not her real one', tr && !tr.inView && tr.cell !== 'A11', JSON.stringify(tr));
  run('tick'); run('tick');
  b = brief('bram');
  expect('A: the brief offers a region she could be in, not her square', /could be anywhere in \d+ squares/.test(b) && !/A11/.test(b.split('MAP YOU KNOW')[0]), b.split('WHAT YOU HAVE PERCEIVED')[0].slice(-600));

  // ---------- Scenario B: secondhand report ----------
  run('load', 'tollhouse');
  run('place', 'wren', 'H13');
  run('move', 'wren', 'H12');
  bm = M('bram');
  key = Object.values(bm.tracks).find((t) => t.side !== 'ally');
  r = decide('bram', { version: S().mseq, say: [{ to: 'all', channel: 'shout', kind: 'warning', text: 'Someone by the path!', about: { subject: key.key, at: key.cell } }] });
  expect('B: Bram\'s shout is heard by the sergeant inside', /Sergeant Hask/.test(r.out), r.out);
  const hk = M('hask');
  const rep = Object.values(hk.tracks).find((t) => !t.direct);
  expect('B: Hask gets a REPORTED track, not a sighting', rep && rep.direct === false && /reported by Bram/.test(rep.label), JSON.stringify(hk.tracks));
  expect('B: Hask has the message as evidence, with its source', hk.obs.some((o) => o.kind === 'message' && o.from === 'bram'), JSON.stringify(hk.obs.slice(-2)));
  expect('B: Hask has no visual observation of the intruder', !hk.obs.some((o) => o.kind === 'sight'), JSON.stringify(hk.obs));
  expect('B: the party overhears the shout in the chronicle', C.readLog(50).some((e) => e.type === 'narration' && /hear/.test(e.text) && /Someone by the path/.test(e.text)), JSON.stringify(C.readLog(10)));

  // ---------- Scenario C: conflicting sightings ----------
  setup((s) => { s.minds.tilly.alarm.intensity = 30; });
  r = decide('tilly', { version: S().mseq, say: [{ to: ['hask'], channel: 'shout', kind: 'report', text: 'I saw someone at the back door!', about: { at: 'S4' } }] });
  const hk2 = M('hask');
  const reps = Object.values(hk2.tracks).filter((t) => !t.direct);
  expect('C: two incompatible reports are both kept', reps.length >= 2 && new Set(reps.map((t) => t.cell)).size >= 2, JSON.stringify(reps));
  b = brief('hask');
  expect('C: the brief shows both, each with its source', /reported by Bram/.test(b) && /reported by Tilly/.test(b), b.split('WHAT YOU HAVE PERCEIVED')[0]);

  // ---------- Scenario D: same evidence, different temperaments ----------
  run('load', 'tollhouse');
  setup((s) => {
    s.creatures.tilly.pos = 'N12'; s.creatures.bram.pos = 'H12';
    s.minds.tilly.disposition.curiosity = 0.9; s.minds.tilly.disposition.vigilance = 0.9; s.minds.tilly.profile.patrol = null; s.minds.tilly.profile.post = 'N12';
    s.minds.bram.disposition.curiosity = 0.1; s.minds.bram.disposition.vigilance = 0.1;
    s.minds.bram.facing = 'E'; s.minds.tilly.facing = 'W';
  });
  run('noise', 'K13', 'a clatter', '--loud', '40');
  run('tick');
  const tPlan = M('tilly').intentions[0], bPlan = M('bram').intentions[0];
  expect('D: both heard it', M('tilly').obs.some((o) => o.kind === 'sound') && M('bram').obs.some((o) => o.kind === 'sound'), JSON.stringify([M('tilly').obs, M('bram').obs]));
  expect('D: the curious one goes to look, the incurious one only watches', /investigate/.test(JSON.stringify(tPlan.plan)) && !/investigate/.test(JSON.stringify(bPlan.plan)), JSON.stringify([tPlan, bPlan]));

  // ---------- Scenario E: orders go through the chain of command, and can be declined ----------
  run('load', 'tollhouse');
  r = decide('hask', { version: S().mseq, orders: [{ to: 'bram', objective: 'Bram! Check the hedges by the path.', plan: [{ do: 'investigate', at: 'C12' }], channel: 'shout' }] });
  expect('E: a sergeant can order a guard', /order ord\d+ to bram/.test(r.out), r.out);
  let bo = M('bram').orders[0];
  expect('E: the order arrives as received, not obeyed', bo && bo.status === 'received' && /hedges/.test(bo.objective), JSON.stringify(M('bram').orders));
  r = decide('bram', { version: S().mseq, orderResponses: [{ order: bo.id, response: 'decline', reply: 'Can\'t leave the door, Sarge!' }] });
  expect('E: the guard can decline, and says so', /declined/.test(r.out) && /acknowledgement/.test(r.out), r.out);
  expect('E: the order stays on record as declined', M('bram').orders[0].status === 'declined', JSON.stringify(M('bram').orders));
  expect('E: the sergeant hears the refusal', M('hask').obs.some((o) => o.kind === 'message' && /leave the door/.test(o.content)), JSON.stringify(M('hask').obs.slice(-2)));
  r = decide('bram', { version: S().mseq, orders: [{ to: 'hask', objective: 'go away' }] });
  expect('E: a guard cannot order his sergeant', /don't answer to you/.test(r.out), r.out);

  // ---------- Scenario F: false alarm de-escalates ----------
  run('load', 'tollhouse');
  run('noise', 'K12', 'a crash', '--loud', '60');
  const peak = M('bram').alarm.intensity;
  for (let i = 0; i < 6; i++) run('tick');
  const fb = M('bram');
  expect('F: Bram went to look and searched', fb.obs.some((o) => o.kind === 'search'), JSON.stringify(fb.obs.map((o) => o.text)));
  expect('F: alarm comes back down after finding nothing', fb.alarm.intensity < peak && fb.alarm.level === 'routine', `${peak} → ${fb.alarm.intensity} ${fb.alarm.level}`);

  // ---------- Scenario G: model failure ----------
  run('load', 'tollhouse');
  const before = JSON.stringify(S().creatures);
  r = decide('bram', { version: 1, beliefs: [{ proposition: 'x', evidence: ['o999'] }], intention: { objective: 'kill', plan: [{ do: 'attack', target: 'wren' }, { do: 'fly', to: 'Z99' }] }, now: { do: 'move', to: 'Q99' } });
  expect('G: invalid parts are rejected with reasons', /never had: o999/.test(r.out) && /don't know of anything called "wren"/.test(r.out) && /isn't a square/.test(r.out), r.out);
  expect('G: the world is untouched', JSON.stringify(S().creatures) === before, 'creatures changed');
  expect('G: a rejected decision leaves the NPC needing thought', M('bram').pending.some((p) => /rejected/.test(p.why)), JSON.stringify(M('bram').pending));
  r = run('mind', 'bram', 'decide', '{not json');
  expect('G: garbage is refused, with the fallback suggested', !r.ok && /fallback/.test(r.out), r.out);
  r = run('mind', 'bram', 'fallback');
  expect('G: the deterministic fallback always yields a plan', r.ok && /Stand watch|Check out|Walk/.test(r.out), r.out);

  // ---------- stale decisions ----------
  run('load', 'tollhouse');
  const v = S().mseq || 0;
  run('noise', 'H13', 'a cough', '--loud', '30');
  r = decide('bram', { version: v, intention: { objective: 'stand', plan: [{ do: 'guard', at: 'G11' }] }, now: { do: 'move', to: 'G12' } });
  expect('stale: a decision made before new evidence keeps its plan but drops "now"', /STALE/.test(r.out) && /dropped/.test(r.out) && /intention/.test(r.out), r.out);

  // ---------- stealth vs passive Perception, light, plain sight ----------
  run('load', 'tollhouse');
  run('sneak', 'wren', '--total', '25');
  run('place', 'wren', 'K13');
  r = run('move', 'wren', 'L13');
  expect('a well-hidden creature in the dark passes unnoticed', !Object.values(M('bram').tracks).some((t) => t.side !== 'ally'), JSON.stringify(M('bram').tracks));
  run('place', 'wren', 'G12');
  r = run('move', 'wren', 'G13');
  expect('...but not in plain sight, in torchlight, right in front of a guard', !S().creatures.wren.hidden && Object.values(M('bram').tracks).some((t) => t.side === 'hostile' && t.inView), r.out);

  // ---------- the dog: sleeping, woken by noise, smells intruders ----------
  run('load', 'tollhouse');
  expect('Fang starts asleep', C.hasCond(S().creatures.fang, 'asleep'), '');
  run('noise', 'M12', 'a pot breaking', '--loud', '30');
  expect('a nearby noise wakes him', !C.hasCond(S().creatures.fang, 'asleep'), JSON.stringify(S().creatures.fang.conditions));
  run('sneak', 'wren', '--total', '30');
  run('place', 'wren', 'K8');
  run('move', 'wren', 'K9');
  expect('...and he smells a hidden intruder through a wall', M('fang').obs.some((o) => o.kind === 'scent'), JSON.stringify(M('fang').obs.map((o) => o.text)));

  // ---------- doors: NPCs open them, notice them, keys and locks ----------
  run('load', 'tollhouse');
  r = run('door', 'back', 'open');
  expect('a locked door refuses', !r.ok && /locked/.test(r.out), r.out);
  r = run('door', 'back', 'open', '--by', 'morrow');
  expect('...but opens for whoever holds the key', r.ok, r.out);
  run('load', 'tollhouse');
  r = decide('hask', { version: S().mseq, intention: { objective: 'go out front', plan: [{ do: 'move', to: 'I8' }] } });
  run('tick');
  expect('NPCs open doors on their way', S().walls.find((w) => w.id === 'store').open && S().creatures.hask.pos !== 'K3', S().creatures.hask.pos);
  run('load', 'tollhouse');
  run('door', 'front', 'open');
  expect('a guard notices a door that was shut is now open', M('bram').obs.some((o) => /front.*OPEN/.test(o.text)), JSON.stringify(M('bram').obs.map((o) => o.text)));

  // ---------- party view: unseen NPC moves stay secret; cues show ----------
  run('load', 'tollhouse');
  run('tick');
  const pv = C.view(S(), 'player');
  expect('Tilly\'s patrol behind the building is not in the player chronicle', !pv.log.some((e) => /Tilly moves/.test(e.text)), JSON.stringify(pv.log.map((e) => e.text)));
  expect('...but is in the DM log', C.view(S(), 'dm').log.some((e) => /Tilly moves/.test(e.text)), '');

  // ---------- combat hand-off ----------
  run('load', 'tollhouse');
  run('place', 'rook', 'G13');
  r = run('tick');
  expect('tick stops for initiative when a guard means to fight', /COMBAT|initiative/.test(r.out), r.out);
  run('initiative');
  r = run('mind', 'bram', 'act');
  expect('in combat, "mind <id> act" fights through the engine', r.ok && /attack|Spear|Intruder/.test(r.out), r.out);

  // ---------- an order is a destination, not a sighting ----------
  run('load', 'goblin-warren-caves');
  r = decide('snikka', { version: S().mseq, orders: [{ to: 'gob7', objective: 'Back Pip up at the crack mouth', plan: [{ do: 'guard', at: 'K17', facing: 'S' }], at: 'K17', channel: 'shout' }] });
  expect('orders: Snikka can order Gix', /order ord\d+ to gob7/.test(r.out), r.out);
  const overheard = Object.values(M('gob5').tracks).filter((t) => !M('gob5').roster[t.key]);
  expect('orders: an overheard order creates no track for bystanders', overheard.length === 0, JSON.stringify(overheard));
  expect('orders: the addressed goblin gets no phantom track either', !Object.values(M('gob7').tracks).some((t) => t.cell === 'K17' && !t.direct), JSON.stringify(M('gob7').tracks));
  run('mind', 'gob7', 'fallback');
  const gix = S().minds.gob7.intentions[0];
  expect('orders: the fallback follows an accepted order', gix && gix.plan.some((st) => st.do === 'guard' && st.at === 'K17'), JSON.stringify(gix));
  run('mind', 'gob5', 'fallback');
  const look = S().minds.gob5.intentions[0];
  expect('orders: a bystander keeps to its own business', look && !look.plan.some((st) => st.at === 'K17'), JSON.stringify(look));

  // ---------- speech uses place names, never grid squares ----------
  run('load', 'goblin-warren-caves');
  run('place', 'rook', 'M23');
  r = decide('gob4', { version: S().mseq, say: [{ to: 'all', channel: 'shout', kind: 'warning', text: 'Stranger down past K29! Hold L18!' }] });
  const heardLine = fs.readFileSync(C.LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type === 'narration' && /hear/.test(e.text)).pop();
  expect('speech: the party hears place names, not squares', heardLine && /the west gap/.test(heardLine.text) && /the crack mouth/.test(heardLine.text) && !/K29|L18/.test(heardLine.text), heardLine ? heardLine.text : r.out);
  const snik = M('snikka').obs.filter((o) => o.kind === 'message').pop();
  expect('speech: NPC listeners hear the same words', snik && /the west gap/.test(snik.text) && !/K29/.test(snik.text), JSON.stringify(snik));

  // ---------- the npc agent is fenced in ----------
  const hook = (cmd) => spawnSync('node', ['.claude/hooks/npc-guard.js'], { cwd: __dirname, input: JSON.stringify({ tool_input: { command: cmd } }) }).status;
  expect('npc agent may read its brief', hook('node engine.js mind bram brief') === 0, '');
  expect('npc agent may not read the state or the map', hook('cat state.json') === 2 && hook('node engine.js show') === 2 && hook('node engine.js mind bram brief; cat state.json') === 2, '');

  // ---------- encounters without minds are untouched ----------
  r = run('load', 'rope-bridge');
  expect('old encounters have no minds and no mind output', r.ok && !S().minds && !/minds/.test(r.out), r.out);
} finally {
  for (const f of FILES) {
    if (backup[f]) fs.writeFileSync(f, backup[f]);
    else if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
