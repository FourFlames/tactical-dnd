// Homebrew power rating. Runs in Node (server, engine, tests) and in the browser (the builder).
//
// The yardstick is the "feat point" (FP): one origin feat (Tough, Alert, Skilled...) is 1 FP, a
// general feat with its +1 ability score is 2 FP. Every homebrew effect is priced from a small
// vocabulary, scaled by how often it applies and how often it can be used, then compared with the
// budget for its kind (a fighting style is worth about what Archery is worth, and so on).
// BENCHMARKS prices official content with the same vocabulary, so the scale is checked against the
// real thing (test.js keeps every benchmark within the power-creep allowance of its budget), and the
// builder can say "this is about as strong as Tough".
//
// Power creep: anything up to budget x (1 + creep) is allowed without the DM, and the overage counts
// against a small per-character pool. Past that, or for anything the vocabulary can't price, the DM
// (and JD) decide.
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Power = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULTS = { creep: 0.25, pool: 0.5, selfRatedCap: 0.75 };

  const SLOTS = {
    'origin-feat': { label: 'Origin feat', budget: 1.0, hint: 'Like Alert, Tough or Skilled. Replaces a background or human feat.' },
    feat: { label: 'General feat', budget: 2.0, hint: 'Like Resilient or Sharpshooter, usually including +1 to an ability. Taken at 4th level and up.' },
    'fighting-style': { label: 'Fighting style', budget: 1.0, hint: 'Like Archery or Dueling.' },
    'species-trait': { label: 'Species trait', budget: 0.5, hint: 'A trait that replaces one your species already has.' },
    species: { label: 'Whole species', budget: 1.8, hint: 'Everything a species gives, like Dwarf or Elf (not counting size and speed 30).' },
    'item-common': { label: 'Common magic item', budget: 0.5, hint: 'A trinket with a small, mostly flavorful effect.' },
    'item-uncommon': { label: 'Uncommon magic item', budget: 2.0, hint: 'Like a +1 weapon or Cloak of Protection. Needs the DM at character creation.' },
    'item-rare': { label: 'Rare magic item', budget: 3.5, hint: 'Like a +2 weapon. Needs the DM at character creation.' },
    other: { label: 'Something else', budget: null, hint: 'A new class feature, subclass, or anything that doesn\'t fit. The DM rates it.' },
  };

  const WHEN = { always: 1, often: 0.75, sometimes: 0.5, rarely: 0.25 };
  const WHEN_LABEL = { always: 'always', often: 'most of the time', sometimes: 'sometimes', rarely: 'rarely' };
  // Effects that are spent (a spell, a reroll) are priced per use per long rest; a short-rest refresh
  // is worth about 1.75 times as much. A passive effect that has to be switched on for a fight
  // (per rest) is worth a fraction of having it always.
  const PER_USE = { long: 1, short: 1.75 };
  const PER_BURST = { long: 0.3, short: 0.5 };

  const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
  const prof = (level) => 2 + Math.floor((Math.max(1, level) - 1) / 4);
  function avgDice(expr) {
    let total = 0;
    const s = String(expr || '').replace(/\s+/g, '');
    for (const t of s.match(/[+-]?[^+-]+/g) || []) {
      const sign = t[0] === '-' ? -1 : 1;
      const m = /^[+-]?(\d*)d(\d+)$/i.exec(t);
      if (m) total += sign * (Number(m[1] || 1) * (Number(m[2]) + 1)) / 2;
      else if (!isNaN(Number(t))) total += Number(t);
    }
    return total;
  }
  const PHYSICAL = ['bludgeoning', 'piercing', 'slashing'];
  const COMMON_TYPES = ['fire', 'cold', 'poison', 'necrotic', 'lightning', 'psychic'];
  const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
  const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

  // kind: { label, unit: what `value` means, cost(e, level) per application, spent: priced per use, self: self-rated }
  const KINDS = {
    ability: { label: '+1 to an ability score', group: 'Core', params: ['ability', 'value'], unit: 'points', cost: (e) => 1.0 * num(e.value, 1) },
    skill: { label: 'Skill proficiency', group: 'Core', params: ['skill'], cost: () => 0.33 },
    expertise: { label: 'Expertise (double proficiency in a skill)', group: 'Core', params: ['skill'], cost: () => 0.5 },
    tool: { label: 'Tool proficiency', group: 'Core', params: ['text'], cost: () => 0.2 },
    language: { label: 'Language', group: 'Core', params: ['text'], cost: () => 0.1 },
    save: { label: 'Saving throw proficiency', group: 'Defense', params: ['ability'], cost: (e) => (['dex', 'con', 'wis'].includes(e.ability) ? 1.0 : 0.5) },
    'save-bonus': { label: '+N to saving throws', group: 'Defense', params: ['ability|all', 'value'], unit: 'bonus', cost: (e) => num(e.value, 1) * (e.ability === 'all' || !e.ability ? 1.0 : 0.25) },
    ac: { label: '+N to AC', group: 'Defense', params: ['value'], unit: 'bonus', cost: (e) => 1.5 * num(e.value, 1) },
    'hp-per-level': { label: '+N hit points per level', group: 'Defense', params: ['value'], unit: 'HP per level', cost: (e) => 0.5 * num(e.value, 1) },
    hp: { label: '+N hit points', group: 'Defense', params: ['value'], unit: 'HP', cost: (e) => 0.1 * num(e.value, 5) },
    resistance: { label: 'Damage resistance', group: 'Defense', params: ['type'], cost: (e) => (PHYSICAL.includes(e.type) ? 1.5 : COMMON_TYPES.includes(e.type) ? 0.5 : 0.35) },
    immunity: { label: 'Damage immunity', group: 'Defense', params: ['type'], cost: (e) => 2 * (PHYSICAL.includes(e.type) ? 1.5 : COMMON_TYPES.includes(e.type) ? 0.5 : 0.35) },
    'condition-immunity': { label: 'Immunity to a condition', group: 'Defense', params: ['text'], cost: () => 0.6 },
    advantage: {
      label: 'Advantage on a kind of roll', group: 'Defense', params: ['scope', 'text'],
      cost: (e) => ({ skill: 0.25, 'save-condition': 0.25, 'ability-checks': 0.5, 'save-ability': 0.75, initiative: 0.5, attacks: 1.5 })[e.scope || 'skill'] || 0.25,
    },
    attack: { label: '+N to attack rolls', group: 'Offense', params: ['value', 'scope'], unit: 'bonus', cost: (e) => 1.0 * num(e.value, 1) * scopeOf(e) },
    damage: { label: '+N damage on hits', group: 'Offense', params: ['value', 'scope'], unit: 'damage', cost: (e) => 0.6 * num(e.value, 1) * scopeOf(e) },
    'damage-dice': { label: 'Extra damage dice on hits', group: 'Offense', params: ['dice', 'scope', 'type'], cost: (e) => 0.6 * avgDice(e.dice || '1d4') * scopeOf(e) },
    'crit-range': { label: 'Crit on a 19 too', group: 'Offense', params: [], cost: () => 1.0 },
    'bonus-attack': { label: 'An attack as a bonus action', group: 'Offense', params: [], cost: () => 1.5 },
    'extra-attack': { label: 'An extra attack with the Attack action', group: 'Offense', params: [], cost: () => 3.0 },
    'weapon-training': { label: 'Martial weapon proficiency', group: 'Offense', params: [], cost: () => 0.5 },
    'armor-training': { label: 'Armor training', group: 'Defense', params: ['armor'], cost: (e) => ({ light: 0.5, medium: 0.75, heavy: 1.0, shield: 0.5 })[e.armor || 'light'] },
    speed: { label: '+N ft walking speed', group: 'Movement', params: ['value'], unit: 'ft', cost: (e) => 0.05 * num(e.value, 5) },
    'climb-speed': { label: 'Climbing speed', group: 'Movement', params: [], cost: () => 0.25 },
    'swim-speed': { label: 'Swimming speed', group: 'Movement', params: [], cost: () => 0.25 },
    'fly-speed': { label: 'Flying speed', group: 'Movement', params: [], cost: (e, level) => (level >= 5 ? 1.5 : 2.5) },
    darkvision: { label: 'Darkvision', group: 'Senses', params: ['value'], unit: 'ft', cost: (e) => (num(e.value, 60) >= 120 ? 0.4 : 0.25) },
    initiative: { label: '+N to initiative', group: 'Core', params: ['value'], unit: 'bonus', cost: (e) => 0.25 * num(e.value, 1) },
    'initiative-prof': { label: 'Add proficiency bonus to initiative', group: 'Core', params: [], cost: () => 0.75 },
    cantrip: { label: 'A cantrip', group: 'Magic', params: ['text'], cost: () => 0.3 },
    spell: { label: 'Cast a spell (per rest)', group: 'Magic', params: ['text', 'value'], unit: 'spell level', spent: true, cost: (e) => 0.4 * Math.max(1, num(e.value, 1)) },
    reroll: { label: 'Reroll a d20 (per rest)', group: 'Magic', params: [], spent: true, cost: () => 0.45 },
    'temp-hp': { label: 'Temporary hit points (per rest)', group: 'Defense', params: ['value'], unit: 'temp HP', spent: true, cost: (e) => 0.05 * num(e.value, 5) },
    heal: { label: 'Healing (per rest)', group: 'Magic', params: ['dice'], spent: true, cost: (e) => 0.05 * avgDice(e.dice || '1d8') },
    minor: { label: 'Small perk (self-rated)', group: 'Judgment', params: ['text'], self: true, cost: () => 0.25 },
    edge: { label: 'Combat edge (self-rated)', group: 'Judgment', params: ['text'], self: true, cost: () => 0.5 },
    major: { label: 'Major ability (the DM rates it)', group: 'Judgment', params: ['text'], self: true, cost: () => null },
  };
  // How much of the game an attack/damage effect touches.
  function scopeOf(e) {
    const s = { all: 1, melee: 0.75, ranged: 0.5, weapon: 0.9, spell: 0.75, thrown: 0.5, heavy: 0.75, unarmed: 0.25, 'once-per-turn': 0.8 }[e.scope || 'all'];
    return s === undefined ? 1 : s;
  }
  const SCOPES = { all: 'all attacks', weapon: 'weapon attacks', melee: 'melee attacks', ranged: 'ranged attacks', spell: 'spell attacks', thrown: 'thrown weapons', heavy: 'heavy weapons', unarmed: 'unarmed strikes', 'once-per-turn': 'once per turn' };
  const ADV_SCOPES = { skill: 'one skill', 'ability-checks': 'one ability\'s checks', 'save-condition': 'saves against one condition', 'save-ability': 'one ability\'s saves', initiative: 'initiative', attacks: 'attack rolls (in some situation)' };

  function usesOf(e, level) {
    if (e.uses === 'prof') return prof(level);
    if (e.uses === 'mod') return 3;
    return Math.max(1, num(e.uses, 1));
  }
  // The price of one effect at a given character level.
  function priceEffect(e, level = 4) {
    const k = KINDS[e.kind];
    if (!k) return { cost: null, label: `Unknown effect "${e.kind}"`, self: true, unknown: true };
    const base = k.cost(e, level);
    const when = WHEN[e.when || 'always'] || 1;
    const per = e.per && e.per !== 'atwill' ? e.per : null;
    let cost = base, note = '';
    if (base === null) return { cost: null, label: describe(e), self: true };
    if (k.spent) {
      const n = usesOf(e, level);
      cost = base * n * (PER_USE[per || 'long'] || 1);
      note = `${n}/${per === 'short' ? 'short' : 'long'} rest`;
    } else if (per) {
      const n = usesOf(e, level);
      cost = base * n * (PER_BURST[per] || 0.3);
      note = `${n}/${per} rest, for one fight`;
    }
    cost *= when;
    return { cost: Math.round(cost * 100) / 100, label: describe(e) + (note ? ` (${note})` : '') + (e.when && e.when !== 'always' ? `, ${WHEN_LABEL[e.when]}` : ''), self: !!k.self };
  }
  function describe(e) {
    const k = KINDS[e.kind];
    if (!k) return e.kind;
    const v = num(e.value, null);
    switch (e.kind) {
      case 'ability': return `+${v || 1} ${String(e.ability || 'any').toUpperCase()}`;
      case 'skill': return `Proficiency: ${e.skill || 'a skill'}`;
      case 'expertise': return `Expertise: ${e.skill || 'a skill'}`;
      case 'save': return `Saving throw proficiency: ${String(e.ability || '?').toUpperCase()}`;
      case 'save-bonus': return `+${v || 1} to ${e.ability && e.ability !== 'all' ? e.ability.toUpperCase() + ' saves' : 'all saves'}`;
      case 'ac': return `+${v || 1} AC`;
      case 'hp-per-level': return `+${v || 1} HP per level`;
      case 'hp': return `+${v || 5} HP`;
      case 'resistance': return `Resistance to ${e.type || 'a damage type'}`;
      case 'immunity': return `Immunity to ${e.type || 'a damage type'}`;
      case 'advantage': return `Advantage on ${e.text || ADV_SCOPES[e.scope || 'skill']}`;
      case 'attack': return `+${v || 1} to hit with ${SCOPES[e.scope || 'all']}`;
      case 'damage': return `+${v || 1} damage with ${SCOPES[e.scope || 'all']}`;
      case 'damage-dice': return `+${e.dice || '1d4'}${e.type ? ' ' + e.type : ''} damage with ${SCOPES[e.scope || 'all']}`;
      case 'speed': return `+${v || 5} ft speed`;
      case 'darkvision': return `Darkvision ${v || 60} ft`;
      case 'initiative': return `+${v || 1} initiative`;
      case 'armor-training': return `${e.armor || 'light'} armor training`;
      case 'spell': return `Cast ${e.text || 'a spell'}${v ? ` (level ${v})` : ''}`;
      case 'cantrip': return `Cantrip: ${e.text || 'one cantrip'}`;
      case 'temp-hp': return `${v || 5} temporary HP`;
      case 'heal': return `Heal ${e.dice || '1d8'}`;
      default: return e.text ? `${k.label.replace(/ \(.*\)$/, '')}: ${e.text}` : k.label;
    }
  }

  // Official content priced with the same vocabulary. Values are at 4th level (proficiency +2).
  // `weak: true` marks content widely held to be underpowered; it stays as a comparison point.
  const BENCHMARKS = [
    { name: 'Tough', slot: 'origin-feat', effects: [{ kind: 'hp-per-level', value: 2 }] },
    { name: 'Alert', slot: 'origin-feat', effects: [{ kind: 'initiative-prof' }, { kind: 'minor', text: 'swap initiative with an ally' }] },
    { name: 'Skilled', slot: 'origin-feat', effects: [{ kind: 'skill' }, { kind: 'skill' }, { kind: 'skill' }] },
    { name: 'Lucky', slot: 'origin-feat', effects: [{ kind: 'reroll', uses: 'prof', per: 'long' }, { kind: 'minor', text: 'spend a point to give an attacker disadvantage' }] },
    { name: 'Magic Initiate', slot: 'origin-feat', effects: [{ kind: 'cantrip' }, { kind: 'cantrip' }, { kind: 'spell', value: 1, per: 'long' }] },
    { name: 'Savage Attacker', slot: 'origin-feat', effects: [{ kind: 'damage', value: 1.5, scope: 'once-per-turn' }, { kind: 'minor', text: 'reroll weapon damage once per turn' }] },
    { name: 'Tavern Brawler', slot: 'origin-feat', effects: [{ kind: 'damage', value: 1.5, scope: 'unarmed' }, { kind: 'minor', text: 'reroll 1s on unarmed damage' }, { kind: 'minor', text: 'push 5 ft on an unarmed hit' }, { kind: 'minor', text: 'improvised weapon proficiency' }] },
    { name: 'Healer', slot: 'origin-feat', effects: [{ kind: 'heal', dice: '1d8+2', uses: 2, per: 'long' }, { kind: 'minor', text: 'reroll 1s on healing' }] },
    { name: 'Archery', slot: 'fighting-style', effects: [{ kind: 'attack', value: 2, scope: 'ranged' }] },
    { name: 'Defense', slot: 'fighting-style', effects: [{ kind: 'ac', value: 1, when: 'often' }] },
    { name: 'Dueling', slot: 'fighting-style', effects: [{ kind: 'damage', value: 2, scope: 'melee' }] },
    { name: 'Thrown Weapon Fighting', slot: 'fighting-style', effects: [{ kind: 'damage', value: 2, scope: 'thrown' }, { kind: 'minor', text: 'draw a thrown weapon as part of the attack' }] },
    { name: 'Great Weapon Fighting', slot: 'fighting-style', effects: [{ kind: 'damage', value: 1.3, scope: 'heavy' }, { kind: 'minor', text: 'treat 1s and 2s as 3s' }] },
    { name: 'Resilient (CON)', slot: 'feat', effects: [{ kind: 'ability', ability: 'con', value: 1 }, { kind: 'save', ability: 'con' }] },
    { name: 'Speedy', slot: 'feat', effects: [{ kind: 'ability', ability: 'dex', value: 1 }, { kind: 'speed', value: 10 }, { kind: 'minor', text: 'Dash ignores difficult terrain' }, { kind: 'minor', text: 'opportunity attacks against you have disadvantage' }] },
    { name: 'Skill Expert', slot: 'feat', effects: [{ kind: 'ability', value: 1 }, { kind: 'skill' }, { kind: 'expertise' }] },
    { name: 'Observant', slot: 'feat', effects: [{ kind: 'ability', ability: 'wis', value: 1 }, { kind: 'expertise', skill: 'perception' }, { kind: 'minor', text: 'Search as a bonus action' }] },
    { name: 'Sharpshooter', slot: 'feat', effects: [{ kind: 'ability', ability: 'dex', value: 1 }, { kind: 'edge', text: 'ignore half and three-quarters cover' }, { kind: 'minor', text: 'no disadvantage at long range' }, { kind: 'minor', text: 'no disadvantage firing in melee' }] },
    { name: 'Great Weapon Master', slot: 'feat', effects: [{ kind: 'ability', ability: 'str', value: 1 }, { kind: 'damage', value: 2, scope: 'heavy', when: 'often' }, { kind: 'edge', text: 'bonus action attack after a crit or a kill' }] },
    { name: 'Heavily Armored', slot: 'feat', effects: [{ kind: 'ability', ability: 'con', value: 1 }, { kind: 'armor-training', armor: 'heavy' }] },
    { name: 'Durable', slot: 'feat', effects: [{ kind: 'ability', ability: 'con', value: 1 }, { kind: 'advantage', scope: 'save-condition', text: 'death saving throws' }, { kind: 'minor', text: 'spend a Hit Die as a bonus action' }] },
    { name: 'Dwarf', slot: 'species', effects: [{ kind: 'darkvision', value: 120 }, { kind: 'resistance', type: 'poison' }, { kind: 'advantage', scope: 'save-condition', text: 'saves against poison' }, { kind: 'hp-per-level', value: 1 }, { kind: 'minor', text: 'Stonecunning tremorsense' }] },
    { name: 'Halfling', slot: 'species', effects: [{ kind: 'advantage', scope: 'save-condition', text: 'saves against fear' }, { kind: 'minor', text: 'move through larger creatures' }, { kind: 'edge', text: 'reroll natural 1s on d20 tests' }, { kind: 'minor', text: 'hide behind larger creatures' }] },
    { name: 'Orc', slot: 'species', effects: [{ kind: 'darkvision', value: 120 }, { kind: 'edge', text: 'Adrenaline Rush: bonus Dash plus temporary HP' }, { kind: 'edge', text: 'Relentless Endurance: drop to 1 HP instead of 0 once' }] },
    { name: 'High Elf', slot: 'species', effects: [{ kind: 'darkvision', value: 60 }, { kind: 'advantage', scope: 'save-condition', text: 'saves against charm' }, { kind: 'skill' }, { kind: 'cantrip' }, { kind: 'spell', value: 1, per: 'long' }, { kind: 'minor', text: 'Trance' }] },
    { name: 'Cloak of Protection', slot: 'item-uncommon', effects: [{ kind: 'ac', value: 1 }, { kind: 'save-bonus', ability: 'all', value: 1 }] },
    { name: '+1 Weapon', slot: 'item-uncommon', effects: [{ kind: 'attack', value: 1, scope: 'weapon' }, { kind: 'damage', value: 1, scope: 'weapon' }] },
    { name: 'Bracers of Archery', slot: 'item-uncommon', weak: true, effects: [{ kind: 'damage', value: 2, scope: 'ranged' }, { kind: 'minor', text: 'longbow and shortbow proficiency' }] },
    { name: 'Driftglobe', slot: 'item-common', weak: true, effects: [{ kind: 'minor', text: 'a floating light' }] },
    { name: 'Potion of Healing', slot: 'item-common', effects: [{ kind: 'heal', dice: '2d4+2', uses: 1, per: 'long' }] },
    { name: '+2 Weapon', slot: 'item-rare', effects: [{ kind: 'attack', value: 2, scope: 'weapon' }, { kind: 'damage', value: 2, scope: 'weapon' }] },
  ];

  // Rate one homebrew element: { slot, effects } at a level, against the table's settings.
  function rate(hb, opts = {}) {
    const cfg = Object.assign({}, DEFAULTS, opts.config || {});
    const level = opts.level || 4;
    const slot = SLOTS[hb.slot] || SLOTS.other;
    const parts = (hb.effects || []).map((e) => Object.assign(priceEffect(e, level), { kind: e.kind }));
    const unpriced = parts.filter((p) => p.cost === null);
    const cost = Math.round(parts.reduce((t, p) => t + (p.cost || 0), 0) * 100) / 100;
    const selfRated = Math.round(parts.filter((p) => p.self && p.cost).reduce((t, p) => t + p.cost, 0) * 100) / 100;
    const budget = slot.budget;
    const dm = [];
    if (!parts.length) dm.push('it has no effects listed yet');
    if (budget === null) dm.push(`"${slot.label}" has no fixed budget`);
    if (unpriced.length) dm.push(`${unpriced.length === 1 ? 'one effect needs' : unpriced.length + ' effects need'} the DM to rate ${unpriced.length === 1 ? 'it' : 'them'}`);
    if (selfRated > cfg.selfRatedCap) dm.push(`self-rated perks add up to ${selfRated} FP (the table allows ${cfg.selfRatedCap} without the DM)`);
    if (/^item-(uncommon|rare)/.test(hb.slot) && !opts.inPlay) dm.push('a starting magic item above common needs the DM');
    const ratio = budget ? cost / budget : null;
    let verdict;
    if (dm.length && budget === null || unpriced.length || !parts.length) verdict = 'dm';
    else if (ratio > 1 + cfg.creep) verdict = 'over';
    else if (ratio > 1) verdict = 'creep';
    else if (ratio < 0.6) verdict = 'under';
    else verdict = 'fair';
    if (verdict === 'over') dm.push(`${cost} FP is over the ${budget} FP budget plus the ${Math.round(cfg.creep * 100)}% power-creep allowance`);
    const overage = budget && cost > budget ? Math.round((cost - budget) * 100) / 100 : 0;
    const sameSlot = BENCHMARKS.filter((b) => b.slot === hb.slot).map((b) => ({ name: b.name, cost: benchCost(b, level) }));
    const compare = sameSlot.sort((a, b) => Math.abs(a.cost - cost) - Math.abs(b.cost - cost)).slice(0, 3);
    return {
      slot: hb.slot, slotLabel: slot.label, budget, cost, ratio, verdict, parts, selfRated, overage, compare,
      ceiling: budget ? Math.round(budget * (1 + cfg.creep) * 100) / 100 : null,
      needsDm: dm.length > 0, dm, summary: summarize(verdict, cost, budget, cfg),
    };
  }
  function benchCost(b, level = 4) {
    return Math.round(b.effects.reduce((t, e) => t + (priceEffect(e, level).cost || 0), 0) * 100) / 100;
  }
  function summarize(verdict, cost, budget, cfg) {
    switch (verdict) {
      case 'under': return `Weaker than official options (${cost} of ${budget} FP). Fine as is, or add something.`;
      case 'fair': return `On par with official options (${cost} of ${budget} FP).`;
      case 'creep': return `A bit stronger than official (${cost} of ${budget} FP), inside the ${Math.round(cfg.creep * 100)}% power-creep allowance.`;
      case 'over': return `Too strong to approve automatically (${cost} of ${budget} FP). Trim it, or send it to the DM.`;
      default: return 'The DM needs to rate this one.';
    }
  }
  // Every element of a character, together: overages spend from the pool; past it, the DM decides.
  function ratePool(ratings, cfg = {}) {
    const pool = cfg.pool !== undefined ? cfg.pool : DEFAULTS.pool;
    const used = Math.round(ratings.filter((r) => r.verdict === 'creep').reduce((t, r) => t + r.overage, 0) * 100) / 100;
    return { pool, used, over: used > pool };
  }

  return { DEFAULTS, SLOTS, KINDS, WHEN, SCOPES, ADV_SCOPES, DAMAGE_TYPES, ABILITIES, BENCHMARKS, rate, ratePool, priceEffect, describe, benchCost, avgDice, prof };
});
