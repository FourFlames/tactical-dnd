// Inventory and resource tracking on each creature's existing `resources` field.
// Usage: node engine.js inv <id> [add|use|set|give] ...
'use strict';

// Resource names that are abilities, not objects (checked with spaces/_/- stripped, case-insensitive).
const INTRINSIC = /slot|actionsurge|secondwind|^ki(points)?$|^rage|channeldivinity|sorcerypoints|superiority|layonhands|wildshape|inspiration|hitdice/i;

module.exports = {
  usage: 'inv <id> | inv <id> add|use|set <item> [n] | inv <id> give <to> <item> [n] [--force]',
  description: 'Show or change what a creature carries, using its `resources` (items, ammo, spell slots, class features). "use" rejects if there are not enough; spent items stay listed at 0. "give" moves items between creatures within 5 ft (living givers must be able to act; downed enemies can be looted; flags a second object interaction in a turn as costing an action). Item names match case-insensitively; quote multi-word names.',
  origin: 'Rope Bridge: Rook mopped up the spilled lamp oil into a waterskin (2 flasks), and Ash\'s spell slots drifted from the sheet because nothing could spend them.',
  run(s, { pos, flags }, api) {
    const { C, who, fail, hasCond, turnState } = api;
    const [id, verb, ...rest] = pos;
    if (!id) fail(`Usage: ${module.exports.usage}`);
    const c = who(id);
    c.resources = c.resources || {};
    const R = c.resources;
    const list = (x) => Object.entries(x.resources || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing';
    // Match an existing key case-insensitively ("Javelins" -> "javelins"); own keys only, so "constructor" etc. are safe.
    const keyIn = (bag, item) => Object.keys(bag).find((k) => k.toLowerCase() === String(item).toLowerCase()) || item;
    const amount = (who_, bag, k) => {
      if (!Object.prototype.hasOwnProperty.call(bag, k)) return 0;
      if (typeof bag[k] !== 'number') fail(`${who_.name}'s "${k}" is ${JSON.stringify(bag[k])}, not a count; fix it with "set" first.`);
      return bag[k];
    };

    if (!verb) { console.log(`${c.name} carries: ${list(c)}.`); return null; }

    const count = (raw) => {
      const n = raw === undefined ? 1 : Number(raw);
      if (raw === '' || !Number.isInteger(n) || n < 0) fail(`"${raw}" is not a whole number. (Multi-word items need quotes.)`);
      return n;
    };
    let text, secret = !!c.hidden;
    if (verb === 'add' || verb === 'use' || verb === 'set') {
      const [rawItem, raw] = rest;
      if (!rawItem) fail(`Usage: inv ${id} ${verb} <item> [n]`);
      const item = keyIn(R, rawItem);
      const n = count(raw), have = verb === 'set' ? 0 : amount(c, R, item);
      if (verb === 'add') { R[item] = have + n; text = `${c.name} gains ${n} ${item} (now ${R[item]}).`; }
      else if (verb === 'set') { R[item] = n; text = `${c.name}'s ${item} set to ${n}.`; }
      else {
        if (have < n) fail(`${c.name} has ${have} ${item}, needs ${n}. Carries: ${list(c)}.`);
        R[item] = have - n;
        text = `${c.name} uses ${n} ${item} (${R[item]} left).`;
      }
    } else if (verb === 'give') {
      const [toId, rawItem, raw] = rest;
      if (!toId || !rawItem) fail(`Usage: inv ${id} give <to> <item> [n]`);
      const t = who(toId), n = count(raw);
      if (t === c) fail('Cannot give to yourself.');
      if (!c.pos || !t.pos) fail('Both creatures must be on the map to hand items over.');
      if (C.distFeet(C.parseCell(c.pos), C.parseCell(t.pos)) > 5) fail(`${t.name} must be within 5 ft to hand items over.`);
      // A corpse (non-party at 0 HP) can be looted this way; a living giver must be able to act.
      const corpse = c.hp <= 0 && c.side !== 'party';
      const stuck = ['unconscious', 'incapacitated', 'paralyzed', 'stunned', 'petrified'].filter((k) => hasCond(c, k));
      if (!corpse && (stuck.length || c.hp <= 0)) fail(`${c.name} can't hand anything over (${stuck.join(', ') || '0 HP'}). Taking it from them is a ruling.`);
      const item = keyIn(R, rawItem), have = amount(c, R, item);
      // Spell slots and class features live in `resources` too, but they aren't objects you can hand over.
      if (INTRINSIC.test(item.replace(/[\s_-]/g, '')) && !flags.force) fail(`"${item}" looks like a spell slot or class feature, which can't be handed over. Use --force if it really is an object.`);
      if (have < n) fail(`${c.name} has ${have} ${item}, needs ${n}.`);
      t.resources = t.resources || {};
      const tItem = keyIn(t.resources, item), tHave = amount(t, t.resources, tItem);
      R[item] = have - n;
      t.resources[tItem] = tHave + n;
      text = corpse
        ? `${t.name} takes ${n} ${item} from ${c.name} (${t.name}: ${t.resources[tItem]}).`
        : `${c.name} gives ${n} ${item} to ${t.name} (${c.name}: ${R[item]}, ${t.name}: ${t.resources[tItem]}).`;
      // RAW (2014 PHB p.190 / 2024 free object interaction): handing over or picking up one item is the turn's
      // one free object interaction; a second one costs the Use an Object / Utilize action. Flag, don't block.
      const actor = corpse ? toId : id;
      if (s.turnOrder && s.turnOrder.length && s.turnOrder[s.turnIdx] === actor) {
        const ts = turnState(s, actor);
        if (ts.objectUsed) text += ' (Second object interaction this turn: costs an action.)';
        ts.objectUsed = true;
      }
      secret = secret || !!t.hidden;
    } else fail(`Unknown verb "${verb}". Use add, use, set or give.`);

    // Hidden creatures' inventory changes go to the DM-only log so they don't leak to the player view.
    C.appendLog(s, secret ? 'secret' : 'action', text);
    console.log(text);
    return s;
  },
};
