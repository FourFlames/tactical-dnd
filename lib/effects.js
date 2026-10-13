// Spell effects on one game clock. `s.clock` counts 6-second rounds of game time: exploration
// ticks and combat rounds both advance it, and initiative neither starts nor stops it, so a
// one-minute spell runs out after ten rounds of any mix. Effects live in `s.effects`.
// Spectral effects (Spiritual Weapon) are tokens on the map that attack from where they float.
'use strict';

const core = () => require('./core'); // core requires this file for attackPlan

// name (lowercase) → how the spell behaves. `conc`: 2024 rules make it concentration.
const SPECTRAL = { 'spiritual weapon': { rounds: 10, move: 20, reach: 5, range: 60, conc: true } };
const spectralOf = (w) => (w && (w.spectral || SPECTRAL[String(w.name || '').toLowerCase()])) || null;

const live = (s, e) => (s.clock || 0) - e.since < e.rounds;
const left = (s, e) => e.rounds - ((s.clock || 0) - e.since);
function find(s, owner, spell) {
  const k = String(spell).toLowerCase();
  return (s.effects || []).find((e) => e.owner === owner && e.spell.toLowerCase() === k && live(s, e)) || null;
}
function add(s, e) {
  s.effects = (s.effects || []).filter((x) => live(s, x) || x.owner !== e.owner || x.spell !== e.spell); // a lapsed cast, recast
  s.fxSeq = (s.fxSeq || 0) + 1;
  const fx = Object.assign({ id: `fx${s.fxSeq}`, since: s.clock || 0 }, e);
  (s.effects = s.effects || []).push(fx);
  return fx;
}
const nameOf = (s, e) => `${(s.creatures[e.owner] || { name: e.owner }).name}'s ${e.spell}`;
// Remove effects matching `pred`; a concentration effect takes its caster's concentration with it.
function end(s, pred) {
  const gone = (s.effects || []).filter(pred);
  if (!gone.length) return [];
  s.effects = s.effects.filter((e) => !gone.includes(e));
  for (const e of gone) {
    const c = s.creatures[e.owner];
    if (e.conc && c && c.concentrating && c.concentrating.spell === e.spell) delete c.concentrating;
  }
  return gone.map((e) => nameOf(s, e));
}
// Run out what time has used up. In combat pass the creature starting its turn: a spell lasts until
// the start of its caster's turn ten rounds on, not the top of that round.
const expire = (s, owner) => end(s, (e) => !live(s, e) && (owner === undefined || e.owner === owner || !s.creatures[e.owner]));
function pass(s, rounds = 1) { s.clock = (s.clock || 0) + rounds; }

// Concentration (minimal): one spell at a time; a new one, 0 HP or a failed CON save ends it.
function concentrate(s, id, spell) {
  const c = s.creatures[id];
  const dropped = c.concentrating ? drop(s, id) : [];
  c.concentrating = { spell, since: s.clock || 0 };
  return dropped;
}
function drop(s, id) {
  const c = s.creatures[id], was = c.concentrating && c.concentrating.spell;
  delete c.concentrating;
  const gone = end(s, (e) => e.owner === id && e.conc);
  return was ? [...new Set([`${c.name}'s ${was}`, ...gone])] : gone;
}

// Where a spectral attack comes from: { from: {x,y,z}, cell, cast, fx } or { error }. Read-only.
// Already up: it moves (flying, up to `move` ft) to a square beside the target if it isn't in reach.
// Not yet cast: it appears beside the target, within range and sight of the caster.
function spectralPlan(s, attId, tgtId, w) {
  const C = core(), sw = spectralOf(w);
  const a = s.creatures[attId], ap = C.at(s, a), tp = C.at(s, s.creatures[tgtId]);
  const fx = find(s, attId, w.name);
  const pt = (cell) => Object.assign(C.parseCell(cell), { z: tp.z });
  if (fx && C.distFeet(pt(fx.pos), tp) <= sw.reach) return { from: pt(fx.pos), cell: fx.pos, cast: false, fx };
  const origin = fx ? C.parseCell(fx.pos) : ap;
  const spots = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = tp.x + dx, y = tp.y + dy;
    if ((!dx && !dy) || !C.inBounds(s, x, y) || C.blocksMove(C.tagsAt(s, x, y)) || C.occupant(s, x, y)) continue;
    const p = { x, y, z: tp.z }, d = C.distFeet({ x: origin.x, y: origin.y }, { x, y });
    if (fx ? d > sw.move : C.distFeet(ap, p) > sw.range || !C.hasLOS(s, ap, p)) continue;
    if (!C.hasLOS(s, p, tp)) continue;
    spots.push({ p, d });
  }
  spots.sort((m, n) => m.d - n.d);
  const t = s.creatures[tgtId];
  if (!spots.length) {
    if (fx) return { error: `${w.name} is ${C.distFeet(pt(fx.pos), tp)} ft from ${t.name}; it moves only ${sw.move} ft a turn.` };
    return { error: `${w.name} appears within ${sw.range} ft of ${a.name}, in sight, beside the target: no such square next to ${t.name}.` };
  }
  return { from: spots[0].p, cell: C.cellId(spots[0].p.x, spots[0].p.y), cast: !fx, moved: !!fx, fx };
}

// What the viewer shows: tokens the party could see (all of them for the DM).
function forView(s, vis) {
  return (s.effects || []).filter((e) => e.pos && live(s, e) && (!vis || vis.has(e.pos) || (s.creatures[e.owner] || {}).side === 'party'))
    .map((e) => ({ id: e.id, spell: e.spell, owner: e.owner, pos: e.pos, left: left(s, e), kind: e.kind }));
}

module.exports = { SPECTRAL, spectralOf, live, left, find, add, end, expire, pass, concentrate, drop, spectralPlan, forView, nameOf };
