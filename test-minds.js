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
  expect('A: the brief offers a region she could be in, not her square', /could have reached: \d+ squares/.test(b) && !/A11/.test(b.split('MAP YOU KNOW')[0]), b.split('WHAT YOU HAVE PERCEIVED')[0].slice(-600));

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
  expect('B: Hask gets a REPORTED track, not a sighting', rep && rep.direct === false && /reported by .*Bram/.test(rep.label), JSON.stringify(hk.tracks));
  expect('B: Hask has the message as evidence, with its source (through the walls: muffled, the voice only maybe Bram\'s)', hk.obs.some((o) => o.kind === 'message' && /Bram/.test(o.fromLabel) && /muffled/.test(o.text)), JSON.stringify(hk.obs.slice(-2)));
  expect('B: Hask has no visual observation of the intruder', !hk.obs.some((o) => o.kind === 'sight'), JSON.stringify(hk.obs));
  expect('B: the party overhears the shout in the chronicle', C.readLog(50).some((e) => e.type === 'narration' && /hear/.test(e.text) && /Someone by the path/.test(e.text)), JSON.stringify(C.readLog(10)));

  // ---------- Scenario C: conflicting sightings ----------
  setup((s) => { s.minds.tilly.alarm.intensity = 30; });
  r = decide('tilly', { version: S().mseq, say: [{ to: ['hask'], channel: 'shout', kind: 'report', text: 'I saw someone at the back door!', about: { at: 'S4' } }] });
  const hk2 = M('hask');
  const reps = Object.values(hk2.tracks).filter((t) => !t.direct);
  expect('C: two incompatible reports are both kept', reps.length >= 2 && new Set(reps.map((t) => t.cell)).size >= 2, JSON.stringify(reps));
  b = brief('hask');
  expect('C: the brief shows both, each with its source', /Bram/.test(b.split('WHAT YOU HAVE PERCEIVED')[0]) && /Tilly/.test(b.split('WHAT YOU HAVE PERCEIVED')[0]), b.split('WHAT YOU HAVE PERCEIVED')[0]);

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
  expect('E: the order arrives as received, not obeyed', bo && bo.status === 'received', JSON.stringify(M('bram').orders));
  r = decide('bram', { version: S().mseq, orderResponses: [{ order: bo.id, response: 'decline', reply: 'Can\'t leave the door, Sarge!' }] });
  expect('E: the guard can decline, and says so', /declined/.test(r.out) && /acknowledgement/.test(r.out), r.out);
  expect('E: the order stays on record as declined', M('bram').orders[0].status === 'declined', JSON.stringify(M('bram').orders));
  expect('E: the sergeant hears the refusal (muffled through the walls)', M('hask').obs.some((o) => o.kind === 'message' && o.msgKind === 'acknowledgement' && /Can't/.test(o.content)), JSON.stringify(M('hask').obs.slice(-2)));
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

  // ---------- forgiving decisions: the slips cheap models make in practice ----------
  run('load', 'goblin-warren-caves');
  run('place', 'rook', 'M21');
  run('roll', '1d4'); // let Pip take in the stranger
  const pipKey = Object.values(M('gob4').tracks).find((t) => t.side === 'hostile');
  brief('gob4');
  r = decide('gob4', { version: S().mseq, intention: { objective: 'stab it', plan: [{ do: 'attack', target: '1' }] } });
  expect('lenient: a map mark ("1") is read as the track key', pipKey && new RegExp(`"1" read as ${pipKey.key}`).test(r.out) && !/rejected/.test(r.out), r.out);
  r = decide('gob4', { version: S().mseq, intention: { objective: 'run to the boss', plan: [{ do: 'move', to: "the boss's corner" }] } });
  expect('lenient: a place name works as a square', /read as L12/.test(r.out) && /move to L12/.test(r.out), r.out);
  r = decide('gob4', { version: S().mseq, intention: { objective: 'hide by the fire', plan: [{ do: 'guard', at: 'J14' }] } });
  expect('lenient: an unstandable square snaps to a neighbour', /J14 can't be stood on/.test(r.out) && !/rejected/.test(r.out), r.out);
  r = decide('snikka', { version: S().mseq, say: [{ to: ['gob7'], channel: 'shout', kind: 'order', text: 'Gix, hold the crack mouth!' }] });
  expect('lenient: an order filed under "say" goes out as an order', /order ord\d+ to gob7/.test(r.out) && M('gob7').orders.some((o) => /hold the crack mouth/.test(o.objective)), r.out);
  r = decide('gob6', { version: S().mseq, intention: { objective: 'tell the boss', plan: [{ do: 'say', to: ['snikka'], channel: 'speech', kind: 'report', text: 'Singing by the crack!', about: { subject: 'stranger-singer', at: 'L19:N23' } }] } });
  expect('lenient: a made-up subject and a range in "about" still let the plan through', /isn't a track/.test(r.out) && /read as M21/.test(r.out) && /intention i\d+/.test(r.out), r.out);
  run('load', 'goblin-warren-caves');
  r = decide('snikka', { version: S().mseq,
    orders: [{ to: 'gob6', objective: 'Hold the cookfire.', plan: [{ do: 'guard', at: 'I13', facing: 'W' }], at: 'I13' }, { to: 'gob7', objective: 'Hold the cookfire.', plan: [{ do: 'guard', at: 'K15', facing: 'W' }], at: 'K15' }],
    say: [{ to: ['gob6', 'gob7'], channel: 'shout', kind: 'order', text: 'Nub, Gix, stay at the fire and watch west!' }] });
  const nubO = M('gob6').orders.filter((o) => o.status !== 'superseded'), gixO = M('gob7').orders.filter((o) => o.status !== 'superseded');
  expect('lenient: an order both given and said is one order, with its plan and the spoken words', nubO.length === 1 && gixO.length === 1 && gixO[0].at === 'K15' && gixO[0].plan && /watch west/.test(gixO[0].objective), JSON.stringify([nubO, gixO]) + r.out);
  b = brief('gob4');
  expect('brief: places are named next to squares', /\(the crack mouth\)|\(the bottom of the crack\)|\(the crack\)/.test(b) && /PLACES YOU KNOW/.test(b), b.slice(0, 1500));
  expect('brief: the warren brief stays short', b.length < 9000, `${b.length} chars`);

  // ---------- the engine thinks for OpenRouter minds itself (fetch stubbed: no key, no network) ----------
  run('load', 'goblin-warren-caves');
  run('place', 'rook', 'M21');
  const thinkScript = `
    const C = require('./lib/core'), Think = require('./lib/think');
    process.env.OPENROUTER_API_KEY = 'test';
    const seen = [];
    let n = 0;
    global.fetch = async (url, req) => {
      const body = JSON.parse(req.body); seen.push(body.model);
      const brief = body.messages[1].content, v = Number(/brief v(\\d+)/.exec(brief)[1]);
      n++;
      const dec = n === 1 ? { nonsense: true, intention: { objective: 'x', plan: [{ do: 'fly' }] } } // first answer unusable: retried
        : { version: v, alarm: 'combat', intention: { objective: 'Run to the boss', plan: [{ do: 'flee', to: "the boss's corner" }] }, say: [{ to: 'all', channel: 'shout', kind: 'warning', text: 'Stranger at M21!' }] };
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(dec) } }], usage: { prompt_tokens: 1000, completion_tokens: 100, cost: 0.0005 } }) };
    };
    (async () => {
      const s = C.loadState();
      const due = Think.due(s);
      await Think.think(s, ['gob4'], () => {});
      C.saveState(s);
      console.log(JSON.stringify({ due, seen, usage: s.mindStats.usage, plan: s.minds.gob4.intentions[0], pending: s.minds.gob4.pending }));
    })();`;
  const tr2 = spawnSync('node', ['-e', thinkScript], { cwd: __dirname, encoding: 'utf8' });
  let res = {};
  try { res = JSON.parse(tr2.stdout.trim().split('\n').pop()); } catch { res = { err: tr2.stdout + tr2.stderr }; }
  expect('think: minds on OpenRouter models (minions and the boss) are due to think', (res.due || []).includes('gob4') && (res.due || []).includes('snikka'), JSON.stringify(res));
  expect('think: an unusable answer is retried once', (res.seen || []).length === 2 && res.seen.every((x) => x === 'deepseek/deepseek-v4.1-flash'), JSON.stringify(res));
  expect('think: the decision lands as the mind\'s plan', res.plan && res.plan.source === 'model' && res.plan.plan.some((st) => st.do === 'flee' && st.to), JSON.stringify(res.plan));
  expect('think: tokens and cost are counted per model', res.usage && res.usage['deepseek/deepseek-v4.1-flash'].calls === 2 && res.usage['deepseek/deepseek-v4.1-flash'].prompt === 2000, JSON.stringify(res.usage));
  const shout = fs.readFileSync(C.LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => /Stranger at/.test(e.text)).pop();
  expect('think: what the model shouts uses place names', shout && /the crack/.test(shout.text) && !/M21/.test(shout.text), shout ? shout.text : 'no shout logged');
  run('load', 'goblin-warren-caves');
  decide('gob4', { version: S().mseq, say: [{ to: 'all', channel: 'shout', kind: 'warning', text: 'Stranger at M21!', about: { at: 'M21' } }] });
  const holdScript = `
    const C = require('./lib/core'), Minds = require('./lib/minds');
    const s = C.loadState();
    const held = Minds.intentionFor(s, 'gob8', { hold: true }), chased = Minds.intentionFor(s, 'gob8');
    console.log(JSON.stringify({ held, chased, pending: s.minds.gob8.pending.length }));`;
  const hr = spawnSync('node', ['-e', holdScript], { cwd: __dirname, encoding: 'utf8' });
  let hold = {};
  try { hold = JSON.parse(hr.stdout.trim()); } catch { hold = { err: hr.stdout + hr.stderr }; }
  expect('hold: a DeepSeek sentry who hears a shout mid-tick holds and watches', hold.held && hold.held.source === 'hold' && hold.held.plan[0].do === 'watch', JSON.stringify(hold));
  expect('hold: without hold it would have gone chasing', hold.chased && hold.chased.source === 'fallback' && hold.chased.plan.some((st) => st.do === 'investigate'), JSON.stringify(hold.chased));
  r = run('think');
  expect('think: without a key the command says so', !r.ok && /OPENROUTER_API_KEY/.test(r.out), r.out);

  // ---------- bodies: a question from afar, an answer up close ----------
  run('load', 'goblin-warren-caves');
  run('evidence', 'gob14', 'Throat torn out by one huge bite.');
  run('damage', 'gob14', '30', 'slashing');
  let grub = M('gob15'), seen = grub.obs.filter((o) => /Snore/.test(o.text));
  expect('bodies: from 25 ft Grub can\'t tell if Snore is asleep or dead', seen.length === 1 && /can't tell/.test(seen[0].text) && !/Throat/.test(seen[0].text) && grub.alarm.level !== 'combat', JSON.stringify([seen, grub.alarm]));
  run('move', 'gob15', 'D17');
  grub = M('gob15'); seen = grub.obs.filter((o) => /Snore/.test(o.text));
  expect('bodies: up close he sees Snore is dead, and how', seen.some((o) => /is dead/.test(o.text) && /Throat torn out/.test(o.text)), JSON.stringify(seen));

  // ---------- stories: known news is kept once; a second witness confirms it ----------
  run('load', 'goblin-warren-caves');
  run('place', 'gob15', 'H13'); run('place', 'gob4', 'J12'); // everyone within clear earshot of the cookfire
  const say = (id, text) => decide(id, { version: S().mseq, say: [{ to: 'all', channel: 'shout', kind: 'warning', text }] });
  say('gob15', 'Snore is dead in the sleeping nook, torn up by big claws!');
  const msgs = (id) => M(id).obs.filter((o) => o.kind === 'message').length;
  const before6 = msgs('gob6'), before7 = msgs('gob7');
  say('gob4', 'Grub says Snore is dead in the sleeping nook, torn up by big claws!');
  let nub = M('gob6');
  expect('stories: a relay of known news adds no new message', msgs('gob6') === before6 && msgs('gob7') === before7 && nub.claims[0].relays.includes('Pip'), JSON.stringify(nub.claims));
  expect('stories: gullible Nub takes the retelling as confirmation; sharp-eyed Gix doesn\'t', nub.claims[0].confirmed && !M('gob7').claims[0].confirmed, JSON.stringify([M('gob6').disposition, M('gob7').disposition]));
  r = say('gob15', 'Snore is dead in the sleeping nook, torn up by big claws!');
  expect('stories: nobody says the same thing twice', /not said again/.test(r.out), r.out);
  say('gob7', 'I saw it too: Snore dead in the nook, claws all over him!');
  nub = M('gob6');
  expect('stories: a second witness makes it "everyone\'s saying it"', nub.claims[0].sources.length === 2 && nub.obs.some((o) => o.kind === 'claim'), JSON.stringify(nub.claims));
  b = brief('gob6');
  expect('stories: the brief tells each story once, with how it spread', /STORIES GOING AROUND/.test(b) && /Passed on by Pip/.test(b), b.split('WHAT YOU HAVE PERCEIVED')[0].slice(-800));
  const site = Object.values(M('gob6').tracks).find((t) => t.static);
  expect('sites: news about a spot is pinned there, not tracked as a mover', !site || !/could have reached/.test(b.split('PLACES YOU HAVE NEWS')[1] || ''), b);

  // ---------- hearing: words, voices, and the people who fake them ----------
  run('load', 'goblin-warren-caves');
  decide('gob15', { version: S().mseq, say: [{ to: 'all', channel: 'shout', kind: 'warning', text: 'Snore is dead in the sleeping nook, torn up by big claws!' }] });
  const nubHeard = M('gob6').obs.filter((o) => o.kind === 'message').pop();
  expect('hearing: through rock, Nub catches only some of Grub\'s words', nubHeard && /…/.test(nubHeard.content) && /muffled/.test(nubHeard.text), JSON.stringify(nubHeard));
  setup((s) => Object.assign(s.creatures.wren, { pos: 'N18', hidden: true, stealth: 30 })); // in the rubble: heard, not seen
  r = run('speak', 'wren', "It's me, Grub! Don't shoot, I'm coming back to the fire!", '--channel', 'shout', '--as', 'gob15', '--deception', '25');
  const fooled = M('gob7').obs.filter((o) => o.kind === 'message').pop();
  expect('voices: a good enough fake fools a goblin who hears it clearly', r.ok && fooled && fooled.from === 'gob15' && /Grub/.test(fooled.fromLabel), r.out + JSON.stringify(fooled));
  run('load', 'goblin-warren-caves');
  setup((s) => Object.assign(s.creatures.wren, { pos: 'N18', hidden: true, stealth: 30 }));
  r = run('speak', 'wren', "It's me, Grub! Let me through!", '--channel', 'shout', '--as', 'gob15', '--deception', '3');
  const caught = M('gob7').obs.filter((o) => o.kind === 'message').pop();
  expect('voices: a poor fake is caught by anyone who hears it clearly', caught && !caught.from && /isn't Grub's voice/.test(caught.fromLabel), JSON.stringify(caught));

  // ---------- recognition in the gloom: judged by build, settled by voice, and foolable ----------
  run('load', 'goblin-warren-caves');
  setup((s) => { s.creatures.gob15.pos = 'H17'; s.minds.gob15.facing = 'E'; s.creatures.wren.pos = 'U16'; s.creatures.rook.pos = 'U18'; });
  run('roll', '1d4');
  const gTracks = Object.values(M('gob15').tracks);
  const lookoutFig = gTracks.find((t) => t.cell === 'U15'), wrenFig = gTracks.find((t) => t.cell === 'U16'), rookFig = gTracks.find((t) => t.cell === 'U18');
  expect('recognition: a goblin too far to name is "built like one of yours"', lookoutFig && lookoutFig.kin && /one of yours/.test(lookoutFig.label), JSON.stringify(gTracks));
  expect('recognition: a halfling in the same gloom gets the same benefit of the doubt', wrenFig && wrenFig.kin, JSON.stringify(wrenFig));
  expect('recognition: a human-sized figure there doesn\'t', rookFig && !rookFig.kin && rookFig.side === 'unknown', JSON.stringify(rookFig));
  expect('recognition: a kin-looking figure isn\'t news', !M('gob15').obs.some((o) => /one of yours/.test(o.text) && o.sig >= 2), JSON.stringify(M('gob15').obs.slice(-4)));
  decide('gob5', { version: S().mseq, say: [{ to: 'all', channel: 'shout', kind: 'report', text: 'Lookout here, all quiet on the shelf.' }] });
  const vouched = Object.values(M('gob15').tracks).find((t) => t.cell === 'U15');
  expect('recognition: when the figure speaks, Grub knows the voice', vouched && /Goblin Lookout|you know the voice/.test(vouched.label), JSON.stringify(vouched));

  // ---------- standing orders: rules that lean everything, kept by the loyal ----------
  run('load', 'goblin-warren-caves');
  r = decide('snikka', { version: S().mseq, intention: { objective: 'rally', plan: [{ do: 'say', to: 'all', channel: 'shout', kind: 'order', text: 'Nobody runs off alone! Hold your fire until I say!' }, { do: 'guard', at: 'L12' }] } });
  expect('standing: a rule shouted to everyone becomes standing orders', /standing order/.test(r.out) && /pairs/.test(r.out) && /hold-fire/.test(r.out), r.out);
  const pipRules = M('gob4').standing || [], gixRules = M('gob7').standing || [];
  expect('standing: the goblins in earshot hold both rules', pipRules.some((o) => o.kind === 'pairs') && pipRules.some((o) => o.kind === 'hold-fire') && gixRules.length === 2, JSON.stringify([pipRules, gixRules]));
  expect('standing: obedient Pip keeps them more firmly than hot-headed Gix', pipRules[0].adherence > gixRules[0].adherence, JSON.stringify([pipRules[0].adherence, gixRules[0].adherence]));
  b = brief('gob4');
  expect('standing: the brief asks how they take a new rule', /NEW STANDING ORDERS/.test(b) && /Nobody runs off alone/.test(b) && /standingResponses/.test(b), b.split('YOU\n')[0].slice(-600));
  // Gix goes off alone anyway, in front of the boss: she notices.
  setup((s) => { s.creatures.gob7.pos = 'Q18'; s.minds.gob7.facing = 'W'; });
  run('roll', '1d4');
  r = decide('gob7', { version: S().mseq, intention: { objective: 'glory', plan: [{ do: 'investigate', at: 'E13' }] } });
  run('mind', 'gob7', 'act');
  const seenBreak = M('snikka').obs.find((o) => /against your order/.test(o.text));
  expect('standing: breaking it is allowed, and the boss sees it', seenBreak && /Gix go off alone/.test(seenBreak.text), JSON.stringify(M('snikka').obs.slice(-3)));
  // A goblin that keeps the rule, on its default plan, won't go look alone.
  const keeper = ['gob4', 'gob6', 'gob5'].find((g) => spawnSync('node', ['-e', `const C=require('./lib/core'),M=require('./lib/minds');console.log(M.keeps(C.loadState().minds['${g}'],'pairs'))`], { cwd: __dirname, encoding: 'utf8' }).stdout.trim() === 'true');
  if (keeper) {
    run('noise', 'D20', 'a crash', '--loud', '200');
    run('mind', keeper, 'fallback');
    const kp = S().minds[keeper].intentions[0];
    expect('standing: a goblin keeping "pairs" calls for company instead of going alone', kp && !kp.plan.some((st) => st.do === 'investigate') && kp.plan.some((st) => st.do === 'watch' || st.do === 'guard'), JSON.stringify(kp));
  } else expect('standing: at least one goblin keeps the pairs rule', false, 'none of gob4, gob5, gob6 keeps it');
  r = decide('snikka', { version: S().mseq, standing: [{ to: 'all', kind: 'hold-fire', text: 'Fire at will!', lift: true }] });
  expect('standing: the boss can lift a rule', !M('gob4').standing.some((o) => o.kind === 'hold-fire') && M('gob4').standing.some((o) => o.kind === 'pairs'), JSON.stringify(M('gob4').standing));

  // ---------- split take-in: the goblin's own facts, and nothing it couldn't know ----------
  run('load', 'goblin-warren-caves');
  run('place', 'gob15', 'F15');
  decide('gob15', { version: S().mseq, say: [{ to: 'all', channel: 'shout', kind: 'warning', text: 'Snore is dead! Big paw prints going north toward the grotto!' }] });
  const tp = (id) => spawnSync('node', ['-e', `const C=require('./lib/core'),T=require('./lib/think');console.log(T.takePrompt(C.loadState(),'${id}'))`], { cwd: __dirname, encoding: 'utf8' }).stdout;
  const heardIt = Object.keys(S().minds).filter((id) => (M(id).claims || []).some((c) => /paw prints/.test(c.text)));
  const missedIt = Object.keys(S().minds).filter((id) => id !== 'gob15' && !heardIt.includes(id) && S().creatures[id].hp > 0);
  const nubP = tp('gob6'), farP = missedIt.length ? tp(missedIt[0]) : '';
  expect('take-in: who is with you comes from what you can see', /With you: .*Gix/.test(nubP), nubP);
  expect('take-in: the trouble is only what you were told', heardIt.includes('gob6') && /paw prints/.test(nubP), nubP);
  expect('take-in: a goblin out of earshot knows nothing of it', missedIt.length && /know nothing yet of any trouble/.test(farP) && !/paw prints/.test(farP), `${missedIt[0]}: ${farP}`);
  const alone = Object.keys(S().minds).map((id) => [id, tp(id)]).find(([, p]) => /You are alone/.test(p));
  expect('take-in: a goblin with nobody in sight is told it is alone', !!alone, 'nobody was alone');
  const dueScript = `const C=require('./lib/core'),T=require('./lib/think'),M=require('./lib/minds');const s=C.loadState();s.minds.gob6.pending=[{why:'new standing orders change your plans',urgency:2,refs:[],after:s.mtime||0}];const a=T.due(s,['gob6']).length;s.mtime=(s.mtime||0)+1;console.log(a,T.due(s,['gob6']).length)`;
  const dueOut = spawnSync('node', ['-e', dueScript], { cwd: __dirname, encoding: 'utf8' }).stdout.trim();
  expect('take-in: a rethink waits for the next tick', dueOut === '0 1', dueOut);

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
