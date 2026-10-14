// Shared rules core: grid geometry, pathing, line of sight, dice, views.
// Used by engine.js (the CLI the DM calls) and server.js (the viewer backend).
'use strict';

const fs = require('fs');
const path = require('path');
const Effects = require('./effects');
const G = require('./grid');
const Props = require('./props');
const {
  parseCell, cellId, inBounds, distFeet, tagsAt, terrainName, floorFeet, objectAt, elevAt, creatureElev, at, obstacleHeight, climbDC,
  wallSegments, wallIndex, stepWallTags, wallsOnLine, wallBetween, blocksMove, isDifficult,
  living, occupant, hostile, speedOf, findPath, lineCells, hasLOS, coverBetween, hasCond,
} = G;

const ROOT = path.join(__dirname, '..');
// Live data (the game, the log, seats, players, characters) lives in TDND_DATA when it's set, so tests and
// side sessions can run against a scratch folder without touching a game in progress. Code and config stay in ROOT.
const DATA = process.env.TDND_DATA ? path.resolve(process.env.TDND_DATA) : ROOT;
const STATE = path.join(DATA, 'state.json');
const LOG = path.join(DATA, 'log.jsonl');
const SEATS = path.join(DATA, 'seats.json');
const INTENTS = path.join(DATA, 'intents.jsonl');

// ---------- state io ----------
function loadState() {
  if (!fs.existsSync(STATE)) return null;
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}
function saveState(s) {
  updateExplored(s);
  const tmp = STATE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  // On Windows the rename fails while another process (the viewer server) has state.json open
  // for reading. Those reads take a millisecond or two, so wait briefly and try again.
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, STATE); return; } catch (e) {
      if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}
function appendLog(s, type, text, data) {
  const entry = { t: Date.now(), round: s ? s.round || 0 : 0, type, text };
  if (data) entry.data = data;
  fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
  return entry;
}

// Each entry gets n, its 1-based line number in the file (never written there). `before` keeps
// only entries with n < before; the last `n` of those are returned.
function readLog(n = 200, before = Infinity) {
  if (!fs.existsSync(LOG)) return [];
  const lines = fs.readFileSync(LOG, 'utf8').trim().split(/\n/), idx = [];
  lines.forEach((l, i) => { if (l.trim() && i + 1 < before) idx.push(i); });
  return idx.slice(-n).map((i) => Object.assign(JSON.parse(lines[i]), { n: i + 1 })); // parse only what's returned
}

// ---------- remote seats ----------
// seats.json: { <player>: { token, creatures: [ids] } }. The token is that player's personal link.
// intents.jsonl: actions remote players declare from the viewer. Append-only; the engine marks
// one handled by appending { ack: id }. Only the DM turns an intent into engine commands.
function loadSeats() {
  if (!fs.existsSync(SEATS)) return {};
  return JSON.parse(fs.readFileSync(SEATS, 'utf8'));
}
function saveSeats(seats) { fs.writeFileSync(SEATS, JSON.stringify(seats, null, 2)); }
// Join codes are typed by hand, so "Ember Wolf 42" and "ember-wolf-42" are the same code.
const normCode = (code) => String(code || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const WORDS = ('amber anvil arrow ash aspen badger bard bear bell birch blade bloom bolt bone bramble brass brook candle cedar cinder clover cobalt comet copper coral crane crow crown dagger dawn deer dove drake drum dusk eagle ember falcon fern finch flame flint fog forge fox frost gale garnet ghost glade goat gold griffin hawk hazel heron hollow horn iron ivy jade jasper kestrel lantern lark lily lynx maple marsh mist moon moss moth nettle night oak onyx otter owl pearl pike pine plum quartz quill rain raven reed ridge river robin rook rose rune sage salt shade shield silver slate smoke snow sparrow spear spruce star stone storm sun swan thistle thorn tide toad torch tower vale viper wand wasp willow wind wolf wren yew').split(' ');
function newCode(taken = []) {
  const crypto = require('crypto');
  for (;;) {
    const code = `${WORDS[crypto.randomInt(WORDS.length)]}-${WORDS[crypto.randomInt(WORDS.length)]}-${crypto.randomInt(10, 100)}`;
    if (!taken.includes(code)) return code;
  }
}
function seatByToken(token) {
  const code = normCode(token);
  if (!code) return null;
  for (const [player, seat] of Object.entries(loadSeats())) if (seat.token === code) return { player, ...seat };
  return null;
}
// intents.jsonl is append-only: declarations from players, plus {ack} lines when the DM has seen
// one and {reply} lines for the DM's short answers. Read back, each declaration carries its status.
function readIntents() {
  if (!fs.existsSync(INTENTS)) return [];
  const all = fs.readFileSync(INTENTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const acked = new Map(all.filter((e) => e.ack).map((e) => [e.ack, e.t]));
  const replies = {};
  for (const e of all) if (e.reply) (replies[e.reply] = replies[e.reply] || []).push(e);
  const game = currentGame();
  return all.filter((e) => !e.ack && !e.reply && !e.offer && inGame(e, game)).map((e) => {
    const rs = replies[e.id] || [];
    return { ...e, handled: acked.has(e.id), seenAt: acked.get(e.id), replies: rs.map(({ t, text }) => ({ t, text })), done: rs.some((r) => r.done) };
  });
}
// Declarations are stamped with the game they were made in, so a new `load` starts with a clean slate.
// Builder messages aren't about a game; unstamped (old) declarations belong to some earlier game.
function currentGame() { try { const s = loadState(); return (s && s.game) || null; } catch { return null; } }
const inGame = (e, game) => !game || e.kind === 'build' || e.game === game;
function appendIntent(entry) {
  if (!entry.ack && !entry.reply && entry.game === undefined) { const game = currentGame(); if (game) entry = { ...entry, game }; }
  fs.appendFileSync(INTENTS, JSON.stringify(entry) + '\n');
}
// Offers: the DM puts terms to a player ("Athletics DC 13 to climb; fail and you fall") and the
// player answers Do it / Never mind from the viewer. An answer is an intent pointing back at it.
function readOffers() {
  if (!fs.existsSync(INTENTS)) return [];
  const all = fs.readFileSync(INTENTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const game = currentGame();
  const answers = new Map(all.filter((e) => e.kind === 'answer' && e.to && inGame(e, game)).map((e) => [e.to, e]));
  return all.filter((e) => e.offer && inGame(e, game)).map((e) => ({ ...e, answer: answers.get(e.offer) || null }));
}
// While the DM sits in `listen` or `wait`, the engine touches this file every second or so;
// the server reads its age to tell players whether the DM is at the table right now.
const LISTEN = path.join(DATA, 'listening.json');
function markListening(what) { fs.writeFileSync(LISTEN, JSON.stringify({ t: Date.now(), what })); }
function dmPresence() {
  try {
    const l = JSON.parse(fs.readFileSync(LISTEN, 'utf8'));
    return { listening: Date.now() - l.t < 4000, what: l.what, since: l.t };
  } catch { return { listening: false }; }
}

// Grid geometry, pathing, sight and cover live in lib/grid.js (it runs in the browser too).

// Active Hide attempts have observer-specific detection; legacy encounter secrets keep
// their global hidden flag. Lazy loading avoids a core/minds initialization cycle.
function observerSees(s, observer, target) {
  if (!observer || !target || !observer.pos || !target.pos) return false;
  if (target.hideState) return require('./minds').canObserve(s, observer, target);
  return !target.hidden && hasLOS(s, at(s, observer), at(s, target));
}
function partySeesCreature(s, target) {
  return Object.values(s.creatures).some((p) => p.side === 'party' && p.pos && p.hp > 0 && observerSees(s, p, target));
}
// A state that will only be read (a server request) can keep its sight trace: sightCached marks it, and the first
// visibleSet fills the cache. The engine never marks states it mutates.
function sightCached(s) { if (s) Object.defineProperty(s, '_sight', { value: null, writable: true, enumerable: false }); return s; }
function visibleSet(s) {
  if (s._sight) return new Set(s._sight);
  const eyes = Object.values(s.creatures).filter((c) => c.side === 'party' && c.pos && c.hp > 0).map((c) => at(s, c));
  const walls = wallIndex(s);
  const vis = new Set();
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    if (eyes.some((e) => hasLOS(s, e, { x, y }, walls))) vis.add(cellId(x, y));
  }
  if (Object.prototype.hasOwnProperty.call(s, '_sight')) s._sight = vis;
  return new Set(vis);
}
function updateExplored(s) {
  const ex = new Set(s.explored || []);
  visibleSet(s).forEach((c) => ex.add(c));
  s.explored = [...ex];
}

// ---------- views ----------
// What a creature wears, for the 3D viewer: an explicit c.armor ('heavy' or { kind, shield }), else keywords in its notes
// and attack names. One table (first match wins, medium before heavy so 'half plate' isn't plate) so it can be retuned or replaced.
const ARMOR_WORDS = [
  ['medium', /\b(breastplate|half[- ]plate|scale[- ]mail|chain[- ]shirt|hide[- ]armor)\b/], ['heavy', /\b(plate|splint|ring[- ]mail|chain[- ]?mail)\b/],
  ['light', /\b(leather|studded|padded)\b/], ['none', /\b(cloth|robes?|unarmored)\b/],
];
function armorOf(c) {
  const a = c.armor, kinds = ['none', 'light', 'medium', 'heavy'];
  if (a && typeof a === 'object' && kinds.includes(a.kind)) return { kind: a.kind, shield: !!a.shield };
  if (typeof a === 'string' && kinds.includes(a)) return { kind: a, shield: /\bshield\b/i.test(c.notes || '') };
  const text = `${c.notes || ''} ${c.descr || ''} ${(c.attacks || []).map((x) => x.name).join(' ')}`.toLowerCase();
  const hit = ARMOR_WORDS.find(([, re]) => re.test(text));
  return { kind: hit ? hit[0] : 'none', shield: /\bshield\b/.test(text.replace(/shield of faith/g, '')) };
}

// The player view is derived from the truth, never maintained separately.
function view(s, mode) {
  const dm = mode === 'dm';
  const vis = dm ? null : visibleSet(s);
  const explored = new Set(s.explored || []);
  const cells = [];
  for (let y = 0; y < s.height; y++) {
    const row = [];
    for (let x = 0; x < s.width; x++) {
      const id = cellId(x, y);
      const fog = dm ? 'visible' : vis.has(id) ? 'visible' : explored.has(id) ? 'remembered' : 'unknown';
      if (fog === 'unknown') { row.push({ fog }); continue; }
      const cell = { fog, terrain: terrainName(s, x, y), ch: s.rows[y][x], tags: tagsAt(s, x, y), h: floorFeet(s, x, y) };
      const obj = objectAt(s, x, y);
      if (obj) cell.obj = obj;
      row.push(cell);
    }
    cells.push(row);
  }
  const creatures = {};
  for (const [id, c] of Object.entries(s.creatures)) {
    if (!c.pos) continue;
    const seen = dm || c.side === 'party' || (vis.has(c.pos) && (c.hideState ? partySeesCreature(s, c) : !c.hidden));
    if (!seen) continue;
    const pub = { id, name: c.name, side: c.side, pos: c.pos, elev: creatureElev(s, c), conditions: c.conditions || [], controller: c.controller, player: c.player, hidden: !!c.hidden, armor: armorOf(c) };
    if (c.cue) pub.cue = c.cue; // an NPC's visible mood (curious / alert / combat), set by lib/minds.js
    if (typeof c.z === 'number') pub.z = c.z; // aloft (elev already says how high); routes start from it
    // movement, stats, size and height: what the browser's own pathing (lib/grid.js) needs to route this creature
    if (dm || c.side === 'party') Object.assign(pub, { hp: c.hp, maxHp: c.maxHp, ac: c.ac, speed: c.speed, attacks: c.attacks, notes: c.notes, resources: c.resources, char: c.char,
      movement: c.movement, stats: c.stats, size: c.size, height: c.height });
    else pub.health = c.hp <= 0 ? 'down' : c.hp / c.maxHp > 0.5 ? 'healthy' : c.hp / c.maxHp > 0.25 ? 'bloodied' : 'near death';
    creatures[id] = pub;
  }
  // Props with ids (Card 14c), where the party knows the square: how battered they look, never the number (but the DM sees it).
  const objects = (s.objects || []).filter((o) => o.id && o.hp !== undefined).flatMap((o) => {
    const at0 = Props.cellOf(o), p = parseCell(at0);
    if (cells[p.y][p.x].fog === 'unknown') return [];
    const pub = { id: o.id, kind: o.kind, name: o.name, at: at0, height: o.height, cond: Props.condition(o) };
    if (dm) Object.assign(pub, { hp: o.hp, maxHp: o.maxHp, ac: o.ac });
    return [pub];
  });
  // A wall shows once any square beside it has been seen; secret ones only in the DM view.
  const known = (x, y) => inBounds(s, x, y) && cells[y][x].fog !== 'unknown';
  const walls = wallSegments(s).filter((w) => {
    if (dm) return true;
    if (w.hidden) return false;
    for (let y = Math.min(w.y1, w.y2); y <= Math.max(w.y1, w.y2); y++) for (let x = Math.min(w.x1, w.x2); x <= Math.max(w.x1, w.x2); x++) {
      if (known(x, y) || known(x - 1, y) || known(x, y - 1) || known(x - 1, y - 1)) return true;
    }
    return false;
  });
  // Players see the turn order with each run of unseen creatures folded into one '?' slot:
  // something is acting out there, but not who or how many.
  const order = [];
  for (const id of s.turnOrder || []) {
    if (creatures[id]) order.push(id);
    else if (!dm && order[order.length - 1] !== '?') order.push('?');
  }
  if (order.length > 1 && order[0] === '?' && order[order.length - 1] === '?') order.pop();
  const current = s.turnOrder ? s.turnOrder[s.turnIdx] : null;
  return {
    name: s.name, width: s.width, height: s.height, legend: s.legend, climbDC: s.climbDC, cells, creatures, walls, objects,
    round: s.round || 0, turnOrder: order,
    current: current && (dm || creatures[current]) ? current : null,
    currentUnseen: !!(current && !dm && !creatures[current]),
    mode: dm ? 'dm' : 'player',
    game: s.game || null,
    effects: Effects.forView(s, vis),
    log: logFor(s, mode, { limit: 80 }, creatures),
  };
}

// The log as this viewer may read it: up to `limit` entries with n < before. Shared by view()
// and /api/log. `creatures` (what the party sees now) is derived when the caller has no view yet.
function logFor(s, mode, { before = Infinity, limit = 80 } = {}, creatures) {
  const log = readLog(limit, before);
  if (mode === 'dm') return log;
  if (!creatures) {
    const vis = visibleSet(s);
    creatures = {};
    for (const [id, c] of Object.entries(s.creatures)) if (c.pos && (c.side === 'party' || (vis.has(c.pos) && (c.hideState ? partySeesCreature(s, c) : !c.hidden)))) creatures[id] = c;
  }
  return publicLog(s, log, creatures);
}

// What a chronicle line may carry to the players: who perceived it and where it came from as far as they can tell.
function perceptionData(d) {
  if (!Array.isArray(d.perceivers)) return undefined;
  const o = {};
  for (const k of ['perceivers', 'sense', 'id', 'at', 'dir', 'dist']) if (d[k] !== undefined) o[k] = d[k];
  return o;
}
// The log as the players may read it: no secrets, and no names from turns they couldn't see.
// Turn lines carry { id, unseen } from the engine; older lines without it are judged by name
// against who the party can see now.
function publicLog(s, log, seenNow) {
  const seenName = (name) => Object.values(seenNow).some((c) => c.name === name)
    || !Object.values(s.creatures).some((c) => c.name === name);
  const hiddenTurn = (e, name) => (e.data && 'unseen' in e.data ? e.data.unseen : !seenName(name));
  const out = [];
  for (const e of log) {
    if (e.type === 'secret' || (e.data && e.data.dmOnly)) continue;
    if (e.type !== 'turn') { out.push(e); continue; }
    const init = /^Roll for initiative! (.*)\. Round 1 begins: (.+?)'s turn\.$/.exec(e.text);
    if (init) {
      const all = e.data && e.data.rolls ? e.data.rolls.map((r) => ({ text: `${r.name} ${r.init}`, seen: r.seen }))
        : init[1].split(', ').map((r) => ({ text: r, seen: seenName(r.replace(/ -?\d+$/, '')) }));
      const rolls = all.filter((r) => r.seen).map((r) => r.text);
      const others = rolls.length < all.length ? `${rolls.length ? '; others' : 'Everyone else'} out of sight` : '';
      const first = hiddenTurn(e, init[2]) ? 'something moves out of sight' : `${init[2]}'s turn`;
      out.push({ t: e.t, n: e.n, round: e.round, type: 'turn', text: `Roll for initiative! ${rolls.join(', ')}${others}. Round 1 begins: ${first}.` });
      continue;
    }
    const turn = /^Round (\d+): (.+?)'s turn\./.exec(e.text);
    if (turn && hiddenTurn(e, turn[2])) {
      out.push({ t: e.t, n: e.n, round: e.round, type: 'turn', text: `Round ${turn[1]}: something moves out of sight.`, data: { unseen: true } });
      continue;
    }
    out.push(e.data ? Object.assign({}, e, { data: perceptionData(e.data) }) : e);
  }
  return out;
}

// ---------- tracks ----------
// Creatures leave tracks on ground that takes them: an encounter tags cells `tracks` (or `wet`), and these terrains do by
// name. s.trails[cell] = up to 6 { who, seq, t, from, size, kind, heavy, base }, one per creature (its latest pass), fading
// after TRACK_LIFE rounds. `track` reads them with Survival: DC = the ground's softness + the age.
const SOFT_GROUND = [[/mud|marsh|bog|silt/, 8], [/snow|guano/, 8], [/ash|cinder|soot|sand/, 9], [/blood|gore/, 10], [/dust|powder|grit/, 10]];
const TRACK_LIFE = 60, TRACK_CAP = 6;
const trackNow = (s) => s.mtime || s.round || 0;
function trackGround(s, x, y) {
  if (!inBounds(s, x, y)) return null;
  const tags = tagsAt(s, x, y), name = terrainName(s, x, y).toLowerCase();
  if (tags.some((g) => ['no-tracks', 'wall', 'chasm', 'bridge', 'water', 'burning'].includes(g))) return null;
  const hit = SOFT_GROUND.find(([re]) => re.test(name) || tags.some((g) => re.test(g)));
  if (hit) return { name, dc: hit[1] };
  if (tags.includes('tracks')) return { name, dc: 12 };
  const wet = tags.includes('wet') || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inBounds(s, x + dx, y + dy) && tagsAt(s, x + dx, y + dy).includes('water'));
  return wet ? { name: 'wet stone', dc: 14 } : null;
}
const BEASTS = /wolf|dog|hound|bear|rat|spider|boar|horse|snake|cat|lion|bat|stirge|worg|ape|ox|goat/i;
function recordTracks(s, id, path) {
  const c = s.creatures[id];
  if (!c || c.hp <= 0 || !Array.isArray(path) || path.length < 2 || hasCond(c, 'flying')) return;
  const now = trackNow(s);
  s.trails = s.trails || {};
  for (const k of Object.keys(s.trails)) {
    s.trails[k] = s.trails[k].filter((e) => now - e.t <= TRACK_LIFE);
    if (!s.trails[k].length) delete s.trails[k];
  }
  for (let i = 1; i < path.length; i++) {
    const p = parseCell(path[i]), g = trackGround(s, p.x, p.y);
    if (!g) continue;
    const cell = cellId(p.x, p.y), list = (s.trails[cell] || []).filter((e) => e.who !== id);
    list.push({ who: id, seq: s.tseq = (s.tseq || 0) + 1, t: now, from: path[i - 1], size: c.size || 'medium', kind: c.type || (BEASTS.test(c.name || '') ? 'beast' : 'humanoid'), heavy: !!c.noisy, base: g.dc });
    s.trails[cell] = list.slice(-TRACK_CAP);
  }
}
const ageWord = (a) => (a <= 2 ? 'fresh' : a <= 10 ? 'recent' : a <= 30 ? 'a while old' : 'old and faint');
const trackDC = (e, age) => e.base + (age > 2 ? 2 : 0) + (age > 10 ? 3 : 0) + (age > 30 ? 3 : 0);
const COMPASS8 = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
function heading(from, to) {
  const a = parseCell(from), b = parseCell(to);
  if (a.x === b.x && a.y === b.y) return null;
  return COMPASS8[((Math.round(Math.atan2(b.y - a.y, b.x - a.x) * 4 / Math.PI) % 8) + 8) % 8];
}
// Cells a tracker can study: a square, or all within `radius` squares, that they can see and that are within 30 ft.
function trackCells(s, tracker, spec) {
  const me = at(s, tracker), p0 = parseCell(tracker.pos), walls = wallIndex(s);
  let cells;
  if (typeof spec === 'string' && /^[A-Za-z]\d+$/.test(spec.trim())) cells = [parseCell(spec)];
  else {
    const r = Math.max(1, Math.min(6, Number(spec) || 2));
    cells = [];
    for (let y = p0.y - r; y <= p0.y + r; y++) for (let x = p0.x - r; x <= p0.x + r; x++) cells.push({ x, y });
  }
  return cells.filter((p) => inBounds(s, p.x, p.y)).map((p) => cellId(p.x, p.y)).filter((id) => {
    const p = parseCell(id), b = { x: p.x, y: p.y, z: elevAt(s, p.x, p.y) };
    return (id === tracker.pos || (distFeet(me, b) <= 30 && hasLOS(s, me, b, walls))) && (s.trails || {})[id];
  });
}
// What a Survival `total` makes of the tracks in `cells`: trails (one per creature), as far as the roll reads them.
// Never names anyone: size and kind, how old, which way. { trails: [{ who, text, cell }], unread }
function readTracks(s, tracker, cells, total) {
  const now = trackNow(s), by = {};
  let unread = 0;
  for (const cell of cells) for (const e of (s.trails[cell] || [])) {
    const who = s.creatures[e.who];
    if (e.who === tracker.id || (who && who.side === tracker.side)) continue; // you know your own side's footprints
    const age = now - e.t;
    if (age > TRACK_LIFE) continue;
    if (total < trackDC(e, age)) { unread++; continue; }
    (by[e.who] = by[e.who] || []).push(Object.assign({ cell, age, margin: total - trackDC(e, age) }, e));
  }
  const trails = Object.entries(by).map(([who, es]) => {
    const last = es.reduce((a, b) => (b.seq > a.seq ? b : a)), margin = Math.max(...es.map((e) => e.margin));
    const dir = heading(last.from, last.cell);
    const what = margin >= 3 ? `${/^[aeiou]/.test(last.size) ? 'an' : 'a'} ${last.size} ${last.kind}${margin >= 8 && last.heavy ? ', heavily laden or armoured' : ''}` : 'something';
    return { who, cell: last.cell, text: `${what} passed this way, ${ageWord(Math.min(...es.map((e) => e.age)))}${dir ? `, heading ${dir}` : ''}` };
  });
  return { trails, unread };
}

// ---------- looking at things ----------
// What a party member can tell about a creature or a square from where they stand: what the
// party has seen (never hidden creatures or unexplored squares), how far, sight, cover, which of
// their attacks reach, and any facts the DM has recorded with `describe`. Returns null when the
// thing isn't something the party knows about.
const TAG_TEXT = {
  difficult: 'difficult terrain (double movement)', water: 'water (difficult terrain; softens a fall)',
  'cover-half': 'half cover (+2 AC) for anyone behind it', 'cover-3q': 'three-quarters cover (+5 AC) for anyone behind it',
  climbable: 'climbable', unclimbable: 'too sheer to climb', stairs: 'stairs (no climbing needed)',
  flammable: 'looks like it would burn', burning: 'ON FIRE', 'fire-source': 'an open flame', slick: 'slick underfoot',
  narrow: 'narrow: single file', 'can-topple': 'could be knocked over', chasm: 'a sheer drop', impassable: "can't be entered",
  wall: 'solid wall', opaque: 'blocks sight', bridge: 'a bridge',
};
// A climbable face (Card 14d): the side of square (x,y) facing `side` (n/e/s/w), standing over the neighbour that way.
// A wall square's face, or the drop from a raised square (a ledge, a chasm edge) to a lower neighbour. null when flat.
const SIDE_NAME = { n: 'north', e: 'east', s: 'south', w: 'west' };
const SIDE_STEP = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
function surfaceOf(s, x, y, side) {
  const d = SIDE_STEP[side];
  if (!d || !inBounds(s, x, y)) return null;
  const nx = x + d[0], ny = y + d[1], tags = tagsAt(s, x, y), l = s.legend[s.rows[y][x]] || {};
  const base = inBounds(s, nx, ny) ? floorFeet(s, nx, ny) : floorFeet(s, x, y);
  const wall = tags.includes('wall');
  const height = wall ? (typeof l.height === 'number' ? floorFeet(s, x, y) + l.height - base : Infinity) : floorFeet(s, x, y) - base;
  if (!wall && height < 5) return null;
  const sheer = tags.includes('unclimbable');
  return { side, base, height, wall, sheer, climbable: tags.includes('climbable'), dc: climbDC(s, x, y), name: terrainName(s, x, y), from: inBounds(s, nx, ny) ? cellId(nx, ny) : null };
}
function partyKnows(s) {
  const vis = visibleSet(s), explored = new Set(s.explored || []);
  return {
    vis,
    creature: (c) => c && c.pos && (c.side === 'party' || (vis.has(c.pos) && (c.hideState ? partySeesCreature(s, c) : !c.hidden))),
    cell: (id) => vis.has(id) || explored.has(id),
  };
}
// What the party knows right now, snapshotted when a creature moves so `undo` can say what the move taught them.
function knowledge(s) {
  const knows = partyKnows(s), cells = new Set(s.explored || []);
  knows.vis.forEach((c) => cells.add(c));
  const creatures = Object.entries(s.creatures).filter(([, c]) => c.side !== 'party' && knows.creature(c)).map(([id]) => id);
  const facts = {};
  for (const [k, v] of Object.entries(s.known || {})) facts[k] = v.length;
  return { cells: [...cells], creatures, facts };
}
// What the undone move gave away: { cells, creatures: [names], other: [facts], noticedBy: [NPC names] }, or null
// with nothing to undo. `player` hides the names of NPCs the party can't see.
function undoCost(s, id, { player = false } = {}) {
  const u = s.undo;
  if (!u || u.id !== id || !u.know) return null;
  const now = knowledge(s), had = new Set(u.know.cells), seen = new Set(u.know.creatures);
  const nameOf = (i) => (s.creatures[i] || {}).name || i;
  const other = [];
  for (const [k, v] of Object.entries(s.known || {})) for (const f of v.slice(u.know.facts[k] || 0)) other.push(`${nameOf(k)}: ${f}`);
  const knows = partyKnows(s);
  return {
    cells: now.cells.filter((c) => !had.has(c)).length,
    creatures: now.creatures.filter((i) => !seen.has(i)).map(nameOf),
    other,
    noticedBy: (u.noticedBy || []).filter((i) => s.creatures[i]).map((i) => (!player || knows.creature(s.creatures[i]) ? nameOf(i) : 'Someone')),
  };
}
const undoCostAny = (c) => !!c && (c.cells > 0 || c.creatures.length > 0 || c.other.length > 0);

function look(s, fromId, target) {
  const me = s.creatures[fromId];
  if (!me || me.side !== 'party' || !me.pos) return null;
  const knows = partyKnows(s);
  const known = (s.known || {});
  const a = at(s, me);
  const out = { from: { id: fromId, name: me.name }, lines: [], facts: [] };
  let b;
  const prop = target.id && !s.creatures[target.id] ? Props.byId(s, target.id) : null;
  if (prop) {
    const cell = Props.cellOf(prop), p = parseCell(cell), tags = tagsAt(s, p.x, p.y), o = objectAt(s, p.x, p.y);
    if (!knows.cell(cell)) return null;
    b = Object.assign(p, { z: floorFeet(s, p.x, p.y) });
    Object.assign(out, { kind: 'object', id: prop.id, objKind: prop.kind, name: prop.name, cell, z: b.z, cond: Props.condition(prop) });
    out.lines.push({ intact: 'Intact.', scuffed: 'Scuffed, but sound.', battered: "Battered: it won't take much more.", 'about to give': 'About to give.' }[out.cond]);
    out.lines.push(`About ${prop.height} ft tall${o && o.stand ? ', you could stand on top' : ''}.`);
    const traits = Props.traitsOf(prop);
    if (traits.length) out.lines.push(traits.map((t) => t[0].toUpperCase() + t.slice(1)).join('. ') + '.');
    const said = tags.filter((t) => TAG_TEXT[t] && t !== 'flammable').map((t) => TAG_TEXT[t]);
    if (said.length) out.lines.push(said.map((t) => t[0].toUpperCase() + t.slice(1)).join('. ') + '.');
    if (!knows.vis.has(cell)) out.lines.push('Out of sight right now: this is how you remember it.');
    out.facts = known[prop.id] || known[cell] || [];
  } else if (target.side) {
    const p = parseCell(target.cell);
    if (!inBounds(s, p.x, p.y) || !knows.cell(cellId(p.x, p.y))) return null;
    const sf = surfaceOf(s, p.x, p.y, target.side);
    if (!sf) return null;
    b = Object.assign(p, { z: sf.base + Math.min(sf.height, 5) / 2 });
    Object.assign(out, { kind: 'surface', cell: cellId(p.x, p.y), side: sf.side, z: sf.base, name: sf.name, surface: sf });
    out.lines.push(`${sf.name[0].toUpperCase() + sf.name.slice(1)}, the ${SIDE_NAME[sf.side]} face${sf.height === Infinity ? ', rising out of sight' : `, ${sf.height} ft high`}.`);
    out.lines.push(sf.sheer ? 'Sheer: no handholds you can see.' : `${sf.climbable ? 'Climbable' : 'Rough rock'}: Athletics DC ${sf.dc} to climb at speed; climbing costs double movement.`);
    if (sf.wall) out.lines.push('Full cover: nothing passes through it.');
    else if (sf.height >= 5) out.lines.push(`Cover for anyone tucked below it, from whoever is up on ${cellId(p.x, p.y)}.`);
    out.facts = known[cellId(p.x, p.y)] || [];
  } else if (target.id) {
    const c = s.creatures[target.id];
    if (!knows.creature(c)) return null;
    b = at(s, c);
    const p = parseCell(c.pos);
    Object.assign(out, { kind: 'creature', id: target.id, name: c.name, side: c.side, cell: c.pos, z: b.z });
    if (c.look) out.lines.push(c.look);
    if (c.side === 'party') out.lines.push(`HP ${c.hp}/${c.maxHp}, AC ${c.ac}, speed ${c.speed} ft.`);
    else out.lines.push(c.hp <= 0 ? 'Down.' : `Looks ${c.hp / c.maxHp > 0.5 ? 'healthy' : c.hp / c.maxHp > 0.25 ? 'bloodied' : 'near death'}.`);
    if (c.size && c.size !== 'medium') out.lines.push(`Size: ${c.size}.`);
    if ((c.conditions || []).length) out.lines.push('Conditions: ' + c.conditions.map((x) => x.name).join(', ') + '.');
    out.lines.push(`Standing on ${terrainName(s, p.x, p.y)} at ${c.pos}${b.z ? `, ${b.z} ft up` : ''}.`);
    if (c.side !== 'party' && (c.attacks || []).length) out.lines.push(`${c.hp <= 0 ? 'Had' : 'Armed with'}: ${c.attacks.map((w) => w.name).join(', ')}.`);
    const yielded = (c.conditions || []).some((x) => ['surrendered', 'charmed', 'frightened'].includes(x.name));
    if (c.side !== 'party' && fromId !== target.id && c.hp > 0 && !yielded) out.lines.push(hostile(me, c) ? 'Hostile.' : 'Not hostile to you, as far as you can tell.');
    out.facts = known[target.id] || [];
  } else {
    const p = parseCell(target.cell);
    if (!inBounds(s, p.x, p.y)) return null;
    const id = cellId(p.x, p.y);
    if (!knows.cell(id)) return null;
    const floor = elevAt(s, p.x, p.y);
    const z = typeof target.z === 'number' && !Number.isNaN(target.z) ? target.z : floor;
    b = Object.assign(p, { z });
    const tags = tagsAt(s, p.x, p.y), obj = objectAt(s, p.x, p.y), l = s.legend[s.rows[p.y][p.x]] || {};
    Object.assign(out, { kind: 'square', cell: id, z, floor, name: obj ? obj.name : terrainName(s, p.x, p.y) });
    if (l.look) out.lines.push(l.look);
    if (obj) out.lines.push(`About ${obj.height} ft tall${obj.stand ? ', you could stand on top' : ''}, on ${terrainName(s, p.x, p.y)}.`);
    if (floorFeet(s, p.x, p.y)) out.lines.push(`The ground here is ${floorFeet(s, p.x, p.y)} ft up.`);
    if (z !== floor) out.lines.push(`Your cursor is ${Math.abs(z - floor)} ft ${z > floor ? 'above' : 'below'} where you'd stand there.`);
    const said = tags.filter((t) => TAG_TEXT[t]).map((t) => TAG_TEXT[t]);
    if (said.length) out.lines.push(said.map((t) => t[0].toUpperCase() + t.slice(1)).join('. ') + '.');
    if (!knows.vis.has(id)) out.lines.push('Out of sight right now: this is how you remember it.');
    const occ = occupant(s, p.x, p.y);
    if (occ && knows.creature(s.creatures[occ])) out.lines.push(`${s.creatures[occ].name} is there.`);
    if (!blocksMove(tags) && !occ && id !== me.pos) {
      try {
        const route = findPath(s, fromId, id);
        const ts = (s.turn || {})[fromId] || { used: 0, dash: false };
        const left = speedOf(me) * (ts.dash ? 2 : 1) - ts.used;
        if (route) out.move = { cost: route.cost, left };
        out.lines.push(route ? `Getting there: ${route.cost} ft of movement (${Math.max(0, left)} ft left this turn).` : 'You see no way to walk there.');
      } catch { /* odd terrain: skip the route */ }
    }
    out.facts = known[id] || [];
  }
  if (fromId !== target.id) {
    const dist = distFeet(a, b), los = hasLOS(s, a, b), cover = los ? coverBetween(s, a, b) : 0;
    Object.assign(out, { dist, los, cover, rise: b.z - a.z });
    const rel = [`${dist} ft from ${me.name}`];
    if (b.z !== a.z) rel.push(`${Math.abs(b.z - a.z)} ft ${b.z > a.z ? 'above' : 'below'} you`);
    rel.push(los ? 'in plain sight' : 'no line of sight');
    if (cover) rel.push(`behind ${cover === 2 ? 'half' : cover === 5 ? 'three-quarters' : '+' + cover} cover from you`);
    out.lines.push(rel.join(', ') + '.');
    if (target.id && (prop || s.creatures[target.id].side !== 'party')) {
      out.attacks = (me.attacks || []).map((w) => {
        const plan = attackPlan(s, fromId, target.id, w.name);
        if (plan.error) {
          const verdict = !los ? 'no line of sight' : w.range ? 'out of range' : 'out of reach';
          return { name: w.name, as: attackCost(w).as, ok: false, verdict };
        }
        const verdict = (w.range ? 'in range' : 'in reach') + (plan.mode === 'adv' ? ', advantage' : plan.mode === 'dis' ? ', disadvantage' : '');
        return { name: w.name, as: attackCost(w).as, ok: true, verdict, mode: plan.mode, notes: plan.notes, sneak: plan.sneak, damage: w.damage };
      });
    }
  }
  return out;
}

// ---------- turns, attacks and features (read-only; the engine applies them) ----------
// What a creature's sheet says it can do, read from its `features` list or, failing that, its notes.
function featuresOf(c) {
  const text = [...(c.features || []), c.notes || ''].join(' ');
  const sneak = /Sneak Attack\s*\+?\s*(\d+d\d+)/i.exec(text);
  return {
    cunningAction: /Cunning Action/i.test(text),
    nimbleEscape: /Nimble Escape/i.test(text),
    sneakDice: sneak ? sneak[1] : null,
  };
}
// Where a creature stands in its turn: movement, action, bonus action, reaction.
function turnInfo(s, id) {
  const c = s.creatures[id];
  const ts = (s.turn || {})[id] || {};
  let budget = speedOf(c) * (ts.dash ? 2 : 1);
  if (hasCond(c, 'prone')) budget = Math.floor(budget / 2);
  return {
    used: ts.used || 0, budget, left: Math.max(0, budget - (ts.used || 0)), dash: !!ts.dash, disengage: !!ts.disengage,
    action: !!ts.action, bonus: !!ts.bonus, reaction: !!c.reactionUsed, attacks: ts.attacks || 0, sneakUsed: !!ts.sneak,
    attacksPerAction: c.attacksPerAction || 1,
  };
}
// Hostiles whose reach a route leaves (opportunity attacks), measured in 3D along the route.
const provokersAlong = (s, id, walked) => provokeDetail(s, id, walked).map((p) => p.id);
// The same, with the square (and height) each one was left from: { id, from, z }. A hiding mover only provokes those who see it.
const provokeDetail = (s, id, walked) => G.provokeDetail(s, id, walked, observerSees);
// What an attack costs: 'action' (default), 'bonus' or 'reaction'. `as` on the entry wins; hand-written
// encounter data that lists a known bonus-action attack without it gets it from this table. `cast` is the
// slot level the first use spends (the spell is cast then; later uses just direct it).
const KNOWN_ATTACKS = { 'spiritual weapon': { as: 'bonus', cast: 2 } };
function attackCost(w) {
  const k = KNOWN_ATTACKS[String(w.name || '').toLowerCase()] || {};
  return { as: w.as || (w.bonusAction ? 'bonus' : k.as) || 'action', cast: w.cast || k.cast || 0 };
}
function findAttack(c, weapon) {
  const attacks = c.attacks || [];
  return weapon ? attacks.find((x) => x.name.toLowerCase().includes(String(weapon).toLowerCase())) : attacks[0];
}
// Everything about an attack that's decided before the dice: can it happen, advantage, cover, AC,
// and whether Sneak Attack would apply. { error } when it can't happen.
function attackPlan(s, attId, tgtId, weapon, flags = {}) {
  const prop = !s.creatures[tgtId] && Props.byId(s, tgtId);
  const a = s.creatures[attId], t = s.creatures[tgtId] || (prop && Props.asTarget(s, prop));
  if (!a || !t) return { error: 'No such creature.' };
  if (a.hp <= 0 && a.side !== 'party') return { error: `${a.name} is down.` };
  const attacks = a.attacks || [];
  if (!attacks.length) return { error: `${a.name} has no attacks listed.` };
  const w = weapon ? attacks.find((x) => x.name.toLowerCase().includes(String(weapon).toLowerCase())) : attacks[0];
  if (!w) return { error: `${a.name} has no attack matching "${weapon}". Has: ${attacks.map((x) => x.name).join(', ')}` };
  // A spectral weapon attacks from its own square, as a melee attack (Spiritual Weapon).
  const sw = Effects.spectralOf(w), spec = sw ? Effects.spectralPlan(s, attId, tgtId, w) : null;
  if (spec && spec.error) return { error: spec.error, w };
  const ap = spec ? spec.from : at(s, a), tp = at(s, t);
  const dist = distFeet(ap, tp);
  if (!hasLOS(s, ap, tp)) return { error: `${a.name} has no line of sight to ${t.name}.`, w, dist };
  const fold = (mode, m) => (mode && mode !== m ? 'none' : mode === 'none' ? 'none' : m);
  let mode = flags.adv && !flags.dis ? 'adv' : flags.dis && !flags.adv ? 'dis' : null;
  const notes = [];
  if (spec) { if (dist > sw.reach) return { error: `${t.name} is out of reach of ${w.name}.`, w, dist }; }
  else if (w.range) {
    const [norm, long] = w.range;
    if (dist > long) return { error: `${t.name} is ${dist} ft away; ${w.name} max range is ${long} ft.`, w, dist };
    if (dist > norm) { mode = fold(mode, 'dis'); notes.push('long range'); }
    const adjacentFoe = Object.values(s.creatures).some((o) => o.pos && o.hp > 0 && hostile(a, o) && distFeet(ap, at(s, o)) <= 5 && !hasCond(o, 'incapacitated') && !hasCond(o, 'surrendered'));
    if (adjacentFoe) { mode = fold(mode, 'dis'); notes.push('hostile adjacent'); }
  } else if (dist > (w.reach || 5)) return { error: `${t.name} is ${dist} ft away; ${w.name} reach is ${w.reach || 5} ft.`, w, dist };
  if (hasCond(t, 'prone')) { mode = fold(mode, w.range ? 'dis' : 'adv'); notes.push('target prone'); }
  const helpless = ['restrained', 'paralyzed', 'stunned', 'unconscious', 'blinded'].filter((k) => hasCond(t, k));
  if (helpless.length) { mode = fold(mode, 'adv'); notes.push('target ' + helpless.join('/')); }
  const unseenAttacker = a.hideState ? !observerSees(s, t, a) : a.hidden;
  if (hasCond(t, 'dodging') && !unseenAttacker) { mode = fold(mode, 'dis'); notes.push('target dodging'); }
  if (unseenAttacker) { mode = fold(mode, 'adv'); notes.push('unseen attacker'); }
  if (t.hideState && !observerSees(s, a, t)) { mode = fold(mode, 'dis'); notes.push('unseen target'); }
  const cover = coverBetween(s, ap, tp);
  if (cover) notes.push(`cover +${cover}`);
  const finalMode = mode === 'none' ? null : mode;
  // Sneak Attack (PHB): once per turn, finesse or ranged weapon, with advantage or an ally of the
  // attacker within 5 ft of the target (and no disadvantage).
  const f = featuresOf(a);
  let sneak = null;
  if (f.sneakDice && finalMode !== 'dis' && !prop) {
    const ally = Object.values(s.creatures).some((o) => o.id !== attId && o.pos && o.side === a.side && living(o) && o.hp > 0 && !hasCond(o, 'incapacitated') && distFeet(at(s, o), tp) <= 5);
    const finesse = !spec && (w.range || w.finesse || /dagger|rapier|shortsword|scimitar|whip/i.test(w.name));
    const used = ((s.turn || {})[attId] || {}).sneak;
    if (finesse && (finalMode === 'adv' || ally) && !used) sneak = f.sneakDice;
  }
  const crit19 = w.critRange === 19;
  return { w, dist, mode: finalMode, notes, cover, ac: (t.ac || 10) + cover, sneak, crit19, ranged: !!w.range && !spec, spectral: spec };
}

// ---------- dice ----------
function d(n) { return 1 + Math.floor(Math.random() * n); }
function roll(expr, { crit = false } = {}) {
  const src = String(expr).replace(/\s+/g, '');
  const terms = src.match(/[+-]?[^+-]+/g) || [];
  let total = 0;
  const parts = [];
  for (const term of terms) {
    const sign = term.startsWith('-') ? -1 : 1;
    const body = term.replace(/^[+-]/, '');
    const m = /^(\d*)d(\d+)$/i.exec(body);
    if (m) {
      const count = (parseInt(m[1] || '1', 10)) * (crit ? 2 : 1);
      const rolls = Array.from({ length: count }, () => d(parseInt(m[2], 10)));
      total += sign * rolls.reduce((a, b) => a + b, 0);
      parts.push(`${sign < 0 ? '-' : ''}[${rolls.join(',')}]`);
    } else if (/^\d+$/.test(body)) {
      total += sign * parseInt(body, 10);
      parts.push(`${sign < 0 ? '-' : '+'}${body}`);
    } else throw new Error(`Can't roll "${expr}"`);
  }
  return { total, detail: parts.join(' ').replace(/^\+/, '') };
}
function d20(mode) {
  const a = d(20), b = d(20);
  if (mode === 'adv') return { nat: Math.max(a, b), detail: `adv[${a},${b}]` };
  if (mode === 'dis') return { nat: Math.min(a, b), detail: `dis[${a},${b}]` };
  return { nat: a, detail: `[${a}]` };
}

module.exports = {
  armorOf,
  ROOT, DATA, STATE, LOG, loadState, saveState, appendLog, readLog, logFor,
  SEATS, INTENTS, loadSeats, saveSeats, seatByToken, newCode, normCode, readIntents, appendIntent,
  LISTEN, markListening, dmPresence, look, partyKnows, knowledge, undoCost, undoCostAny, readOffers,
  hasCond, featuresOf, turnInfo, provokersAlong, provokeDetail, attackPlan, attackCost, findAttack,
  parseCell, cellId, inBounds, distFeet, tagsAt, terrainName, blocksMove, isDifficult,
  recordTracks, trackCells, readTracks, trackGround, surfaceOf, Props, floorFeet, objectAt, elevAt, creatureElev, at, obstacleHeight, climbDC, wallSegments, wallIndex, wallBetween,
  occupant, hostile, speedOf, living, findPath, hasLOS, lineCells, wallsOnLine, stepWallTags, coverBetween, observerSees, partySeesCreature, visibleSet, sightCached, view, roll, d20, d,
};
