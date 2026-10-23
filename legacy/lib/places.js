// Named places: how people in the world refer to squares. An encounter lists `places`, each a
// landmark ({"name": "the cookfire", "at": "J14"}) or an area ({"name": "the warren", "area": "F11:U19"}).
// Speech never carries grid squares: whatever an NPC says is rewritten into these names before
// anyone hears it, while the structured `about.at` still points at the exact square.
'use strict';

const C = require('./core');

const NEAR = 10; // ft: "at the cookfire" means within a couple of squares of it
const AROUND = 30; // ft: farther than this from any landmark, only an area (or nothing) names it
const DIR_WORD = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };

function list(s) {
  return (s.places || []).map((p) => {
    if (p.area) {
      const [a, b] = String(p.area).split(':').map(C.parseCell);
      const e = b || a;
      return { name: p.name, x0: Math.min(a.x, e.x), y0: Math.min(a.y, e.y), x1: Math.max(a.x, e.x), y1: Math.max(a.y, e.y) };
    }
    const [a, b] = String(p.at).split(':').map(C.parseCell);
    const e = b || a;
    return { name: p.name, point: true, x0: Math.min(a.x, e.x), y0: Math.min(a.y, e.y), x1: Math.max(a.x, e.x), y1: Math.max(a.y, e.y) };
  });
}
// Feet from a square to the nearest square of a place (0 inside it).
function gap(p, x, y) {
  const dx = Math.max(p.x0 - x, 0, x - p.x1), dy = Math.max(p.y0 - y, 0, y - p.y1);
  return Math.max(dx, dy) * 5;
}
function dirFrom(p, x, y) {
  const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
  const a = Math.atan2(y - cy, x - cx) * 180 / Math.PI;
  return ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][((Math.round(a / 45) % 8) + 8) % 8];
}
// The name a local would use for a square: a landmark close by, else the smallest area it's in,
// else "west of the cookfire". null if the encounter names nothing anywhere near.
function nameOf(s, cell) {
  let p;
  try { p = C.parseCell(cell); } catch { return null; }
  const all = list(s);
  if (!all.length) return null;
  const points = all.filter((q) => q.point).map((q) => ({ q, d: gap(q, p.x, p.y) })).sort((a, b) => a.d - b.d);
  if (points.length && points[0].d <= 5) return points[0].q.name;
  const areas = all.filter((q) => !q.point && gap(q, p.x, p.y) === 0).sort((a, b) => (a.x1 - a.x0 + 1) * (a.y1 - a.y0 + 1) - (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1));
  if (areas.length) return areas[0].name;
  if (points.length && points[0].d <= NEAR) return points[0].q.name;
  if (points.length && points[0].d <= AROUND) return `${DIR_WORD[dirFrom(points[0].q, p.x, p.y)]} of ${points[0].q.name}`;
  return null;
}
// "C5 (the cookfire)" for briefs: the square for acting on, the name for thinking and talking.
function label(s, cell) {
  const n = nameOf(s, cell);
  return n ? `${cell} (${n})` : cell;
}
// Rewrite any grid squares in spoken words into place names. A square nothing names becomes "over there".
const CELL = /\b([A-Z])([1-9]\d?)\b/g;
function speakable(s, text) {
  if (!(s.places || []).length) return String(text); // an encounter that names nothing keeps its squares
  return String(text).replace(CELL, (m, col, row) => {
    const x = col.charCodeAt(0) - 65, y = Number(row) - 1;
    if (!C.inBounds(s, x, y)) return m;
    return nameOf(s, m) || 'over there';
  }).replace(/\b(?:at|near|by|to|past|around|from|in|toward|towards)\s+over there\b/gi, 'over there');
}

module.exports = { nameOf, label, speakable, list };
