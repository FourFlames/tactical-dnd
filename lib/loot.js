// Scattered contents (Card 14e). A broken container spills orbs; what is in them is decided in the background
// (actualize: authored contents, one model call per container, or the DM) and only revealed when someone
// looks, picks up, or walks up with light (collapse). The player view never shows which stage an orb is in.
// State: s.orbs = [{ id, at, from, item, collapsed }], s.loot[crateId] = { status: pending|ready|dm, items, source, brokeBy, ... }.
'use strict';

const fs = require('fs');
const path = require('path');
const G = require('./grid');
const Props = require('./props');

const core = () => require('./core'); // core requires this file for its view, so load it late
const TAGS = ['fragile', 'loose', 'sealed', 'flammable', 'valuable'];
const CONTAINERS = ['crate', 'barrel'];
const STALE_MS = 90000; // an actualize call that never reported back is tried again after this long

// ---------- seeded randomness ----------
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (arr, rand) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- config, tiers, caps ----------
function config() {
  let mc = {};
  try { mc = JSON.parse(fs.readFileSync(path.join(core().ROOT, 'minds.config.json'), 'utf8')); } catch { /* defaults */ }
  const l = mc.loot || {};
  return { concurrency: l.concurrency || 2, maxCalls: l.maxCalls || 20, maxCost: l.maxCost || 0.25, timeout: l.timeout || 20000,
    model: l.model || (mc.models || {}).loot || (mc.models || {}).minion || null };
}
const TIERS = [[4, 1, 4, 25], [10, 2, 5, 100], [16, 3, 6, 500], [99, 4, 6, 2000]]; // up to level, tier, items, gp per container
function partyLevel(s) {
  if (Number(s.partyLevel) > 0) return Number(s.partyLevel);
  const lv = Object.values(s.creatures || {}).filter((c) => c.side === 'party').map((c) => Number(c.level) || Number((/\b[A-Z][a-z]+ (\d{1,2})\b/.exec(c.notes || '') || [])[1]) || 0).filter(Boolean);
  return lv.length ? Math.max(...lv) : 3;
}
function capsFor(s) {
  const level = partyLevel(s), t = TIERS.find((x) => level <= x[0]), tr = s.treasure || {};
  return { level, tier: t[1], maxItems: Math.max(1, Math.floor(Number(tr.maxItems)) || t[2]), maxGp: Number(tr.maxGp) >= 0 && tr.maxGp !== undefined ? Number(tr.maxGp) : t[3] };
}
const stats = (s) => (s.lootStats = s.lootStats || { calls: 0, cost: 0, failed: 0 });

// ---------- items: validate, consequences, grouping ----------
function normItem(x, max = 20) {
  if (typeof x === 'string') x = { name: x };
  if (!x || typeof x !== 'object' || typeof x.name !== 'string' || !x.name.trim()) return null;
  const qty = Math.min(max, Math.max(1, Math.round(Number(x.qty === undefined ? 1 : x.qty)) || 1));
  const gp = Math.max(0, Math.round((Number(x.gp) || 0) * 100) / 100);
  return { name: x.name.trim().slice(0, 60), qty, tags: [...new Set((Array.isArray(x.tags) ? x.tags : []).filter((t) => TAGS.includes(t)))],
    gp, desc: typeof x.desc === 'string' ? x.desc.trim().slice(0, 200) : '' };
}
// A model's (or anyone's) item list against the caps: malformed entries dropped, quantities clamped, stacks and total gp capped.
function validate(raw, caps, { trust = false } = {}) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.items) ? raw.items : [];
  const dropped = [];
  let items = [];
  list.forEach((x, i) => { const it = normItem(x, trust ? 99 : 20); if (it) items.push(it); else dropped.push(`#${i + 1} malformed`); });
  if (!trust) {
    if (items.length > caps.maxItems) { dropped.push(`${items.length - caps.maxItems} over the ${caps.maxItems}-item cap`); items = items.slice(0, caps.maxItems); }
    const total = items.reduce((n, it) => n + it.gp, 0);
    if (total > caps.maxGp) { const k = caps.maxGp / total; items.forEach((it) => { it.gp = Math.floor(it.gp * k * 100) / 100; }); dropped.push(`gp scaled to ${caps.maxGp}`); }
  }
  return { items, dropped };
}
function parseReply(text) {
  const a = [text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0).sort((x, y) => x - y)[0];
  if (a === undefined) throw new Error('no JSON in the answer');
  const close = text[a] === '{' ? '}' : ']', b = text.lastIndexOf(close);
  if (b <= a) throw new Error('no JSON in the answer');
  return JSON.parse(text.slice(a, b + 1));
}
// What breaking the container did to what was inside. One roll per item, in order, so it is repeatable.
function consequences(items, by, rand) {
  const blunt = by === 'bludgeoning', fire = by === 'fire';
  return items.map((it) => {
    const r = rand();
    if (it.tags.includes('sealed')) return it;
    if (fire && it.tags.includes('flammable')) return Object.assign({}, it, { name: `burnt ${it.name}`, gp: 0, tags: [], desc: `${it.desc} Burnt beyond use.`.trim() });
    if (it.tags.includes('fragile') && r < (blunt ? 0.6 : 0.2)) return Object.assign({}, it, { name: `broken ${it.name}`, gp: 0, tags: [], desc: `${it.desc} Shattered when the container broke.`.trim() });
    if (it.tags.includes('loose') && r < (blunt ? 0.6 : 0.3)) return Object.assign({}, it, { desc: `${it.desc} Dirty and bruised.`.trim() });
    return it;
  });
}
const itemName = (it) => (it.qty > 1 ? `${it.qty} x ${it.name}` : it.name);
const pubItem = (it) => (it ? { name: it.name, qty: it.qty, tags: it.tags, desc: it.desc } : null);
// One orb holds one stack; items beyond the orb count pile onto the last orbs (named together, picked up as parts).
function group(items) {
  if (items.length === 1) return items[0];
  const names = items.map(itemName);
  return { name: names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join(' and '), qty: 1,
    tags: [...new Set(items.flatMap((i) => i.tags))], gp: items.reduce((n, i) => n + i.gp, 0), desc: items.map((i) => i.desc).filter(Boolean).join(' '), parts: items };
}
function assign(s, id, items, rand) {
  const orbs = s.orbs.filter((o) => o.from === id), n = orbs.length;
  const order = shuffle(orbs, rand), piles = order.map(() => []);
  items.forEach((it, i) => piles[i < n ? i : n - 1 - ((i - n) % n)].push(it));
  order.forEach((o, i) => { o.item = piles[i].length ? group(piles[i]) : null; });
}

// ---------- scatter ----------
const isContainer = (o) => !o.empty && !(Array.isArray(o.contents) && !o.contents.length) && (o.contents !== undefined || CONTAINERS.includes(o.kind));
const blocked = (tags) => tags.includes('wall') || tags.includes('impassable');
// Squares 5-10 ft from `origin` an item could roll to: not walls, with no wall edge across a step of the way.
function landings(s, origin) {
  const idx = G.wallIndex(s), o = G.parseCell(origin), f0 = G.floorFeet(s, o.x, o.y);
  const step = (a, b) => G.inBounds(s, b.x, b.y) && !blocked(G.stepWallTags(idx, a.x, a.y, b.x, b.y));
  const open = (p) => !blocked(G.tagsAt(s, p.x, p.y));
  const out = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy)), p = { x: o.x + dx, y: o.y + dy };
    if (!d || !G.inBounds(s, p.x, p.y) || !open(p)) continue;
    const tags = G.tagsAt(s, p.x, p.y);
    if (!tags.includes('chasm') && Math.abs(G.floorFeet(s, p.x, p.y) - f0) > 5) continue;
    let ok = d === 1 && step(o, p);
    if (d === 2) {
      for (let my = -1; my <= 1 && !ok; my++) for (let mx = -1; mx <= 1 && !ok; mx++) {
        const m = { x: o.x + mx, y: o.y + my };
        if ((!mx && !my) || !G.inBounds(s, m.x, m.y) || !open(m)) continue;
        if (Math.max(Math.abs(p.x - m.x), Math.abs(p.y - m.y)) === 1 && step(o, m) && step(m, p)) ok = true;
      }
    }
    if (ok) out.push({ cell: G.cellId(p.x, p.y), fall: tags.includes('chasm') });
  }
  return out;
}
const authoredItems = (o) => (Array.isArray(o.contents) ? o.contents.map((x) => normItem(x, 99)).filter(Boolean) : null);

// A container just broke (by `type` damage): spill its orbs and settle where its contents will come from.
// Returns lines for the DM; the log gets the public and secret entries.
function scatter(s, o, type) {
  const lines = [];
  if (!isContainer(o)) return lines;
  const C = core(), by = (type || '').toLowerCase(), cell = String(o.at).split(':')[0];
  const authored = authoredItems(o), rand = seeded(`${s.game}:${o.id}`), count = authored ? Math.min(6, authored.length) : 1 + Math.floor(rand() * 3);
  if (authored && !authored.length) return lines;
  s.orbs = s.orbs || []; s.loot = s.loot || {};
  const cands = shuffle(landings(s, cell), rand), made = [];
  for (let i = 0; i < count; i++) {
    const land = cands.length ? cands[i % cands.length] : { cell, fall: false };
    const orb = { id: `orb${s.orbSeq = (s.orbSeq || 0) + 1}`, at: land.cell, from: o.id, item: null, collapsed: false };
    if (land.fall) orb.fell = true;
    s.orbs.push(orb); made.push(orb);
  }
  const vis = C.visibleSet(s), seen = vis.has(cell), live = made.filter((x) => !x.fell), fell = made.filter((x) => x.fell);
  const zone = zoneAt(s, cell);
  const L = s.loot[o.id] = { status: 'pending', items: null, source: null, brokeBy: by, kind: o.kind, name: o.name, cell, count, zone: zone ? { name: zone.name, desc: zone.desc, owner: zone.owner, hooks: zone.hooks } : null, place: placeName(s, cell),
    orbs: made.map((x) => x.id), tries: 0 };
  if (live.length) C.appendLog(s, seen ? 'loot' : 'secret', `${o.name} spills: something scatters across the floor.`, { loot: 'scatter', from: o.id, cells: live.map((x) => x.at), orbs: live.map((x) => ({ id: x.id, at: x.at })) });
  for (const f of fell) C.appendLog(s, seen || vis.has(f.at) ? 'loot' : 'secret', `Something from the ${o.name} tumbles over the edge at ${f.at} and is gone.`, { loot: 'fell', from: o.id, cells: [f.at], orb: f.id });
  if (!live.length) { Object.assign(L, { status: 'ready', items: [], source: 'lost' }); return lines; }
  if (authored) { Object.assign(L, { status: 'ready', items: consequences(authored, by, seeded(`${s.game}:${o.id}:after`)), source: 'authored' }); assign(s, o.id, L.items, seeded(`${s.game}:${o.id}:pile`)); return lines; }
  if (o.plot || (zone && zone.plot)) { toDm(s, o.id, 'plot-flagged', lines); return lines; }
  if (!process.env.OPENROUTER_API_KEY || !isRemote(config().model)) toDm(s, o.id, 'no model to ask', lines);
  return lines;
}
const isRemote = (m) => typeof m === 'string' && m.includes('/');
// The ground around a spot, for the prompt when no zone covers it (the square itself is debris by now).
function placeName(s, cell) {
  const p = G.parseCell(cell), n = {};
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = p.x + dx, y = p.y + dy;
    if ((!dx && !dy) || !G.inBounds(s, x, y) || blocked(G.tagsAt(s, x, y)) || (s.legend[s.rows[y][x]] || {}).debris) continue;
    const name = G.terrainName(s, x, y);
    n[name] = (n[name] || 0) + 1;
  }
  return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || 'a cave';
}
// The author-written zone around a square (smallest area wins), never the DM notes.
function zoneAt(s, cell) {
  const p = G.parseCell(cell), hit = [];
  for (const z of s.lootZones || []) {
    const [a, b] = String(z.area).split(':').map(G.parseCell), e = b || a;
    if (p.x >= Math.min(a.x, e.x) && p.x <= Math.max(a.x, e.x) && p.y >= Math.min(a.y, e.y) && p.y <= Math.max(a.y, e.y)) hit.push([(Math.abs(a.x - e.x) + 1) * (Math.abs(a.y - e.y) + 1), z]);
  }
  hit.sort((x, y) => x[0] - y[0]);
  return hit.length ? hit[0][1] : null;
}
// The DM decides what is in it: say so once, in the DM log and on the console.
function toDm(s, id, why, lines) {
  const L = s.loot[id];
  L.status = 'dm'; L.source = 'dm'; delete L.inflight;
  const line = `DM: ${L.name} (${id}) at ${L.cell} broke by ${L.brokeBy || 'something'}; ${why}. Decide what was in it: loot ${id} set '[{"name":"a rusty key","qty":1,"tags":["loose"],"gp":0,"desc":""}]'`;
  core().appendLog(s, 'secret', line, { loot: 'dm', crate: id });
  lines.push(line);
}

// ---------- actualize ----------
function prompt(s, id) {
  const L = s.loot[id], caps = capsFor(s), z = L.zone;
  const found = (s.found || []).slice(-20);
  const where = z ? `${z.name}${z.desc ? ': ' + z.desc : ''}${z.owner ? ` Owner: ${z.owner}.` : ''}${(z.hooks || []).length ? ` Hooks: ${z.hooks.join('; ')}.` : ''}` : L.place || 'a cave';
  return [`CONTAINER: ${L.name} (a ${L.kind}), broken by ${L.brokeBy || 'something'} damage.`, `PLACE: ${where}`,
    `PARTY: level ${caps.level}, treasure tier ${caps.tier}. This container holds at most ${caps.maxItems} stacks worth at most ${caps.maxGp} gp in all (gp is the stack's total value).`,
    `It spills into ${L.count} heap${L.count > 1 ? 's' : ''}; aim for about that many stacks.`,
    found.length ? `ALREADY FOUND this encounter (do not repeat): ${found.join(', ')}.` : ''].filter(Boolean).join('\n');
}
const SYSTEM = `You decide what is inside one broken container in a tactical D&D 5e game. Be believable for the place and its owner, mundane and modest unless the hooks say otherwise: rations, tools, rope, candles, coins, trade goods, a keepsake. No magic items, no plot items, nothing worth more than the caps. Tags: fragile (glass, pottery, eggs), loose (cloth, food, powder, paper), sealed (a locked tin, a wax-stoppered flask), flammable, valuable. Answer with one JSON object and nothing else: {"items":[{"name":"...","qty":1,"tags":["fragile"],"gp":3,"desc":"one short sentence"}]}`;

// Containers waiting for a model, most urgent first: a collapse waiting, in the party's view, within a party member's speed, the rest.
function pendingOrder(s) {
  const ids = Object.keys(s.loot || {}).filter((id) => s.loot[id].status === 'pending' && !(s.loot[id].inflight && Date.now() - s.loot[id].inflight < STALE_MS));
  if (!ids.length) return [];
  const C = core(), vis = C.visibleSet(s);
  const party = Object.values(s.creatures).filter((c) => c.side === 'party' && c.pos && c.hp > 0);
  const rank = (id) => {
    const orbs = s.orbs.filter((o) => o.from === id && !o.fell && !o.collapsed);
    if (orbs.some((o) => o.wanting)) return 0;
    if (orbs.some((o) => vis.has(o.at))) return 1;
    if (orbs.some((o) => party.some((c) => G.distFeet(G.at(s, c), G.parseCell(o.at)) <= C.speedOf(c)))) return 2;
    return 3;
  };
  return ids.map((id) => [rank(id), id]).sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1)).map((x) => x[1]);
}
const pendingCount = (s) => Object.values(s.loot || {}).filter((L) => L.status === 'pending').length;

// Mark the next wave as in flight (so nothing else asks for the same crates) and return it with the spent-cap fallbacks.
function claim(s, lines) {
  const cfg = config(), st = stats(s), wave = [];
  for (const id of pendingOrder(s)) {
    if (st.calls + wave.length >= cfg.maxCalls || st.cost >= cfg.maxCost) { toDm(s, id, `this encounter's loot budget is spent (${st.calls} calls, $${st.cost.toFixed(3)})`, lines); continue; }
    if (wave.length < cfg.concurrency) { s.loot[id].inflight = Date.now(); wave.push(id); }
  }
  return wave;
}
// Ask the model about one container. { id, items } or { id, error }; the caller applies it to fresh state.
async function ask(s, id) {
  const Think = require('./think'), model = config().model, t0 = Date.now();
  try {
    const r = await Think.ask(model, [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt(s, id) }], config().timeout);
    return { id, model, raw: parseReply(r.text), usage: r.usage, ms: Date.now() - t0 };
  } catch (e) { return { id, model, error: e.message, ms: Date.now() - t0 }; }
}
// Put the answers into the state (which may have moved on while the model thought); then collapses that were waiting complete.
function apply(s, results, lines) {
  const st = stats(s), caps = capsFor(s);
  for (const r of results) {
    const L = (s.loot || {})[r.id];
    if (!L || L.status !== 'pending') continue;
    delete L.inflight;
    st.calls++;
    if (r.usage) { st.cost += r.usage.cost || 0; require('./think').count(s, r.model, r.usage, r.ms); }
    if (r.error) { st.failed++; L.tries++; if (L.tries >= 2) toDm(s, r.id, `the model failed twice (${r.error})`, lines); else lines.push(`(loot ${r.id}: ${r.error}; will try again)`); continue; }
    const v = validate(r.raw, caps);
    L.items = consequences(v.items, L.brokeBy, seeded(`${s.game}:${r.id}:after`));
    L.source = 'model'; L.status = 'ready'; L.model = r.model;
    assign(s, r.id, L.items, seeded(`${s.game}:${r.id}:pile`));
    lines.push(`(loot ${r.id}: ${L.items.length} item stack${L.items.length === 1 ? '' : 's'} decided${v.dropped.length ? ` [${v.dropped.join('; ')}]` : ''})`);
  }
  return settle(s).concat(lines);
}
// The DM's own answer for a container.
function setItems(s, id, raw) {
  const L = (s.loot || {})[id];
  if (!L) throw new Error(`No loot record "${id}". ${Object.keys(s.loot || {}).join(', ') || 'Nothing has broken open yet.'}`);
  if (L.status === 'ready') throw new Error(`${id} is already decided.`);
  const v = validate(raw, capsFor(s), { trust: true });
  L.items = v.items; L.source = 'dm'; L.status = 'ready'; delete L.inflight;
  assign(s, id, L.items, seeded(`${s.game}:${id}:pile`));
  return settle(s);
}

// ---------- collapse ----------
const orbById = (s, id) => (s.orbs || []).find((o) => o.id === id && !o.fell) || null;
const cellOf = (o) => G.parseCell(o.at);
const seesCell = (s, cell) => core().visibleSet(s).has(cell);
// Reveal what an orb is. Not decided yet: the wait is recorded and the pump takes it first. Returns true once revealed.
function collapse(s, orb, by, lines) {
  const C = core(), L = (s.loot || {})[orb.from];
  if (orb.collapsed) return true;
  if (!L || L.status !== 'ready') {
    if (L && L.status === 'dm' && !orb.wanting) lines.push(`DM: ${by && s.creatures[by] ? s.creatures[by].name : 'someone'} is waiting on ${orb.id} (${orb.from}) at ${orb.at}: loot ${orb.from} set '<json items>'`);
    orb.wanting = true; orb.wantedBy = by; return false;
  }
  orb.collapsed = true; delete orb.wanting;
  const who = by && s.creatures[by] ? s.creatures[by].name : 'Someone';
  if (!orb.item) {
    s.orbs = s.orbs.filter((o) => o !== orb);
    const t = `${who} looks closer at ${orb.at}: only splinters and dust.`;
    C.appendLog(s, 'loot', t, { loot: 'collapse', orb: orb.id, item: null, cell: orb.at, by }); lines.push(t);
    return true;
  }
  (s.found = s.found || []).push(orb.item.name);
  const t = `${who} makes out ${itemName(orb.item)} at ${orb.at}.`;
  C.appendLog(s, 'loot', t, { loot: 'collapse', orb: orb.id, item: pubItem(orb.item), cell: orb.at, by }); lines.push(t);
  return true;
}
function settle(s) {
  const lines = [];
  for (const orb of (s.orbs || []).slice()) if (orb.wanting && !orb.collapsed && !orb.fell) collapse(s, orb, orb.wantedBy, lines);
  return lines;
}
// Looking at an orb: needs a line of sight. True when state changed.
function inspect(s, fromId, orb, lines) {
  const me = s.creatures[fromId];
  if (!me || me.side !== 'party' || !me.pos || orb.collapsed || orb.fell) return false;
  if (!G.hasLOS(s, G.at(s, me), Object.assign(cellOf(orb), { z: G.floorFeet(s, cellOf(orb).x, cellOf(orb).y) }))) return false;
  const was = !!orb.wanting;
  collapse(s, orb, fromId, lines);
  return !was || orb.collapsed;
}
function give(c, item) {
  c.inventory = c.inventory || [];
  for (const it of item.parts || [item]) {
    const have = c.inventory.find((x) => x.name === it.name && x.desc === it.desc);
    if (have) have.qty += it.qty; else c.inventory.push({ name: it.name, qty: it.qty, tags: it.tags, gp: it.gp, desc: it.desc });
  }
}
// A creature next to an orb picks it up (a free object interaction). { ok, waiting, lines }
function pickup(s, c, orb) {
  const C = core(), lines = [], a = G.parseCell(c.pos), b = cellOf(orb);
  if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) > 1) return { ok: false, why: `${orb.id} is at ${orb.at}; ${c.name} is at ${c.pos}. Pickup needs an adjacent square.` };
  if (!collapse(s, orb, c.id, lines)) return { ok: true, waiting: true, lines: [`Something's there at ${orb.at}… ${c.name} waits to see what it is.`] };
  const item = orb.item;
  if (!item) return { ok: true, lines };
  const party = c.side === 'party', seen = party || seesCell(s, orb.at);
  give(c, item);
  s.orbs = s.orbs.filter((o) => o !== orb);
  const t = `${c.name} picks up ${itemName(item)} at ${orb.at}.`;
  C.appendLog(s, seen ? 'loot' : 'secret', t, { loot: 'pickup', orb: orb.id, item: pubItem(item), cell: orb.at, by: c.id });
  lines.push(t);
  return { ok: true, lines };
}
// A party member has just finished a move: orbs next to them, in light and sight, collapse.
function afterMove(s, id) {
  const c = s.creatures[id], lines = [];
  if (!c || c.side !== 'party' || !c.pos || c.hp <= 0) return lines;
  const near = (s.orbs || []).filter((o) => !o.fell && !o.collapsed && Math.max(Math.abs(cellOf(o).x - G.parseCell(c.pos).x), Math.abs(cellOf(o).y - G.parseCell(c.pos).y)) <= 1);
  if (!near.length) return lines;
  const Minds = require('./minds'), ctx = Minds.newCtx(s), me = G.at(s, c);
  for (const o of near) {
    const p = cellOf(o), b = Object.assign(p, { z: G.floorFeet(s, p.x, p.y) });
    const lit = Minds.lightAt(s, ctx, p.x, p.y) > 0 || ((c.senses || {}).darkvision || 0) >= 5;
    if (lit && G.hasLOS(s, me, b)) collapse(s, o, id, lines);
  }
  return lines;
}
// Seen once, remembered after: an orb is on the player's map from the first time its square is in sight.
function noticeOrbs(s, vis) { for (const o of s.orbs || []) if (!o.known && vis.has(o.at)) o.known = true; }

// ---------- views ----------
// Player: { id, at } and nothing that differs between a decided orb and an undecided one, until it collapses
// (then its item) or a party member is waiting on it (then pending). DM: everything.
function viewOrbs(s, dm, cells) {
  return (s.orbs || []).flatMap((o) => {
    if (dm) return [Object.assign({ id: o.id, at: o.at, from: o.from, item: o.item, collapsed: !!o.collapsed, wanting: !!o.wanting, fell: !!o.fell, loot: (s.loot[o.from] || {}).status })];
    const p = cellOf(o), fog = cells[p.y] && cells[p.y][p.x] ? cells[p.y][p.x].fog : 'unknown';
    if (o.fell || fog === 'unknown' || (fog === 'remembered' && !o.known)) return [];
    const pub = { id: o.id, at: o.at };
    if (o.collapsed && o.item) pub.item = pubItem(o.item);
    else if (o.wanting) pub.pending = true;
    return [pub];
  });
}
function statLine(s) {
  const st = stats(s), cfg = config(), L = Object.values(s.loot || {});
  const by = (k) => L.filter((x) => x.status === k).length;
  return `Loot: ${st.calls}/${cfg.maxCalls} calls, $${st.cost.toFixed(4)}/$${cfg.maxCost}${st.failed ? `, ${st.failed} failed` : ''}; containers: ${by('pending')} pending, ${by('ready')} ready, ${by('dm')} with the DM; ${(s.orbs || []).filter((o) => !o.fell && !o.collapsed).length} orbs unrevealed.`;
}

module.exports = { seeded, capsFor, partyLevel, validate, parseReply, consequences, normItem, scatter, landings, zoneAt, isContainer, config, prompt, pendingOrder, pendingCount, claim, ask, apply, setItems, toDm,
  orbById, collapse, settle, inspect, pickup, afterMove, noticeOrbs, viewOrbs, statLine, give, pubItem, itemName };
