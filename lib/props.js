// Props as objects (Card 14c): crates, barrels, kegs and the like get an id, a stat block and a breaking point.
// Stat blocks follow the DMG's "Statistics for Objects": AC by material, HP by size and resilience, immune to poison
// and psychic. An encounter can override any of it on the legend's `object` or on an `objects` entry.
'use strict';

const G = require('./grid');

const OBJECT_IMMUNE = ['poison', 'psychic'];
// match: how a legend entry without an `object` (e.g. "oil barrels") is recognised. debris: what the square becomes.
const KINDS = {
  crate: { match: /crate|box/i, height: 4, ac: 15, hp: 10, vulnerable: ['bludgeoning', 'fire'], resist: ['piercing'],
    traits: ['dry wood: would burn', 'splinters under a heavy blow; points barely bite'],
    debris: { name: 'smashed crates', tags: ['difficult', 'flammable'] } },
  barrel: { match: /barrel|cask/i, height: 4, ac: 15, hp: 12, resist: ['piercing'],
    traits: ['stout staves, hooped; something sloshes inside'],
    debris: { name: 'spilled oil', tags: ['difficult', 'slick', 'flammable'] },
    onBreak: 'the barrel bursts and oil floods the square (now slick and flammable). Fire near it? Rule it: e.g. 2d6 fire, DEX 12 half, on anyone in the oil.' },
  keg: { match: /keg|powder/i, height: 4, ac: 13, hp: 5, vulnerable: ['fire'], fireBreaks: true,
    traits: ['black powder: keep it away from flame'],
    debris: { name: 'blackened debris', tags: ['difficult'] },
    onBreak: 'the keg explodes, rule it: e.g. 3d6 fire, DEX 12 half, 10 ft.' },
  table: { match: /\btable\b/i, height: 3, ac: 15, hp: 8, vulnerable: ['fire'], resist: ['piercing'],
    traits: ['rough planks: would burn'], debris: { name: 'broken planks', tags: ['difficult', 'flammable'] } },
  brazier: { match: /brazier/i, height: 3, ac: 19, hp: 10, resist: ['piercing', 'slashing'], immune: ['fire'],
    traits: ['iron bowl of live coals'], debris: { name: 'scattered coals', tags: ['difficult', 'fire-source'] },
    onBreak: 'the brazier tips and spills hot coals; rule anything flammable nearby.' },
};
const kindOf = (l) => {
  const k = l && l.object && l.object.kind;
  if (k) return KINDS[k] ? k : null;
  return Object.keys(KINDS).find((n) => KINDS[n].match.test((l && l.name) || '')) || null;
};
function statBlock(kind, o = {}) {
  const k = KINDS[kind] || {};
  const hp = o.hp !== undefined ? o.hp : k.hp || 10;
  return {
    ac: o.ac !== undefined ? o.ac : k.ac || 15, hp, maxHp: o.maxHp || hp,
    resist: o.resist || k.resist || [], vulnerable: o.vulnerable || k.vulnerable || [],
    immune: [...new Set([...OBJECT_IMMUNE, ...(o.immune || k.immune || [])])],
  };
}

// At load: every legend prop square becomes an `objects` entry with an id (crate1, keg1, ...), its legend character
// left in place so cover, blocking and looks stay exactly as they were. Placed objects of a known kind get ids and stats.
function promote(s) {
  s.objects = s.objects || [];
  const taken = new Set([...Object.keys(s.creatures || {}), ...s.objects.map((o) => o.id).filter(Boolean)]);
  const nextId = (kind) => { let i = 1; while (taken.has(kind + i)) i++; taken.add(kind + i); return kind + i; };
  for (const o of s.objects) {
    if (o.id || !KINDS[o.kind]) continue;
    Object.assign(o, { id: nextId(o.kind) }, statBlock(o.kind, o));
  }
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const l = s.legend[s.rows[y][x]], kind = kindOf(l);
    if (!kind || G.placedObjectAt(s, x, y)) continue;
    const lo = l.object || {};
    s.objects.push(Object.assign({ id: nextId(kind), at: G.cellId(x, y), kind, name: lo.name || l.name, height: lo.height !== undefined ? lo.height : KINDS[kind].height, legend: true },
      lo.stand !== undefined ? { stand: lo.stand } : {}, loot(lo), statBlock(kind, lo)));
  }
  return s;
}

// What a container holds (Card 14e): authored `contents`, `empty: true`, or `plot: true` (the DM decides).
const loot = (o) => ['contents', 'empty', 'plot'].reduce((r, k) => (o[k] !== undefined ? Object.assign(r, { [k]: o[k] }) : r), {});

const byId = (s, id) => (s.objects || []).find((o) => o.id === id && o.hp !== undefined) || null;
const cellOf = (o) => String(o.at).split(':')[0];
// How it looks to the party: never the number.
const condition = (o) => (o.hp >= o.maxHp ? 'intact' : o.hp > o.maxHp / 2 ? 'scuffed' : o.hp > o.maxHp / 4 ? 'battered' : 'about to give');
const traitsOf = (o) => o.traits || (KINDS[o.kind] || {}).traits || [];
// Stand-in for attackPlan: an object at its square, on the floor (not on top of itself), with no conditions.
function asTarget(s, o) {
  const p = G.parseCell(cellOf(o));
  return { id: o.id, name: o.name, pos: cellOf(o), z: G.floorFeet(s, p.x, p.y), ac: o.ac, hp: o.hp, maxHp: o.maxHp, conditions: [], side: 'object', object: true };
}

// A free legend key for a debris kind (the square's new character).
function debrisKey(s, d) {
  for (const [k, l] of Object.entries(s.legend)) if (l.debris && l.name === d.name) return k;
  const k = [...'%&*+^$!?;~`|_<>0123456789'].find((ch) => !s.legend[ch]);
  s.legend[k] = { name: d.name, tags: d.tags, debris: true };
  return k;
}
function breakProp(s, o, type) {
  const k = KINDS[o.kind] || {}, d = o.debris || k.debris || { name: 'debris', tags: ['difficult'] }, key = debrisKey(s, d);
  s.objects = s.objects.filter((x) => x !== o);
  const [a, b] = String(o.at).split(':').map(G.parseCell), e = b || a;
  for (let y = Math.min(a.y, e.y); y <= Math.max(a.y, e.y); y++) for (let x = Math.min(a.x, e.x); x <= Math.max(a.x, e.x); x++) {
    const r = s.rows[y];
    s.rows[y] = Array.isArray(r) ? Object.assign([...r], { [x]: key }) : r.slice(0, x) + key + r.slice(x + 1);
  }
  const onBreak = o.onBreak || k.onBreak;
  return { debris: d.name, note: onBreak ? `DM: ${onBreak}` : '', by: (type || '').toLowerCase() };
}
// Damage to a prop, with its resistances. { amt, text, broke, note }
function damage(s, o, amount, type) {
  const t = (type || '').toLowerCase(), k = KINDS[o.kind] || {};
  let amt = Math.max(0, amount), note = '';
  if (t && o.immune.includes(t)) { amt = 0; note = ' (immune)'; }
  else if (t && o.resist.includes(t)) { amt = Math.floor(amt / 2); note = ' (resisted)'; }
  else if (t && o.vulnerable.includes(t)) { amt *= 2; note = ' (vulnerable)'; }
  if (t === 'fire' && (o.fireBreaks || k.fireBreaks) && amt > 0) { amt = Math.max(amt, o.hp); note += ' (catches)'; }
  o.hp = Math.max(0, o.hp - amt);
  let text = `${o.name} (${o.id}) takes ${amt}${t ? ' ' + t : ''} damage${note} (${o.hp}/${o.maxHp}).`;
  if (o.hp > 0) return { amt, text, broke: false, note: '' };
  const br = breakProp(s, o, t);
  text += ` It breaks apart: ${cellOf(o)} is now ${br.debris}.`;
  return { amt, text, broke: true, note: br.note, debris: br.debris, by: br.by };
}

module.exports = { KINDS, promote, byId, cellOf, condition, traitsOf, asTarget, damage, breakProp };
