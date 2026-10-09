#!/usr/bin/env node
// The rules engine. The DM (Claude Code) calls this instead of editing state by hand.
// Every command validates, updates state.json, appends to log.jsonl, and prints a short result.
// Run `node engine.js help` for the command list.
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./lib/core');

const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SKILLS = {
  athletics: 'str', acrobatics: 'dex', 'sleight-of-hand': 'dex', stealth: 'dex',
  arcana: 'int', history: 'int', investigation: 'int', nature: 'int', religion: 'int',
  'animal-handling': 'wis', insight: 'wis', medicine: 'wis', perception: 'wis', survival: 'wis',
  deception: 'cha', intimidation: 'cha', performance: 'cha', persuasion: 'cha',
};

// ---------- arg parsing ----------
function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[k] = next; i++; } else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}
function fail(msg) { console.log(`REJECTED: ${msg}`); process.exit(2); }
function need(s) { if (!s) fail('No encounter loaded. Run: node engine.js load <encounter>'); return s; }
function who(s, id) {
  const c = s.creatures[id];
  if (!c) fail(`No creature "${id}". Known: ${Object.keys(s.creatures).join(', ')}`);
  return c;
}
const mod = (score) => Math.floor(((score || 10) - 10) / 2);
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
const advMode = (f) => (f.adv && !f.dis ? 'adv' : f.dis && !f.adv ? 'dis' : null);
function turnState(s, id) {
  s.turn = s.turn || {};
  s.turn[id] = s.turn[id] || { used: 0, dash: false, disengage: false };
  return s.turn[id];
}
function hasCond(c, name) { return (c.conditions || []).some((x) => x.name === name); }

// ---------- damage ----------
function applyDamage(s, id, amount, type) {
  const c = who(s, id);
  let amt = amount;
  let note = '';
  const t = (type || '').toLowerCase();
  if (t && (c.immune || []).includes(t)) { amt = 0; note = ' (immune)'; }
  else if (t && (c.resist || []).includes(t)) { amt = Math.floor(amt / 2); note = ' (resisted)'; }
  else if (t && (c.vulnerable || []).includes(t)) { amt *= 2; note = ' (vulnerable)'; }
  if (c.tempHp && amt > 0) { const soak = Math.min(c.tempHp, amt); c.tempHp -= soak; amt -= soak; }
  c.hp = Math.max(0, c.hp - amt);
  let status = '';
  if (c.hp === 0) {
    if (c.side === 'party') { status = ` ${c.name} drops to 0 HP and is dying!`; addCond(c, 'unconscious'); c.deathSaves = c.deathSaves || { ok: 0, fail: 0 }; }
    else status = ` ${c.name} goes down.`;
  }
  return { amt, text: `${c.name} takes ${amt}${t ? ' ' + t : ''} damage${note} (${c.hp}/${c.maxHp}).${status}` };
}
function addCond(c, name, rounds) {
  c.conditions = (c.conditions || []).filter((x) => x.name !== name);
  c.conditions.push(rounds ? { name, rounds: Number(rounds) } : { name });
}

// ---------- commands ----------
const CMDS = {};
const HELP = [];
function cmd(name, usage, fn) { CMDS[name] = fn; HELP.push(`  ${usage}`); }

cmd('load', 'load <encounter>                   start an encounter from encounters/<name>.json (resets state + log)', (s, { pos }) => {
  const file = path.join(C.ROOT, 'encounters', pos[0].replace(/\.json$/, '') + '.json');
  if (!fs.existsSync(file)) fail(`No encounter file ${file}`);
  const enc = JSON.parse(fs.readFileSync(file, 'utf8'));
  enc.height = enc.rows.length; enc.width = enc.rows[0].length;
  enc.round = 0; enc.turnOrder = []; enc.turnIdx = 0; enc.turn = {}; enc.explored = []; enc.tagOverrides = {};
  for (const [id, c] of Object.entries(enc.creatures)) { c.maxHp = c.maxHp || c.hp; c.conditions = c.conditions || []; c.id = id; }
  C.wallSegments(enc); // throws on a malformed wall
  if (fs.existsSync(C.LOG)) fs.unlinkSync(C.LOG);
  C.saveState(enc);
  C.appendLog(enc, 'scene', enc.intro || `Encounter: ${enc.name}`);
  if (enc.dmNotes) C.appendLog(enc, 'secret', `DM notes: ${enc.dmNotes}`);
  console.log(`Loaded "${enc.name}" (${enc.width}x${enc.height}).`);
  return null;
});

cmd('show', 'show [--player]                    ASCII battlemap + creature table (DM view by default)', (s, { flags }) => {
  need(s);
  const v = C.view(s, flags.player ? 'player' : 'dm');
  const glyph = {};
  for (const c of Object.values(v.creatures)) glyph[c.pos] = c.side === 'party' ? c.id[0].toUpperCase() : c.id[0].toLowerCase();
  let out = '    ' + Array.from({ length: s.width }, (_, x) => String.fromCharCode(65 + x)).join('') + '\n';
  v.cells.forEach((row, y) => {
    out += String(y + 1).padStart(3) + ' ' + row.map((cell, x) => {
      const id = C.cellId(x, y);
      if (cell.fog === 'unknown') return ' ';
      if (glyph[id] && cell.fog === 'visible') return glyph[id];
      return cell.ch;
    }).join('') + '\n';
  });
  out += '\nLegend: ' + Object.entries(s.legend).map(([k, l]) => `${k}=${l.name}`).join('  ') + '   Tokens: first letter of id (UPPER=party, lower=others)\n';
  const ov = Object.entries(s.tagOverrides || {}).filter(([, o]) => (o.add || []).length || (o.remove || []).length);
  const walls = C.wallSegments(s).filter((w) => !flags.player || v.walls.some((x) => x.from === w.from && x.to === w.to));
  if (walls.length) out += 'Walls (along grid lines): ' + walls.map((w) => `${w.id ? w.id + ' ' : ''}${w.from}-${w.to}${w.kind !== 'wall' ? ' ' + w.kind : ''}${w.kind === 'door' ? (w.open ? ' (open)' : ' (closed)') : ''}${w.hidden ? ' (secret)' : ''}`).join(', ') + '\n';
  if (ov.length) out += 'Terrain changes: ' + ov.map(([k, o]) => `${k}:+${(o.add || []).join('+')}${(o.remove || []).length ? ' -' + o.remove.join('-') : ''}`).join('  ') + '\n';
  out += '\n';
  for (const c of Object.values(v.creatures)) {
    const conds = c.conditions.map((x) => x.name + (x.rounds ? `(${x.rounds})` : '')).join(',');
    const hp = c.hp !== undefined ? `${c.hp}/${c.maxHp} AC${c.ac}` : c.health;
    const pos = c.elev ? `${c.pos}@${c.elev}ft` : c.pos;
    out += `${c.id.padEnd(10)} ${c.name.padEnd(16)} ${c.side.padEnd(7)} ${pos.padEnd(4)} ${hp}${conds ? ' [' + conds + ']' : ''}${c.hidden ? ' (hidden)' : ''}\n`;
  }
  if (s.turnOrder && s.turnOrder.length) out += `\nRound ${s.round}, turn: ${s.turnOrder[s.turnIdx]}  order: ${s.turnOrder.join(' > ')}`;
  console.log(out);
  return null;
});

cmd('status', 'status <id>                        full sheet for one creature', (s, { pos }) => {
  const c = who(need(s), pos[0]);
  console.log(JSON.stringify(c, null, 2));
  if (s.turn && s.turn[pos[0]]) console.log('This turn:', JSON.stringify(s.turn[pos[0]]));
  return null;
});

cmd('range', 'range <a> <b|cell>                  distance, line of sight, cover', (s, { pos }) => {
  need(s);
  const a = C.parseCell(who(s, pos[0]).pos);
  const b = C.parseCell(s.creatures[pos[1]] ? s.creatures[pos[1]].pos : pos[1]);
  const cov = C.coverBetween(s, a, b);
  const rise = (s.creatures[pos[1]] ? C.creatureElev(s, s.creatures[pos[1]]) : C.elevAt(s, b.x, b.y)) - C.creatureElev(s, who(s, pos[0]));
  const height = rise ? `, target is ${Math.abs(rise)} ft ${rise > 0 ? 'higher' : 'lower'} (not yet in the rules: rule on it)` : '';
  console.log(`${C.distFeet(a, b)} ft, line of sight: ${C.hasLOS(s, a, b) ? 'yes' : 'NO'}${cov ? `, cover +${cov} AC` : ''}${height}`);
  return null;
});

cmd('move', 'move <id> <cell> [--force]          pathed move; checks speed, walls, enemies, difficult terrain; warns on opportunity attacks', (s, { pos, flags }) => {
  need(s);
  const id = pos[0], c = who(s, id);
  const dest = C.cellId(C.parseCell(pos[1]).x, C.parseCell(pos[1]).y);
  const dp = C.parseCell(dest);
  if (!C.inBounds(s, dp.x, dp.y)) fail(`${dest} is off the map.`);
  if (C.blocksMove(C.tagsAt(s, dp.x, dp.y))) fail(`${dest} is ${C.terrainName(s, dp.x, dp.y)} and can't be entered.`);
  const occ = C.occupant(s, dp.x, dp.y, id);
  if (occ) fail(`${dest} is occupied by ${s.creatures[occ].name}.`);
  if (c.hp <= 0 && c.side !== 'party') fail(`${c.name} is down.`);
  if (['grappled', 'restrained', 'paralyzed', 'stunned', 'unconscious', 'incapacitated'].some((k) => hasCond(c, k)) && !flags.force) fail(`${c.name} can't move (${c.conditions.map((x) => x.name).join(', ')}).`);
  const path = C.findPath(s, id, dest);
  if (!path) fail(`No route from ${c.pos} to ${dest} (walls or enemies in the way). If a creative ruling allows it, use --force or "place".`);
  const ts = turnState(s, id);
  let budget = C.speedOf(c) * (ts.dash ? 2 : 1);
  if (hasCond(c, 'prone')) budget = Math.floor(budget / 2);
  const left = budget - ts.used;
  if (path.cost > left && !flags.force) fail(`${c.name} needs ${path.cost} ft to reach ${dest} but has ${left} ft left this turn${ts.dash ? '' : ' (could dash)'}.`);
  // opportunity attacks: leaving a hostile's reach
  const provokers = [];
  if (!ts.disengage && !flags.force) {
    for (const [oid, o] of Object.entries(s.creatures)) {
      if (!o.pos || o.hp <= 0 || !C.hostile(c, o) || hasCond(o, 'incapacitated')) continue;
      const reach = Math.max(5, ...(o.attacks || []).filter((a) => !a.range).map((a) => a.reach || 5));
      const op = C.parseCell(o.pos);
      for (let i = 0; i < path.cells.length - 1; i++) {
        const inNow = C.distFeet(C.parseCell(path.cells[i]), op) <= reach;
        const inNext = C.distFeet(C.parseCell(path.cells[i + 1]), op) <= reach;
        if (inNow && !inNext) { provokers.push(oid); break; }
      }
    }
  }
  ts.used += path.cost;
  const from = c.pos;
  c.pos = dest;
  const terr = C.tagsAt(s, dp.x, dp.y);
  let text = `${c.name} moves ${from} → ${dest} (${path.cost} ft, ${Math.max(0, budget - ts.used)} ft left).`;
  if (flags.force) text += ' [forced by ruling]';
  if (terr.length) text += ` Lands on ${C.terrainName(s, dp.x, dp.y)} [${terr.join(', ')}].`;
  if (provokers.length) text += ` PROVOKES opportunity attack from: ${provokers.join(', ')}.`;
  C.appendLog(s, 'move', text, { id, from, to: dest, path: path.cells });
  console.log(text);
  return s;
});

cmd('place', 'place <id> <cell>                  forced movement / teleport, no cost or pathing (shoves, falls, spells)', (s, { pos }) => {
  need(s);
  const c = who(s, pos[0]);
  const p = C.parseCell(pos[1]);
  if (!C.inBounds(s, p.x, p.y)) fail('Off the map.');
  const occ = C.occupant(s, p.x, p.y, pos[0]);
  if (occ) fail(`${pos[1]} is occupied by ${s.creatures[occ].name}.`);
  const from = c.pos; c.pos = C.cellId(p.x, p.y);
  const text = `${c.name} is moved ${from} → ${c.pos}.`;
  C.appendLog(s, 'move', text, { id: pos[0], from, to: c.pos });
  console.log(text);
  return s;
});

cmd('dash', 'dash <id>                          double movement this turn', (s, { pos }) => {
  const c = who(need(s), pos[0]); turnState(s, pos[0]).dash = true;
  const t = `${c.name} dashes.`; C.appendLog(s, 'action', t); console.log(t); return s;
});
cmd('disengage', 'disengage <id>                     no opportunity attacks this turn', (s, { pos }) => {
  const c = who(need(s), pos[0]); turnState(s, pos[0]).disengage = true;
  const t = `${c.name} disengages.`; C.appendLog(s, 'action', t); console.log(t); return s;
});

cmd('attack', 'attack <att> <target> [weapon] [--adv|--dis] [--bonus N] [--extra 1d6]   roll to hit + damage, checks reach/range/LOS/cover', (s, { pos, flags }) => {
  need(s);
  const a = who(s, pos[0]), t = who(s, pos[1]);
  if (a.hp <= 0 && a.side !== 'party') fail(`${a.name} is down.`);
  const attacks = a.attacks || [];
  if (!attacks.length) fail(`${a.name} has no attacks listed.`);
  const w = pos[2] ? attacks.find((x) => x.name.toLowerCase().includes(pos[2].toLowerCase())) : attacks[0];
  if (!w) fail(`${a.name} has no attack matching "${pos[2]}". Has: ${attacks.map((x) => x.name).join(', ')}`);
  const ap = C.parseCell(a.pos), tp = C.parseCell(t.pos);
  const dist = C.distFeet(ap, tp);
  if (!C.hasLOS(s, ap, tp)) fail(`${a.name} has no line of sight to ${t.name}.`);
  let mode = advMode(flags);
  const notes = [];
  if (w.range) {
    const [norm, long] = w.range;
    if (dist > long) fail(`${t.name} is ${dist} ft away; ${w.name} max range is ${long} ft.`);
    if (dist > norm) { mode = mode === 'adv' ? null : 'dis'; notes.push('long range'); }
    const adjacentFoe = Object.values(s.creatures).some((o) => o.pos && o.hp > 0 && C.hostile(a, o) && C.distFeet(ap, C.parseCell(o.pos)) <= 5 && !hasCond(o, 'incapacitated'));
    if (adjacentFoe) { mode = mode === 'adv' ? null : 'dis'; notes.push('hostile adjacent'); }
  } else {
    const reach = w.reach || 5;
    if (dist > reach) fail(`${t.name} is ${dist} ft away; ${w.name} reach is ${reach} ft.`);
  }
  if (hasCond(t, 'prone')) { const m2 = w.range ? 'dis' : 'adv'; mode = mode && mode !== m2 ? null : m2; notes.push('target prone'); }
  if (['restrained', 'paralyzed', 'stunned', 'unconscious', 'blinded'].some((k) => hasCond(t, k))) { mode = mode === 'dis' ? null : 'adv'; notes.push('target ' + t.conditions.map((x) => x.name).join('/')); }
  if (a.hidden) { mode = mode === 'dis' ? null : 'adv'; notes.push('unseen attacker'); a.hidden = false; }
  const cover = C.coverBetween(s, ap, tp);
  if (cover) notes.push(`cover +${cover}`);
  const r = C.d20(mode);
  const bonus = (w.bonus || 0) + Number(flags.bonus || 0);
  const total = r.nat + bonus;
  const ac = (t.ac || 10) + cover;
  const crit = r.nat === 20 || (r.nat >= 19 && w.critRange === 19);
  const paralysedCrit = !w.range && dist <= 5 && ['paralyzed', 'unconscious'].some((k) => hasCond(t, k));
  const hit = r.nat !== 1 && (crit || total >= ac);
  let text = `${a.name} attacks ${t.name} with ${w.name}: ${r.detail}${sign(bonus)} = ${total} vs AC ${ac}${notes.length ? ' (' + notes.join(', ') + ')' : ''} → `;
  if (!hit) text += r.nat === 1 ? 'natural 1, miss.' : 'miss.';
  else {
    const isCrit = crit || paralysedCrit;
    const dmgExpr = w.damage + (flags.extra ? `+${flags.extra}` : '');
    const dr = C.roll(dmgExpr, { crit: isCrit });
    const res = applyDamage(s, pos[1], Math.max(0, dr.total), w.type);
    text += `${isCrit ? 'CRITICAL HIT! ' : 'hit! '}${dmgExpr} ${dr.detail} = ${dr.total}. ${res.text}`;
  }
  C.appendLog(s, 'attack', text, { attacker: pos[0], target: pos[1], hit });
  console.log(text);
  return s;
});

cmd('damage', 'damage <id> <amount|dice> [type] [--save dex --dc 13 --half]   apply damage (optionally with a save)', (s, { pos, flags }) => {
  need(s);
  const c = who(s, pos[0]);
  const dr = /d/i.test(pos[1]) ? C.roll(pos[1]) : { total: Number(pos[1]), detail: pos[1] };
  let amt = dr.total, pre = '';
  if (flags.save && flags.dc) {
    const sv = saveRoll(c, flags.save, Number(flags.dc), advMode(flags));
    pre = sv.text + ' ';
    if (sv.ok) amt = flags.half ? Math.floor(amt / 2) : 0;
  }
  const res = applyDamage(s, pos[0], amt, pos[2]);
  const text = `${pre}${pos[1]} ${dr.detail !== pos[1] ? dr.detail + ' ' : ''}→ ${res.text}`;
  C.appendLog(s, 'damage', text); console.log(text); return s;
});

cmd('heal', 'heal <id> <amount|dice>              restore HP (clears dying)', (s, { pos }) => {
  const c = who(need(s), pos[0]);
  const r = /d/i.test(pos[1]) ? C.roll(pos[1]) : { total: Number(pos[1]) };
  c.hp = Math.min(c.maxHp, c.hp + r.total);
  if (c.hp > 0) { c.conditions = (c.conditions || []).filter((x) => x.name !== 'unconscious'); delete c.deathSaves; }
  const t = `${c.name} heals ${r.total} (${c.hp}/${c.maxHp}).`; C.appendLog(s, 'heal', t); console.log(t); return s;
});

function abilityBonus(c, stat) {
  const k = stat.toLowerCase();
  if (SKILLS[k]) {
    const sk = (c.skills || {})[k];
    return { label: k, bonus: sk !== undefined ? sk : mod((c.stats || {})[SKILLS[k]]) };
  }
  if (ABIL.includes(k)) return { label: k.toUpperCase(), bonus: mod((c.stats || {})[k]) };
  fail(`Unknown ability/skill "${stat}". Use str/dex/... or a skill like athletics.`);
}
function saveRoll(c, stat, dc, mode) {
  const k = stat.toLowerCase();
  const bonus = (c.saves || {})[k] !== undefined ? c.saves[k] : mod((c.stats || {})[k]);
  if (['str', 'dex'].includes(k) && ['paralyzed', 'stunned', 'unconscious'].some((x) => hasCond(c, x))) {
    return { ok: false, text: `${c.name} auto-fails the ${k.toUpperCase()} save.` };
  }
  const r = C.d20(mode);
  const total = r.nat + bonus;
  return { ok: total >= dc, text: `${c.name} ${k.toUpperCase()} save ${r.detail}${sign(bonus)} = ${total} vs DC ${dc}: ${total >= dc ? 'success' : 'FAIL'}.` };
}

cmd('save', 'save <id> <ability> <dc> [--adv|--dis]', (s, { pos, flags }) => {
  const c = who(need(s), pos[0]);
  const r = saveRoll(c, pos[1], Number(pos[2]), advMode(flags));
  C.appendLog(s, 'roll', r.text); console.log(r.text); return s;
});

cmd('check', 'check <id> <skill|ability> <dc> [--adv|--dis] [--about "text"]', (s, { pos, flags }) => {
  const c = who(need(s), pos[0]);
  const { label, bonus } = abilityBonus(c, pos[1]);
  const dc = Number(pos[2]);
  const r = C.d20(advMode(flags));
  const total = r.nat + bonus;
  const text = `${c.name} ${label} check${flags.about ? ` to ${flags.about}` : ''}: ${r.detail}${sign(bonus)} = ${total} vs DC ${dc}: ${total >= dc ? 'SUCCESS' : 'FAIL'}.`;
  C.appendLog(s, 'roll', text); console.log(text); return s;
});

cmd('ruling', 'ruling <id> <skill|ability> <dc> --about "what they try" --success "outcome" --fail "outcome"   creative action: DM sets terms, dice decide', (s, { pos, flags }) => {
  const c = who(need(s), pos[0]);
  if (!flags.about || !flags.success || !flags.fail) fail('A ruling needs --about, --success and --fail so the stakes are set before the roll.');
  const { label, bonus } = abilityBonus(c, pos[1]);
  const dc = Number(pos[2]);
  const r = C.d20(advMode(flags));
  const total = r.nat + bonus;
  const ok = total >= dc;
  const text = `RULING: ${c.name} tries to ${flags.about}. ${label} ${r.detail}${sign(bonus)} = ${total} vs DC ${dc} → ${ok ? 'SUCCESS: ' + flags.success : 'FAIL: ' + flags.fail}`;
  C.appendLog(s, 'ruling', text, { id: pos[0], ok });
  console.log(text + '\nNow apply the outcome with engine commands (damage, place, condition, terrain...).');
  return s;
});

cmd('condition', 'condition <id> add|remove <name> [rounds]', (s, { pos }) => {
  const c = who(need(s), pos[0]);
  if (pos[1] === 'add') addCond(c, pos[2], pos[3]);
  else c.conditions = (c.conditions || []).filter((x) => x.name !== pos[2]);
  const t = `${c.name} ${pos[1] === 'add' ? 'is now' : 'is no longer'} ${pos[2]}${pos[3] && pos[1] === 'add' ? ` (${pos[3]} rounds)` : ''}.`;
  C.appendLog(s, 'condition', t); console.log(t); return s;
});

cmd('terrain', 'terrain <cell[,cell...]|C3:E5> add|remove <tag>   e.g. terrain D4:F4 add burning', (s, { pos }) => {
  need(s);
  const cells = expandCells(pos[0]);
  s.tagOverrides = s.tagOverrides || {};
  for (const id of cells) {
    const o = (s.tagOverrides[id] = s.tagOverrides[id] || { add: [], remove: [] });
    if (pos[1] === 'add') { o.add = [...new Set([...o.add, pos[2]])]; o.remove = o.remove.filter((x) => x !== pos[2]); }
    else { o.remove = [...new Set([...o.remove, pos[2]])]; o.add = o.add.filter((x) => x !== pos[2]); }
  }
  const t = `Terrain ${pos[1] === 'add' ? '+' : '-'}${pos[2]} at ${cells.join(', ')}.`;
  C.appendLog(s, 'terrain', t, { cells, tag: pos[2], op: pos[1] }); console.log(t); return s;
});
function expandCells(spec) {
  const out = [];
  for (const part of spec.split(',')) {
    if (part.includes(':')) {
      const [a, b] = part.split(':').map(C.parseCell);
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) out.push(C.cellId(x, y));
    } else { const p = C.parseCell(part); out.push(C.cellId(p.x, p.y)); }
  }
  return out;
}

cmd('door', 'door <wall-id> open|close           open or shut a door (or reveal a secret one by opening it)', (s, { pos }) => {
  need(s);
  const w = (s.walls || []).find((x) => typeof x === 'object' && x.id === pos[0]);
  if (!w) fail(`No wall with id "${pos[0]}". Doors: ${(s.walls || []).filter((x) => x.kind === 'door').map((x) => x.id).join(', ') || 'none'}`);
  if (w.kind !== 'door') fail(`${pos[0]} is a ${w.kind || 'wall'}, not a door.`);
  if (!['open', 'close'].includes(pos[1])) fail('Say "open" or "close".');
  w.open = pos[1] === 'open';
  if (w.open) w.hidden = false;
  const t = `The door ${pos[0]} (${w.from}-${w.to}) ${w.open ? 'swings open' : 'shuts'}.`;
  C.appendLog(s, 'terrain', t); console.log(t); return s;
});

cmd('spawn', `spawn '<json>'                     add a creature, e.g. spawn '{"id":"wolf1","name":"Wolf","side":"enemy","pos":"B2","hp":11,"ac":13,"speed":40,"attacks":[{"name":"Bite","bonus":4,"damage":"2d4+2","type":"piercing"}]}'`, (s, { pos }) => {
  need(s);
  let c; try { c = JSON.parse(pos[0]); } catch (e) { fail('spawn needs valid JSON: ' + e.message); }
  if (!c.id || !c.pos) fail('spawn JSON needs at least id and pos.');
  if (s.creatures[c.id]) fail(`"${c.id}" already exists.`);
  const p = C.parseCell(c.pos);
  if (C.occupant(s, p.x, p.y)) fail(`${c.pos} is occupied.`);
  Object.assign(c, { name: c.name || c.id, side: c.side || 'enemy', hp: c.hp || 1, conditions: c.conditions || [], controller: c.controller || 'dm' });
  c.maxHp = c.maxHp || c.hp;
  s.creatures[c.id] = c;
  if (s.turnOrder && s.turnOrder.length) {
    c.init = C.d(20) + mod((c.stats || {}).dex);
    s.turnOrder.push(c.id); // acts at end of the round it appears in
  }
  const t = `${c.name} appears at ${c.pos}.`;
  C.appendLog(s, c.hidden ? 'secret' : 'spawn', t); console.log(t); return s;
});

cmd('remove', 'remove <id>                        take a creature off the map (fled, dissolved, etc.)', (s, { pos }) => {
  const c = who(need(s), pos[0]);
  delete s.creatures[pos[0]];
  const idx = (s.turnOrder || []).indexOf(pos[0]);
  if (idx >= 0) { s.turnOrder.splice(idx, 1); if (s.turnIdx > idx) s.turnIdx--; if (s.turnIdx >= s.turnOrder.length) s.turnIdx = 0; }
  const t = `${c.name} leaves the battlefield.`; C.appendLog(s, 'action', t); console.log(t); return s;
});

cmd('hide', 'hide <id> | reveal <id>             toggle hidden (hidden enemies never appear on the player view)', (s, { pos }) => {
  const c = who(need(s), pos[0]); c.hidden = true;
  const t = `${c.name} is hidden.`; C.appendLog(s, c.side === 'party' ? 'action' : 'secret', t); console.log(t); return s;
});
CMDS.reveal = (s, { pos }) => {
  const c = who(need(s), pos[0]); c.hidden = false;
  const t = `${c.name} is revealed at ${c.pos}!`; C.appendLog(s, 'action', t); console.log(t); return s;
};

cmd('initiative', 'initiative                         roll initiative for everyone and start round 1', (s) => {
  need(s);
  const rolls = [];
  for (const [id, c] of Object.entries(s.creatures)) {
    if (!c.pos || (c.hp <= 0 && c.side !== 'party')) continue;
    const r = C.d(20), b = c.initBonus !== undefined ? c.initBonus : mod((c.stats || {}).dex);
    c.init = r + b; rolls.push(`${c.name} ${c.init}`);
  }
  s.turnOrder = Object.keys(s.creatures).filter((id) => s.creatures[id].init !== undefined)
    .sort((a, b) => s.creatures[b].init - s.creatures[a].init || ((s.creatures[b].stats || {}).dex || 10) - ((s.creatures[a].stats || {}).dex || 10));
  s.round = 1; s.turnIdx = 0; s.turn = {};
  const first = s.creatures[s.turnOrder[0]];
  const t = `Roll for initiative! ${rolls.join(', ')}. Round 1 begins: ${first.name}'s turn.`;
  C.appendLog(s, 'turn', t); console.log(t + turnHint(s)); return s;
});

function turnHint(s) {
  const id = s.turnOrder[s.turnIdx], c = s.creatures[id];
  const ctl = c.controller || (c.side === 'party' ? 'llm' : 'dm');
  const who = ctl === 'player' ? 'THE PLAYER (wait for their input)' : ctl === 'llm' ? `party agent (spawn the pc agent for "${id}")` : 'you, the DM';
  return `\n→ ${c.name} [${id}] at ${c.pos}, controlled by ${who}.${c.hp <= 0 && c.side === 'party' ? ' They are dying: roll "deathsave ' + id + '".' : ''}`;
}

cmd('next', 'next                               end the current turn, start the next (ticks condition durations)', (s) => {
  need(s);
  if (!s.turnOrder || !s.turnOrder.length) fail('No initiative yet. Run: initiative');
  for (let guard = 0; guard < 100; guard++) {
    s.turnIdx++;
    if (s.turnIdx >= s.turnOrder.length) { s.turnIdx = 0; s.round++; }
    const c = s.creatures[s.turnOrder[s.turnIdx]];
    if (c && (c.hp > 0 || c.side === 'party')) break;
  }
  const id = s.turnOrder[s.turnIdx], c = s.creatures[id];
  s.turn = {};
  const expired = [];
  c.conditions = (c.conditions || []).filter((x) => {
    if (x.rounds === undefined) return true;
    x.rounds--; if (x.rounds <= 0) { expired.push(x.name); return false; } return true;
  });
  const burning = C.tagsAt(s, C.parseCell(c.pos).x, C.parseCell(c.pos).y).includes('burning');
  let t = `Round ${s.round}: ${c.name}'s turn.`;
  if (expired.length) t += ` (${expired.join(', ')} wore off.)`;
  if (burning) t += ` ${c.name} starts the turn in fire!`;
  C.appendLog(s, 'turn', t); console.log(t + turnHint(s)); return s;
});

cmd('deathsave', 'deathsave <id>', (s, { pos }) => {
  const c = who(need(s), pos[0]);
  if (c.hp > 0) fail(`${c.name} isn't dying.`);
  c.deathSaves = c.deathSaves || { ok: 0, fail: 0 };
  const r = C.d(20);
  let t = `${c.name} death save [${r}]: `;
  if (r === 20) { c.hp = 1; delete c.deathSaves; c.conditions = c.conditions.filter((x) => x.name !== 'unconscious'); t += 'natural 20, back up with 1 HP!'; }
  else if (r === 1) { c.deathSaves.fail += 2; t += 'natural 1, two failures.'; }
  else if (r >= 10) { c.deathSaves.ok++; t += 'success.'; }
  else { c.deathSaves.fail++; t += 'failure.'; }
  if (c.deathSaves) {
    t += ` (${c.deathSaves.ok} ok / ${c.deathSaves.fail} fail)`;
    if (c.deathSaves.fail >= 3) { t += ` ${c.name} dies.`; addCond(c, 'dead'); }
    else if (c.deathSaves.ok >= 3) { t += ` ${c.name} is stable.`; addCond(c, 'stable'); }
  }
  C.appendLog(s, 'roll', t); console.log(t); return s;
});

cmd('roll', 'roll <dice> [--about "text"] [--secret]', (s, { pos, flags }) => {
  const r = C.roll(pos[0]);
  const t = `Roll ${pos[0]}${flags.about ? ` (${flags.about})` : ''}: ${r.detail} = ${r.total}.`;
  if (s) C.appendLog(s, flags.secret ? 'secret' : 'roll', t);
  console.log(t); return s;
});

cmd('say', 'say "<text>"                       one line of narration for the viewer log (keep it short)', (s, { pos }) => {
  C.appendLog(need(s), 'narration', pos.join(' ')); console.log('logged.'); return null;
});
cmd('secret', 'secret "<text>"                    DM-only note (hidden from the player view)', (s, { pos }) => {
  C.appendLog(need(s), 'secret', pos.join(' ')); console.log('logged (DM only).'); return null;
});

cmd('ext', 'ext                                list approved library commands in ext/', () => {
  const dir = path.join(C.ROOT, 'ext');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  if (!files.length) console.log('No library commands yet.');
  for (const f of files) { const m = require(path.join(dir, f)); console.log(`  ${m.usage || f.replace('.js', '')}\n      ${m.description || ''}`); }
  return null;
});

cmd('help', 'help', () => {
  console.log('Engine commands (node engine.js <cmd> ...):\n' + HELP.join('\n') + '\n\nApproved library commands: node engine.js ext');
  return null;
});

// ---------- dispatch ----------
function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (!name) return CMDS.help();
  const args = parseArgs(rest);
  let state = C.loadState();
  let fn = CMDS[name];
  if (!fn) {
    const extFile = path.join(C.ROOT, 'ext', `${name}.js`);
    if (!fs.existsSync(extFile)) fail(`Unknown command "${name}". Run "help", or "ext" for library commands. If nothing fits, resolve it with "ruling" and consider proposing a library command in pending/.`);
    const ext = require(extFile);
    fn = (s, a) => ext.run(need(s), a, { C, who: (id) => who(s, id), fail, applyDamage: (id, n, t) => applyDamage(s, id, n, t), addCond, saveRoll, abilityBonus, expandCells, turnState, hasCond, mod, sign, advMode });
  }
  try {
    const out = fn(state, args);
    if (out) C.saveState(out);
  } catch (e) {
    fail(e.message);
  }
}
main();
