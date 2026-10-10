// Character rules (D&D 5e, 2024 rules) for the character builder. Runs in Node and in the browser.
//
// A character is stored as the choices a player made (a "build"): species, class, level,
// background, ability scores, picks, gear, homebrew. derive(build) turns those choices into
// everything else: the sheet the builder shows, the stat block the engine plays (the same shape
// as the creatures in encounters/), what is still left to choose, and anything that needs the DM.
// Nobody types "+5 to hit" by hand.
//
// Scope: all 12 classes, levels 1-20, one or two subclasses each, the 2024 species and backgrounds,
// origin and general feats, every standard weapon and armor, and a curated spell list up to 3rd
// level (higher-level spells can be typed in by name). Feature text is a short summary for play at
// the table, not the book's wording.
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./power'));
  else root.Rules = factory(root.Power);
})(typeof self !== 'undefined' ? self : this, function (Power) {
  const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const ABIL_NAME = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
  const SKILLS = {
    acrobatics: 'dex', 'animal-handling': 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int',
    insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
    performance: 'cha', persuasion: 'cha', religion: 'int', 'sleight-of-hand': 'dex', stealth: 'dex', survival: 'wis',
  };
  const ALL_SKILLS = Object.keys(SKILLS);
  const title = (id) => String(id).replace(/(^|-)([a-z])/g, (m, d, c) => (d ? ' ' : '') + c.toUpperCase());
  const skillName = (id) => title(id).replace('Of', 'of');
  const mod = (score) => Math.floor(((score || 10) - 10) / 2);
  const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
  const profBonus = (L) => 2 + Math.floor((Math.max(1, L) - 1) / 4);
  const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
  const POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
  const POINTS = 27;

  // ---------- gear ----------
  const W = (name, cat, dmg, type, props = [], extra = {}) => Object.assign({ name, cat, dmg, type, props }, extra);
  const WEAPONS = {
    club: W('Club', 'simple', '1d4', 'bludgeoning', ['light']),
    dagger: W('Dagger', 'simple', '1d4', 'piercing', ['finesse', 'light', 'thrown'], { range: [20, 60] }),
    greatclub: W('Greatclub', 'simple', '1d8', 'bludgeoning', ['two-handed']),
    handaxe: W('Handaxe', 'simple', '1d6', 'slashing', ['light', 'thrown'], { range: [20, 60] }),
    javelin: W('Javelin', 'simple', '1d6', 'piercing', ['thrown'], { range: [30, 120] }),
    'light-hammer': W('Light Hammer', 'simple', '1d4', 'bludgeoning', ['light', 'thrown'], { range: [20, 60] }),
    mace: W('Mace', 'simple', '1d6', 'bludgeoning'),
    quarterstaff: W('Quarterstaff', 'simple', '1d6', 'bludgeoning', ['versatile'], { versatile: '1d8' }),
    sickle: W('Sickle', 'simple', '1d4', 'slashing', ['light']),
    spear: W('Spear', 'simple', '1d6', 'piercing', ['thrown', 'versatile'], { range: [20, 60], versatile: '1d8' }),
    dart: W('Dart', 'simple', '1d4', 'piercing', ['finesse', 'thrown'], { range: [20, 60] }),
    'light-crossbow': W('Light Crossbow', 'simple', '1d8', 'piercing', ['ammunition', 'loading', 'two-handed'], { range: [80, 320] }),
    shortbow: W('Shortbow', 'simple', '1d6', 'piercing', ['ammunition', 'two-handed'], { range: [80, 320] }),
    sling: W('Sling', 'simple', '1d4', 'bludgeoning', ['ammunition'], { range: [30, 120] }),
    battleaxe: W('Battleaxe', 'martial', '1d8', 'slashing', ['versatile'], { versatile: '1d10' }),
    flail: W('Flail', 'martial', '1d8', 'bludgeoning'),
    glaive: W('Glaive', 'martial', '1d10', 'slashing', ['heavy', 'reach', 'two-handed']),
    greataxe: W('Greataxe', 'martial', '1d12', 'slashing', ['heavy', 'two-handed']),
    greatsword: W('Greatsword', 'martial', '2d6', 'slashing', ['heavy', 'two-handed']),
    halberd: W('Halberd', 'martial', '1d10', 'slashing', ['heavy', 'reach', 'two-handed']),
    lance: W('Lance', 'martial', '1d10', 'piercing', ['heavy', 'reach', 'two-handed']),
    longsword: W('Longsword', 'martial', '1d8', 'slashing', ['versatile'], { versatile: '1d10' }),
    maul: W('Maul', 'martial', '2d6', 'bludgeoning', ['heavy', 'two-handed']),
    morningstar: W('Morningstar', 'martial', '1d8', 'piercing'),
    pike: W('Pike', 'martial', '1d10', 'piercing', ['heavy', 'reach', 'two-handed']),
    rapier: W('Rapier', 'martial', '1d8', 'piercing', ['finesse']),
    scimitar: W('Scimitar', 'martial', '1d6', 'slashing', ['finesse', 'light']),
    shortsword: W('Shortsword', 'martial', '1d6', 'piercing', ['finesse', 'light']),
    trident: W('Trident', 'martial', '1d8', 'piercing', ['thrown', 'versatile'], { range: [20, 60], versatile: '1d10' }),
    warhammer: W('Warhammer', 'martial', '1d8', 'bludgeoning', ['versatile'], { versatile: '1d10' }),
    'war-pick': W('War Pick', 'martial', '1d8', 'piercing', ['versatile'], { versatile: '1d10' }),
    whip: W('Whip', 'martial', '1d4', 'slashing', ['finesse', 'reach']),
    blowgun: W('Blowgun', 'martial', '1', 'piercing', ['ammunition', 'loading'], { range: [25, 100] }),
    'hand-crossbow': W('Hand Crossbow', 'martial', '1d6', 'piercing', ['ammunition', 'light', 'loading'], { range: [30, 120] }),
    'heavy-crossbow': W('Heavy Crossbow', 'martial', '1d10', 'piercing', ['ammunition', 'heavy', 'loading', 'two-handed'], { range: [100, 400] }),
    longbow: W('Longbow', 'martial', '1d8', 'piercing', ['ammunition', 'heavy', 'two-handed'], { range: [150, 600] }),
  };
  const ARMOR = {
    padded: { name: 'Padded', type: 'light', base: 11, stealth: true },
    leather: { name: 'Leather', type: 'light', base: 11 },
    'studded-leather': { name: 'Studded Leather', type: 'light', base: 12 },
    hide: { name: 'Hide', type: 'medium', base: 12 },
    'chain-shirt': { name: 'Chain Shirt', type: 'medium', base: 13 },
    'scale-mail': { name: 'Scale Mail', type: 'medium', base: 14, stealth: true },
    breastplate: { name: 'Breastplate', type: 'medium', base: 14 },
    'half-plate': { name: 'Half Plate', type: 'medium', base: 15, stealth: true },
    'ring-mail': { name: 'Ring Mail', type: 'heavy', base: 14, stealth: true },
    'chain-mail': { name: 'Chain Mail', type: 'heavy', base: 16, str: 13, stealth: true },
    splint: { name: 'Splint', type: 'heavy', base: 17, str: 15, stealth: true },
    plate: { name: 'Plate', type: 'heavy', base: 18, str: 15, stealth: true },
  };
  const isRangedWeapon = (w) => w.props.includes('ammunition');

  // ---------- spells (curated, levels 0-3) ----------
  // [id, name, level, classes, summary, mechanics]. Mechanics drive the stat block: atk = spell
  // attack (dice scale at 5/11/17 for cantrips), save = a saving-throw spell the DM rolls with
  // `damage ... --save`, mod = add the casting modifier to damage.
  const SP = (id, name, level, classes, desc, mech) => ({ id, name, level, classes: classes.split(' '), desc, mech: mech || null });
  const SPELL_LIST = [
    SP('acid-splash', 'Acid Splash', 0, 'sorcerer wizard', '5-ft burst within 60 ft; DEX save or 1d6 acid.', { save: 'dex', dmg: '1d6', type: 'acid', range: 60, scale: true }),
    SP('blade-ward', 'Blade Ward', 0, 'bard sorcerer warlock wizard', 'Concentration: attackers subtract 1d4 from rolls against you.'),
    SP('chill-touch', 'Chill Touch', 0, 'sorcerer warlock wizard', 'Melee spell attack, 1d10 necrotic; target can\'t regain HP until your next turn.', { atk: '1d10', type: 'necrotic', reach: 5, scale: true }),
    SP('dancing-lights', 'Dancing Lights', 0, 'bard sorcerer wizard', 'Up to four floating lights.'),
    SP('druidcraft', 'Druidcraft', 0, 'druid', 'Small nature tricks.'),
    SP('eldritch-blast', 'Eldritch Blast', 0, 'warlock', 'Ranged spell attack, 1d10 force per beam (2 beams at 5, 3 at 11, 4 at 17).', { atk: '1d10', type: 'force', range: 120, beams: true }),
    SP('fire-bolt', 'Fire Bolt', 0, 'sorcerer wizard', 'Ranged spell attack, 1d10 fire; ignites unattended flammables.', { atk: '1d10', type: 'fire', range: 120, scale: true }),
    SP('friends', 'Friends', 0, 'bard sorcerer warlock wizard', 'Charm a creature briefly (WIS save).'),
    SP('guidance', 'Guidance', 0, 'cleric druid', 'Concentration: an ally adds 1d4 to one kind of ability check.'),
    SP('light', 'Light', 0, 'bard cleric sorcerer wizard', 'An object sheds bright light.'),
    SP('mage-hand', 'Mage Hand', 0, 'bard sorcerer warlock wizard', 'A spectral hand moves light objects within 30 ft.'),
    SP('mending', 'Mending', 0, 'bard cleric druid sorcerer wizard', 'Repair a small break.'),
    SP('message', 'Message', 0, 'bard druid sorcerer wizard', 'Whisper to a creature within 120 ft.'),
    SP('mind-sliver', 'Mind Sliver', 0, 'sorcerer warlock wizard', 'INT save or 1d6 psychic and -1d4 on its next save.', { save: 'int', dmg: '1d6', type: 'psychic', range: 60, scale: true }),
    SP('minor-illusion', 'Minor Illusion', 0, 'bard sorcerer warlock wizard', 'A sound or a small still image.'),
    SP('poison-spray', 'Poison Spray', 0, 'druid sorcerer warlock wizard', 'Ranged spell attack, 1d12 poison.', { atk: '1d12', type: 'poison', range: 30, scale: true }),
    SP('prestidigitation', 'Prestidigitation', 0, 'bard sorcerer warlock wizard', 'Minor magical tricks.'),
    SP('produce-flame', 'Produce Flame', 0, 'druid', 'A flame in your hand for light; hurl it: ranged spell attack, 1d8 fire.', { atk: '1d8', type: 'fire', range: 60, scale: true }),
    SP('ray-of-frost', 'Ray of Frost', 0, 'sorcerer wizard', 'Ranged spell attack, 1d8 cold and -10 ft speed.', { atk: '1d8', type: 'cold', range: 60, scale: true }),
    SP('resistance', 'Resistance', 0, 'cleric druid', 'Concentration: an ally reduces one damage type by 1d4.'),
    SP('sacred-flame', 'Sacred Flame', 0, 'cleric', 'DEX save or 1d8 radiant; ignores cover.', { save: 'dex', dmg: '1d8', type: 'radiant', range: 60, scale: true }),
    SP('shillelagh', 'Shillelagh', 0, 'druid', 'Bonus action: your club or staff uses your spellcasting ability and deals a d8 (more at higher levels).'),
    SP('shocking-grasp', 'Shocking Grasp', 0, 'sorcerer wizard', 'Melee spell attack, 1d8 lightning; target can\'t take reactions.', { atk: '1d8', type: 'lightning', reach: 5, scale: true }),
    SP('sorcerous-burst', 'Sorcerous Burst', 0, 'sorcerer', 'Ranged spell attack, 1d8 of a chosen element; 8s explode for more.', { atk: '1d8', type: 'fire', range: 120, scale: true }),
    SP('spare-the-dying', 'Spare the Dying', 0, 'cleric druid', 'Stabilize a dying creature within 15 ft (bonus action).'),
    SP('starry-wisp', 'Starry Wisp', 0, 'bard druid', 'Ranged spell attack, 1d8 radiant; target can\'t be invisible.', { atk: '1d8', type: 'radiant', range: 60, scale: true }),
    SP('thaumaturgy', 'Thaumaturgy', 0, 'cleric', 'Minor divine wonders: booming voice, tremors, flickering flames.'),
    SP('thorn-whip', 'Thorn Whip', 0, 'druid', 'Melee spell attack at 30 ft, 1d6 piercing and pull 10 ft.', { atk: '1d6', type: 'piercing', reach: 30, scale: true }),
    SP('toll-the-dead', 'Toll the Dead', 0, 'cleric warlock wizard', 'WIS save or 1d8 necrotic (1d12 if it\'s hurt).', { save: 'wis', dmg: '1d8', type: 'necrotic', range: 60, scale: true }),
    SP('true-strike', 'True Strike', 0, 'bard sorcerer warlock wizard', 'Attack with a weapon using your spellcasting ability; extra radiant at 5+.'),
    SP('vicious-mockery', 'Vicious Mockery', 0, 'bard', 'WIS save or 1d6 psychic and disadvantage on its next attack.', { save: 'wis', dmg: '1d6', type: 'psychic', range: 60, scale: true }),
    SP('word-of-radiance', 'Word of Radiance', 0, 'cleric', 'Creatures of your choice within 5 ft: CON save or 1d6 radiant.', { save: 'con', dmg: '1d6', type: 'radiant', range: 5, scale: true }),

    SP('armor-of-agathys', 'Armor of Agathys', 1, 'warlock', '5 temp HP; melee attackers take 5 cold while it lasts.'),
    SP('bane', 'Bane', 1, 'bard cleric warlock', 'Concentration: up to 3 creatures subtract 1d4 from attacks and saves (CHA save).'),
    SP('bless', 'Bless', 1, 'cleric paladin', 'Concentration: up to 3 allies add 1d4 to attacks and saves.'),
    SP('burning-hands', 'Burning Hands', 1, 'sorcerer wizard', '15-ft cone, DEX save, 3d6 fire (half on save).', { save: 'dex', dmg: '3d6', type: 'fire', range: 15, half: true }),
    SP('charm-person', 'Charm Person', 1, 'bard druid sorcerer warlock wizard', 'WIS save or charmed for an hour.'),
    SP('chromatic-orb', 'Chromatic Orb', 1, 'sorcerer wizard', 'Ranged spell attack, 3d8 of a chosen element.', { atk: '3d8', type: 'fire', range: 90 }),
    SP('command', 'Command', 1, 'bard cleric paladin', 'One-word command (WIS save): approach, drop, flee, grovel, halt.'),
    SP('cure-wounds', 'Cure Wounds', 1, 'bard cleric druid paladin ranger', 'Touch: heal 2d8 + modifier.', { heal: '2d8' }),
    SP('detect-magic', 'Detect Magic', 1, 'bard cleric druid paladin ranger sorcerer warlock wizard', 'Sense magic within 30 ft (ritual).'),
    SP('disguise-self', 'Disguise Self', 1, 'bard sorcerer wizard', 'Look like someone else for an hour.'),
    SP('dissonant-whispers', 'Dissonant Whispers', 1, 'bard', 'WIS save or 3d6 psychic and flee (half on save).', { save: 'wis', dmg: '3d6', type: 'psychic', range: 60, half: true }),
    SP('divine-favor', 'Divine Favor', 1, 'paladin', 'Bonus action: weapon hits deal +1d4 radiant for a minute.'),
    SP('divine-smite', 'Divine Smite', 1, 'paladin', 'Bonus action when you hit: +2d8 radiant (+1d8 per higher slot; +1d8 vs fiends/undead).'),
    SP('ensnaring-strike', 'Ensnaring Strike', 1, 'ranger', 'Bonus action on a hit: STR save or restrained, 1d6 piercing each turn.'),
    SP('entangle', 'Entangle', 1, 'druid ranger', '20-ft square: STR save or restrained; difficult terrain.'),
    SP('faerie-fire', 'Faerie Fire', 1, 'bard druid', '20-ft cube: DEX save or outlined; attacks against them have advantage.'),
    SP('feather-fall', 'Feather Fall', 1, 'bard sorcerer wizard', 'Reaction: up to 5 falling creatures drift down safely.'),
    SP('find-familiar', 'Find Familiar', 1, 'wizard', 'Summon a spirit animal familiar.'),
    SP('fog-cloud', 'Fog Cloud', 1, 'druid ranger sorcerer wizard', '20-ft sphere of heavy fog.'),
    SP('goodberry', 'Goodberry', 1, 'druid ranger', 'Ten berries that heal 1 HP each.'),
    SP('guiding-bolt', 'Guiding Bolt', 1, 'cleric', 'Ranged spell attack, 4d6 radiant; the next attack on the target has advantage.', { atk: '4d6', type: 'radiant', range: 120 }),
    SP('healing-word', 'Healing Word', 1, 'bard cleric druid', 'Bonus action, 60 ft: heal 2d4 + modifier.', { heal: '2d4' }),
    SP('hellish-rebuke', 'Hellish Rebuke', 1, 'warlock', 'Reaction when damaged: DEX save, 2d10 fire (half on save).', { save: 'dex', dmg: '2d10', type: 'fire', range: 60, half: true }),
    SP('heroism', 'Heroism', 1, 'bard paladin', 'Concentration: immune to fear, temp HP each turn.'),
    SP('hex', 'Hex', 1, 'warlock', 'Bonus action, concentration: +1d6 necrotic on your hits against the target.'),
    SP('hideous-laughter', 'Hideous Laughter', 1, 'bard warlock wizard', 'WIS save or prone and incapacitated with laughter.'),
    SP('hunters-mark', 'Hunter\'s Mark', 1, 'ranger', 'Bonus action, concentration: +1d6 force on your weapon hits against the target.'),
    SP('ice-knife', 'Ice Knife', 1, 'druid sorcerer wizard', 'Ranged spell attack 1d10 piercing, then 5-ft burst: DEX save or 2d6 cold.', { atk: '1d10', type: 'piercing', range: 60 }),
    SP('inflict-wounds', 'Inflict Wounds', 1, 'cleric', 'Touch: CON save, 2d10 necrotic (half on save).', { save: 'con', dmg: '2d10', type: 'necrotic', range: 5, half: true }),
    SP('mage-armor', 'Mage Armor', 1, 'sorcerer wizard', 'Unarmored AC becomes 13 + DEX for 8 hours.'),
    SP('magic-missile', 'Magic Missile', 1, 'sorcerer wizard', 'Three darts, 1d4+1 force each, never miss.'),
    SP('protection-from-evil-and-good', 'Protection from Evil and Good', 1, 'cleric paladin warlock wizard', 'Concentration: aberrations, fiends, undead etc. have disadvantage against the target.'),
    SP('sanctuary', 'Sanctuary', 1, 'cleric', 'Bonus action: attackers must make a WIS save or pick another target.'),
    SP('searing-smite', 'Searing Smite', 1, 'paladin', 'Bonus action on a hit: +1d6 fire and the target burns.'),
    SP('shield', 'Shield', 1, 'sorcerer wizard', 'Reaction: +5 AC until your next turn.'),
    SP('shield-of-faith', 'Shield of Faith', 1, 'cleric paladin', 'Bonus action, concentration: +2 AC to a creature.'),
    SP('sleep', 'Sleep', 1, 'bard sorcerer wizard', '5-ft sphere: WIS save or incapacitated, then asleep.'),
    SP('thunderwave', 'Thunderwave', 1, 'bard druid sorcerer wizard', '15-ft cube: CON save, 2d8 thunder and pushed 10 ft (half, no push on save).', { save: 'con', dmg: '2d8', type: 'thunder', range: 15, half: true }),
    SP('wrathful-smite', 'Wrathful Smite', 1, 'paladin', 'Bonus action on a hit: +1d6 psychic and WIS save or frightened.'),

    SP('aid', 'Aid', 2, 'bard cleric druid paladin ranger', 'Three creatures gain +5 max HP for 8 hours.'),
    SP('blur', 'Blur', 2, 'sorcerer wizard', 'Concentration: attackers have disadvantage against you.'),
    SP('cloud-of-daggers', 'Cloud of Daggers', 2, 'bard sorcerer warlock wizard', 'A 5-ft cube of blades, 4d4 slashing to anything in it.'),
    SP('darkness', 'Darkness', 2, 'sorcerer warlock wizard', '15-ft sphere of magical darkness.'),
    SP('enhance-ability', 'Enhance Ability', 2, 'bard cleric druid ranger sorcerer wizard', 'Advantage on checks with one ability.'),
    SP('find-steed', 'Find Steed', 2, 'paladin', 'Summon a loyal otherworldly steed.'),
    SP('flaming-sphere', 'Flaming Sphere', 2, 'druid wizard', 'A rolling 5-ft ball of fire: DEX save, 2d6 fire.', { save: 'dex', dmg: '2d6', type: 'fire', range: 60, half: true }),
    SP('heat-metal', 'Heat Metal', 2, 'bard druid', 'Metal glows red-hot: 2d8 fire each turn to whoever holds or wears it.'),
    SP('hold-person', 'Hold Person', 2, 'bard cleric druid sorcerer warlock wizard', 'WIS save or paralyzed (repeat the save each turn).'),
    SP('invisibility', 'Invisibility', 2, 'bard sorcerer warlock wizard', 'A creature is invisible until it attacks or casts.'),
    SP('lesser-restoration', 'Lesser Restoration', 2, 'bard cleric druid paladin ranger', 'End blinded, deafened, paralyzed or poisoned.'),
    SP('magic-weapon', 'Magic Weapon', 2, 'paladin ranger sorcerer wizard', 'A weapon becomes +1 for an hour.'),
    SP('mirror-image', 'Mirror Image', 2, 'bard sorcerer warlock wizard', 'Three duplicates that soak attacks.'),
    SP('misty-step', 'Misty Step', 2, 'sorcerer warlock wizard', 'Bonus action: teleport 30 ft.'),
    SP('moonbeam', 'Moonbeam', 2, 'druid', '5-ft cylinder of moonlight: CON save, 2d10 radiant.', { save: 'con', dmg: '2d10', type: 'radiant', range: 120, half: true }),
    SP('pass-without-trace', 'Pass without Trace', 2, 'druid ranger', 'Allies within 30 ft gain +10 to Stealth.'),
    SP('prayer-of-healing', 'Prayer of Healing', 2, 'cleric paladin', 'Out of combat: up to five creatures heal 2d8 + modifier.'),
    SP('scorching-ray', 'Scorching Ray', 2, 'sorcerer wizard', 'Three rays, each a ranged spell attack for 2d6 fire.', { atk: '2d6', type: 'fire', range: 120 }),
    SP('shatter', 'Shatter', 2, 'bard sorcerer warlock wizard', '10-ft sphere: CON save, 3d8 thunder.', { save: 'con', dmg: '3d8', type: 'thunder', range: 60, half: true }),
    SP('silence', 'Silence', 2, 'bard cleric ranger', '20-ft sphere where no sound can be made.'),
    SP('spike-growth', 'Spike Growth', 2, 'druid ranger', '20-ft radius of thorns: 2d4 piercing per 5 ft moved.'),
    SP('spiritual-weapon', 'Spiritual Weapon', 2, 'cleric', 'Bonus action: a floating weapon; melee spell attack 1d8 + modifier force, again each turn as a bonus action.', { atk: '1d8', type: 'force', range: 60, mod: true, bonus: true }),
    SP('suggestion', 'Suggestion', 2, 'bard sorcerer warlock wizard', 'WIS save or follow a reasonable suggestion.'),
    SP('web', 'Web', 2, 'sorcerer wizard', '20-ft cube of webs: DEX save or restrained.'),

    SP('beacon-of-hope', 'Beacon of Hope', 3, 'cleric', 'Allies get advantage on WIS and death saves, and maximum healing.'),
    SP('blinding-smite', 'Blinding Smite', 3, 'paladin', 'On a hit: +3d8 radiant and CON save or blinded.'),
    SP('call-lightning', 'Call Lightning', 3, 'druid', 'A storm cloud; each turn, a bolt: DEX save, 3d10 lightning.', { save: 'dex', dmg: '3d10', type: 'lightning', range: 120, half: true }),
    SP('conjure-animals', 'Conjure Animals', 3, 'druid ranger', 'A pack of spirit animals that savages nearby enemies.'),
    SP('counterspell', 'Counterspell', 3, 'sorcerer warlock wizard', 'Reaction: interrupt a spell (CON save for the caster).'),
    SP('crusaders-mantle', 'Crusader\'s Mantle', 3, 'paladin', 'Allies within 30 ft deal +1d4 radiant on weapon hits.'),
    SP('dispel-magic', 'Dispel Magic', 3, 'bard cleric druid paladin sorcerer warlock wizard', 'End spells on a target.'),
    SP('fear', 'Fear', 3, 'bard sorcerer warlock wizard', '30-ft cone: WIS save or drop what it holds and flee.'),
    SP('fireball', 'Fireball', 3, 'sorcerer wizard', '20-ft sphere within 150 ft: DEX save, 8d6 fire.', { save: 'dex', dmg: '8d6', type: 'fire', range: 150, half: true }),
    SP('fly', 'Fly', 3, 'sorcerer warlock wizard', 'A creature gains 60 ft flying speed.'),
    SP('haste', 'Haste', 3, 'sorcerer wizard', 'Double speed, +2 AC, and an extra limited action.'),
    SP('hunger-of-hadar', 'Hunger of Hadar', 3, 'warlock', '20-ft sphere of void: 2d6 cold, then DEX save or 2d6 acid.'),
    SP('hypnotic-pattern', 'Hypnotic Pattern', 3, 'bard sorcerer warlock wizard', '30-ft cube: WIS save or charmed and incapacitated.'),
    SP('lightning-arrow', 'Lightning Arrow', 3, 'ranger', 'Your next ranged hit deals 4d8 lightning plus a burst.'),
    SP('lightning-bolt', 'Lightning Bolt', 3, 'sorcerer wizard', '100-ft line: DEX save, 8d6 lightning.', { save: 'dex', dmg: '8d6', type: 'lightning', range: 100, half: true }),
    SP('mass-healing-word', 'Mass Healing Word', 3, 'bard cleric', 'Bonus action: up to six creatures heal 2d4 + modifier.', { heal: '2d4' }),
    SP('revivify', 'Revivify', 3, 'cleric druid paladin ranger', 'Return a creature dead under a minute to 1 HP.'),
    SP('sleet-storm', 'Sleet Storm', 3, 'druid sorcerer wizard', 'A 40-ft cylinder of freezing rain: difficult, slick, obscured.'),
    SP('slow', 'Slow', 3, 'sorcerer wizard', 'Up to six creatures: WIS save or slowed (half speed, -2 AC, limited actions).'),
    SP('spirit-guardians', 'Spirit Guardians', 3, 'cleric', 'Concentration: spirits around you; enemies within 15 ft take 3d8 radiant (WIS save, half).', { save: 'wis', dmg: '3d8', type: 'radiant', range: 15, half: true }),
    SP('vampiric-touch', 'Vampiric Touch', 3, 'sorcerer warlock wizard', 'Melee spell attack, 3d6 necrotic; heal half the damage.', { atk: '3d6', type: 'necrotic', reach: 5 }),
  ];
  const SPELLS = Object.fromEntries(SPELL_LIST.map((s) => [s.id, s]));
  const FULL_SLOTS = [[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]];
  const PREPARED = {
    full: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
    half: [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15],
    sorcerer: [2, 4, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
    warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
    wizard: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25],
  };
  const tier = (L, a, b, c) => (L >= 10 ? c : L >= 4 ? b : a);

  // ---------- options shared by several classes ----------
  const FIGHTING_STYLES = {
    archery: { name: 'Archery', desc: '+2 to attack rolls with ranged weapons.' },
    defense: { name: 'Defense', desc: '+1 AC while wearing armor.' },
    dueling: { name: 'Dueling', desc: '+2 damage with a melee weapon in one hand and no other weapon.' },
    'great-weapon-fighting': { name: 'Great Weapon Fighting', desc: 'Treat 1s and 2s on damage dice as 3s with two-handed or versatile melee weapons held in two hands.' },
    protection: { name: 'Protection', desc: 'Reaction with a shield: impose disadvantage on an attack against an ally within 5 ft.' },
    'two-weapon-fighting': { name: 'Two-Weapon Fighting', desc: 'Add your ability modifier to the damage of your off-hand attack.' },
    'blind-fighting': { name: 'Blind Fighting', desc: 'Blindsight 10 ft.' },
    interception: { name: 'Interception', desc: 'Reaction: reduce damage to an ally within 5 ft by 1d10 + proficiency bonus.' },
    'thrown-weapon-fighting': { name: 'Thrown Weapon Fighting', desc: '+2 damage with thrown weapons; draw them as part of the attack.' },
    'unarmed-fighting': { name: 'Unarmed Fighting', desc: 'Unarmed strikes deal 1d6 + STR (1d8 with both hands free); 1d4 to a creature you grapple.' },
  };
  const MANEUVERS = {
    'ambush': ['Ambush', 'Add a superiority die to a Stealth check or initiative roll.'],
    'bait-and-switch': ['Bait and Switch', 'Swap places with an ally within 5 ft; one of you adds the die to AC.'],
    'commanders-strike': ['Commander\'s Strike', 'Forgo an attack: an ally uses its reaction to attack, adding the die to damage.'],
    'commanding-presence': ['Commanding Presence', 'Add the die to an Intimidation, Performance or Persuasion check.'],
    'disarming-attack': ['Disarming Attack', 'On a hit: add the die to damage; STR save or it drops what it holds.'],
    'distracting-strike': ['Distracting Strike', 'On a hit: add the die; the next ally attack on it has advantage.'],
    'evasive-footwork': ['Evasive Footwork', 'When you move, add the die to your AC until you stop.'],
    'feinting-attack': ['Feinting Attack', 'Bonus action: advantage on your next attack against a creature within 5 ft, add the die to damage.'],
    'goading-attack': ['Goading Attack', 'On a hit: add the die; WIS save or disadvantage attacking anyone but you.'],
    'lunging-attack': ['Lunging Attack', 'Move 5 ft as part of a melee attack, add the die to damage on a hit.'],
    'maneuvering-attack': ['Maneuvering Attack', 'On a hit: add the die; an ally moves half speed without provoking from the target.'],
    'menacing-attack': ['Menacing Attack', 'On a hit: add the die; WIS save or frightened.'],
    'parry': ['Parry', 'Reaction when hit in melee: reduce the damage by the die + your STR or DEX modifier.'],
    'precision-attack': ['Precision Attack', 'Add the die to an attack roll, after seeing the roll.'],
    'pushing-attack': ['Pushing Attack', 'On a hit: add the die; STR save or pushed 15 ft.'],
    'rally': ['Rally', 'Bonus action: an ally gains temp HP equal to the die + your CHA modifier.'],
    'riposte': ['Riposte', 'Reaction when a creature misses you in melee: attack it, add the die to damage.'],
    'sweeping-attack': ['Sweeping Attack', 'On a hit: the die\'s damage also hits another creature within 5 ft of you.'],
    'trip-attack': ['Trip Attack', 'On a hit: add the die; Large or smaller makes a STR save or falls prone.'],
  };
  const INVOCATIONS = {
    'agonizing-blast': ['Agonizing Blast', 'Add your CHA modifier to Eldritch Blast damage.', 2],
    'armor-of-shadows': ['Armor of Shadows', 'Cast Mage Armor on yourself at will.', 1],
    'devils-sight': ['Devil\'s Sight', 'See normally in magical and nonmagical darkness to 120 ft.', 2],
    'eldritch-mind': ['Eldritch Mind', 'Advantage on Constitution saves to keep concentration.', 1],
    'eldritch-spear': ['Eldritch Spear', 'Eldritch Blast range increases by 30 ft x warlock level.', 2],
    'mask-of-many-faces': ['Mask of Many Faces', 'Cast Disguise Self at will.', 2],
    'misty-visions': ['Misty Visions', 'Cast Silent Image at will.', 2],
    'pact-of-the-blade': ['Pact of the Blade', 'Conjure a pact weapon; attack with it using CHA.', 1],
    'pact-of-the-chain': ['Pact of the Chain', 'Find Familiar with special forms (imp, pseudodragon, sprite...).', 1],
    'pact-of-the-tome': ['Pact of the Tome', 'A Book of Shadows with three extra cantrips and two rituals.', 1],
    'repelling-blast': ['Repelling Blast', 'Eldritch Blast hits push the target 10 ft.', 2],
    'thirsting-blade': ['Thirsting Blade', 'Extra Attack with your pact weapon.', 5],
    'lifedrinker': ['Lifedrinker', 'Pact weapon hits deal extra necrotic, psychic or radiant damage and can heal you.', 9],
  };
  const METAMAGIC = {
    'careful-spell': ['Careful Spell', '1 SP: allies automatically succeed on your spell\'s save.'],
    'distant-spell': ['Distant Spell', '1 SP: double a spell\'s range.'],
    'empowered-spell': ['Empowered Spell', '1 SP: reroll some damage dice.'],
    'extended-spell': ['Extended Spell', '1 SP: double the duration; advantage on concentration.'],
    'heightened-spell': ['Heightened Spell', '2 SP: one target has disadvantage on its save.'],
    'quickened-spell': ['Quickened Spell', '2 SP: cast an action spell as a bonus action.'],
    'seeking-spell': ['Seeking Spell', '1 SP: reroll a missed spell attack.'],
    'subtle-spell': ['Subtle Spell', '1 SP: cast without verbal or somatic components.'],
    'twinned-spell': ['Twinned Spell', '1 SP per level: a single-target spell hits a second target.'],
  };

  // ---------- classes ----------
  // features: [level, name, description (string or ctx => string)]. ctx: { L, pb, m (ability mods), b (build), res }.
  const CLASSES = {
    barbarian: {
      name: 'Barbarian', hd: 12, saves: ['str', 'con'], armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'],
      skills: { n: 2, from: ['animal-handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'] },
      blurb: 'A storm of muscle and fury. Rage soaks damage and hits harder; best up close.',
      asi: [4, 8, 12, 16, 19], extra: 5, unarmored: ['con'],
      rec: { abil: ['str', 'con', 'dex', 'wis', 'cha', 'int'], skills: ['athletics', 'perception'], bg: 'soldier', gear: { armor: null, shield: false, weapons: ['greataxe', 'handaxe'] } },
      res: (L) => ({ rage: L >= 20 ? 6 : L >= 17 ? 6 : L >= 12 ? 5 : L >= 6 ? 4 : L >= 3 ? 3 : 2 }),
      features: [
        [1, 'Rage', (c) => `Bonus action, ${c.res.rage}/long rest: +${c.L >= 16 ? 4 : c.L >= 9 ? 3 : 2} damage on STR attacks (attack ... --extra ${c.L >= 16 ? 4 : c.L >= 9 ? 3 : 2}), resistance to bludgeoning, piercing and slashing, advantage on STR checks and saves. No spells or concentration.`],
        [1, 'Unarmored Defense', 'Without armor, AC is 10 + DEX + CON (a shield is fine).'],
        [1, 'Weapon Mastery', 'Use the mastery property of two kinds of weapons.'],
        [2, 'Danger Sense', 'Advantage on DEX saves unless incapacitated.'],
        [2, 'Reckless Attack', 'On your first attack of the turn, take advantage on STR attacks; attacks against you have advantage until your next turn.'],
        [3, 'Primal Knowledge', 'One more skill proficiency; while raging, use STR for some checks.'],
        [5, 'Extra Attack', 'Attack twice with the Attack action.'],
        [5, 'Fast Movement', '+10 ft speed without heavy armor.'],
        [7, 'Feral Instinct', 'Advantage on initiative.'],
        [7, 'Instinctive Pounce', 'Move half your speed when you enter a rage.'],
        [9, 'Brutal Strike', 'Forgo Reckless advantage on one attack: +1d10 damage and a rider (push 15 ft, or -15 ft speed).'],
        [11, 'Relentless Rage', 'At 0 HP while raging, CON save (DC 10, +5 each time) to stay at twice your level in HP.'],
        [13, 'Improved Brutal Strike', 'More Brutal Strike riders.'],
        [15, 'Persistent Rage', 'Rage lasts 10 minutes and only ends if you choose or fall unconscious.'],
        [17, 'Improved Brutal Strike', 'Brutal Strike deals +2d10 and applies two riders.'],
        [18, 'Indomitable Might', 'STR checks and saves total at least your STR score.'],
        [20, 'Primal Champion', '+4 STR and CON (max 25).'],
      ],
      subclasses: {
        berserker: { name: 'Path of the Berserker', blurb: 'Rage as a weapon.', features: [
          [3, 'Frenzy', 'While raging and attacking recklessly, the first hit each turn deals extra d6s equal to your rage damage bonus.'],
          [6, 'Mindless Rage', 'Immune to charmed and frightened while raging.'],
          [10, 'Retaliation', 'Reaction when damaged by a creature within 5 ft: make a melee attack against it.'],
          [14, 'Intimidating Presence', 'Bonus action: creatures of your choice within 30 ft make a WIS save or are frightened.'],
        ] },
        'wild-heart': { name: 'Path of the Wild Heart', blurb: 'Animal spirits guide your rage.', features: [
          [3, 'Animal Speaker', 'Cast Beast Sense and Speak with Animals as rituals.'],
          [3, 'Rage of the Wilds', 'While raging choose Bear (resist all damage but psychic and force), Eagle (Dash and Disengage as a bonus action) or Wolf (allies have advantage against enemies near you).'],
          [6, 'Aspect of the Wilds', 'A lasting animal trait: darkvision, climbing speed, or swimming speed.'],
          [10, 'Nature Speaker', 'Cast Commune with Nature as a ritual.'],
          [14, 'Power of the Wilds', 'Falcon (fly), Lion (enemies near you have disadvantage on others), or Ram (knock prone) while raging.'],
        ] },
      },
    },
    bard: {
      name: 'Bard', hd: 8, saves: ['dex', 'cha'], armor: ['light'], weapons: ['simple'],
      skills: { n: 3, from: ALL_SKILLS }, caster: { kind: 'full', abil: 'cha', cantrips: (L) => tier(L, 2, 3, 4), prepared: PREPARED.full },
      blurb: 'Magic through music and wit. Buffs allies, mocks enemies, knows a bit of everything.',
      asi: [4, 8, 12, 16, 19],
      rec: { abil: ['cha', 'dex', 'con', 'wis', 'int', 'str'], skills: ['persuasion', 'deception', 'perception'], bg: 'entertainer', gear: { armor: 'leather', shield: false, weapons: ['rapier', 'dagger'] },
        cantrips: ['vicious-mockery', 'minor-illusion', 'mage-hand', 'prestidigitation'], spells: ['healing-word', 'dissonant-whispers', 'faerie-fire', 'charm-person', 'hold-person', 'shatter', 'invisibility', 'hypnotic-pattern'] },
      res: (L, m) => ({ bardicInspiration: Math.max(1, m.cha) }),
      features: [
        [1, 'Bardic Inspiration', (c) => `Bonus action, ${c.res.bardicInspiration}/long rest${c.L >= 5 ? ' (short rest from 5th)' : ''}: an ally within 60 ft gains a d${c.L >= 15 ? 12 : c.L >= 10 ? 10 : c.L >= 5 ? 8 : 6} to add to a failed d20 test.`],
        [1, 'Spellcasting', 'Cast bard spells with CHA.'],
        [2, 'Expertise', 'Double proficiency in two skills.'],
        [2, 'Jack of All Trades', 'Add half your proficiency bonus to checks you aren\'t proficient in.'],
        [5, 'Font of Inspiration', 'Regain Bardic Inspiration on a short rest; spend a slot to regain a use.'],
        [7, 'Countercharm', 'Reaction: an ally rerolls a failed save against charm or fear with advantage.'],
        [9, 'Expertise', 'Two more skills with expertise.'],
        [10, 'Magical Secrets', 'Prepare spells from the cleric, druid and wizard lists too.'],
        [18, 'Superior Inspiration', 'Regain uses when you roll initiative.'],
        [20, 'Words of Creation', 'Power Word Heal and Power Word Kill always prepared, and can hit a second target.'],
      ],
      subclasses: {
        lore: { name: 'College of Lore', blurb: 'Collector of secrets.', features: [
          [3, 'Bonus Proficiencies', 'Three more skills.'],
          [3, 'Cutting Words', 'Reaction: spend Bardic Inspiration to subtract the die from a creature\'s attack, check or damage.'],
          [6, 'Magical Discoveries', 'Two spells from any class list, always prepared.'],
          [14, 'Peerless Skill', 'Add Bardic Inspiration to your own failed check or attack.'],
        ] },
        valor: { name: 'College of Valor', blurb: 'Battle skald.', features: [
          [3, 'Combat Inspiration', 'Inspired allies can add the die to damage or to AC against one attack.'],
          [3, 'Martial Training', 'Medium armor, shields and martial weapons.'],
          [6, 'Extra Attack', 'Attack twice; one can be a cantrip.'],
          [14, 'Battle Magic', 'After casting a spell, attack with a weapon as a bonus action.'],
        ], armor: ['medium', 'shield'], weapons: ['martial'], extra: 6 },
      },
    },
    cleric: {
      name: 'Cleric', hd: 8, saves: ['wis', 'cha'], armor: ['light', 'medium', 'shield'], weapons: ['simple'],
      skills: { n: 2, from: ['history', 'insight', 'medicine', 'persuasion', 'religion'] },
      caster: { kind: 'full', abil: 'wis', cantrips: (L) => tier(L, 3, 4, 5), prepared: PREPARED.full },
      blurb: 'A divine channel. Heals, protects and smites; can wear armor.',
      asi: [4, 8, 12, 16, 19],
      rec: { abil: ['wis', 'con', 'str', 'dex', 'cha', 'int'], skills: ['medicine', 'insight'], bg: 'acolyte', gear: { armor: 'chain-mail', shield: true, weapons: ['mace'] },
        cantrips: ['sacred-flame', 'guidance', 'toll-the-dead', 'spare-the-dying', 'light'], spells: ['healing-word', 'guiding-bolt', 'bless', 'shield-of-faith', 'spiritual-weapon', 'hold-person', 'spirit-guardians', 'revivify', 'mass-healing-word'] },
      res: (L) => ({ channelDivinity: L >= 18 ? 4 : L >= 6 ? 3 : L >= 2 ? 2 : 0 }),
      features: [
        [1, 'Spellcasting', 'Cast cleric spells with WIS.'],
        [1, 'Divine Order', (c) => (c.picks['divine-order'] || [])[0] === 'thaumaturge' ? 'Thaumaturge: an extra cantrip, and add WIS to Arcana and Religion checks.' : 'Protector: martial weapons and heavy armor.'],
        [2, 'Channel Divinity', (c) => `${c.res.channelDivinity}/short rest (regain one on a short rest). Divine Spark: heal or deal 1d8 + WIS (more at higher levels; CON save for damage). Turn Undead: WIS save or flee.`],
        [5, 'Sear Undead', 'Turn Undead also deals radiant damage.'],
        [7, 'Blessed Strikes', 'Once per turn, +1d8 radiant on a weapon or cantrip hit.'],
        [10, 'Divine Intervention', 'Once per long rest, cast any cleric spell of 5th level or lower for free.'],
        [14, 'Improved Blessed Strikes', 'Blessed Strikes improves to 2d8 or grants temporary HP.'],
        [20, 'Greater Divine Intervention', 'Divine Intervention can cast Wish.'],
      ],
      picks: (L) => [{ key: 'divine-order', label: 'Divine Order', count: 1, step: 'class', options: [
        { id: 'protector', name: 'Protector', desc: 'Martial weapons and heavy armor. Frontline cleric.' },
        { id: 'thaumaturge', name: 'Thaumaturge', desc: 'One more cantrip, and WIS to Arcana and Religion.' }], rec: ['protector'] }],
      subclasses: {
        life: { name: 'Life Domain', blurb: 'The best healer in the game.', spells: { 3: ['bless', 'cure-wounds', 'aid', 'lesser-restoration'], 5: ['mass-healing-word', 'revivify'] }, features: [
          [3, 'Disciple of Life', 'Healing spells restore an extra 2 + the slot\'s level.'],
          [3, 'Preserve Life', 'Channel Divinity: split 5 x cleric level HP among bloodied creatures within 30 ft.'],
          [6, 'Blessed Healer', 'When you heal someone else with a spell, you regain 2 + the slot\'s level.'],
          [17, 'Supreme Healing', 'Healing dice always roll their maximum.'],
        ] },
        light: { name: 'Light Domain', blurb: 'Radiant fire and blinding light.', spells: { 3: ['burning-hands', 'faerie-fire', 'scorching-ray'], 5: ['fireball'] }, features: [
          [3, 'Radiance of the Dawn', 'Channel Divinity: dispel magical darkness; enemies within 30 ft take 2d10 + cleric level radiant (CON save, half).'],
          [3, 'Warding Flare', 'Reaction: impose disadvantage on an attack against you (WIS mod times per long rest).'],
          [6, 'Improved Warding Flare', 'Use it for allies too, and give them temp HP.'],
          [17, 'Corona of Light', 'Enemies near you have disadvantage on saves against fire and radiant spells.'],
        ] },
      },
    },
    druid: {
      name: 'Druid', hd: 8, saves: ['int', 'wis'], armor: ['light', 'shield'], weapons: ['simple'],
      skills: { n: 2, from: ['arcana', 'animal-handling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'] },
      caster: { kind: 'full', abil: 'wis', cantrips: (L) => tier(L, 2, 3, 4), prepared: PREPARED.full },
      blurb: 'Nature\'s caster. Controls the battlefield and turns into beasts.',
      asi: [4, 8, 12, 16, 19],
      rec: { abil: ['wis', 'con', 'dex', 'int', 'str', 'cha'], skills: ['perception', 'nature'], bg: 'guide', gear: { armor: 'leather', shield: true, weapons: ['quarterstaff', 'sling'] },
        cantrips: ['produce-flame', 'thorn-whip', 'guidance', 'shillelagh'], spells: ['entangle', 'healing-word', 'faerie-fire', 'thunderwave', 'moonbeam', 'spike-growth', 'pass-without-trace', 'call-lightning', 'conjure-animals'] },
      res: (L) => ({ wildShape: L >= 17 ? 4 : L >= 6 ? 3 : L >= 2 ? 2 : 0 }),
      features: [
        [1, 'Spellcasting', 'Cast druid spells with WIS.'],
        [1, 'Druidic', 'The secret druid language; Speak with Animals always prepared.'],
        [1, 'Primal Order', (c) => (c.picks['primal-order'] || [])[0] === 'warden' ? 'Warden: martial weapons and medium armor.' : 'Magician: an extra cantrip, and add WIS to Arcana and Nature checks.'],
        [2, 'Wild Shape', (c) => `Bonus action, ${c.res.wildShape} uses (one back on a short rest): take a beast form (CR up to ${c.L >= 8 ? 1 : c.L >= 4 ? '1/2' : '1/4'}) with temp HP equal to your level.`],
        [2, 'Wild Companion', 'Spend a slot or a Wild Shape use to cast Find Familiar.'],
        [5, 'Wild Resurgence', 'Trade a spell slot for Wild Shape or vice versa once per long rest.'],
        [7, 'Elemental Fury', 'Potent Spellcasting (WIS to cantrip damage) or Primal Strike (+1d8 elemental on weapon/beast hits).'],
        [15, 'Improved Elemental Fury', 'Better Elemental Fury.'],
        [18, 'Beast Spells', 'Cast spells in Wild Shape.'],
        [20, 'Archdruid', 'Regain Wild Shape on initiative; convert Wild Shape into slots.'],
      ],
      picks: () => [{ key: 'primal-order', label: 'Primal Order', count: 1, step: 'class', options: [
        { id: 'magician', name: 'Magician', desc: 'One more cantrip, and WIS to Arcana and Nature.' },
        { id: 'warden', name: 'Warden', desc: 'Martial weapons and medium armor.' }], rec: ['magician'] }],
      subclasses: {
        land: { name: 'Circle of the Land', blurb: 'Draws on the magic of a chosen land.', spells: { 3: ['hold-person', 'spike-growth'], 5: ['sleet-storm'] }, features: [
          [3, 'Circle of the Land Spells', 'Extra prepared spells from your chosen land (arid, polar, temperate, tropical).'],
          [3, 'Land\'s Aid', 'Spend Wild Shape: 10-ft sphere, CON save or 2d6 necrotic, and heal an ally 2d6.'],
          [6, 'Natural Recovery', 'Recover spell slots on a short rest once per long rest; one circle spell free.'],
          [10, 'Nature\'s Ward', 'Immune to poisoned; resistance tied to your land.'],
          [14, 'Nature\'s Sanctuary', 'Spend Wild Shape: a 15-ft cube of trees that grants half cover.'],
        ] },
        moon: { name: 'Circle of the Moon', blurb: 'Tough beast forms.', features: [
          [3, 'Circle Forms', 'Wild Shape into tougher beasts (CR up to level / 3), AC at least 13 + WIS, more temp HP.'],
          [6, 'Improved Circle Forms', 'Beast attacks can deal radiant damage; add WIS to CON saves.'],
          [10, 'Moonlight Step', 'Bonus action: teleport 30 ft and gain advantage on your next attack.'],
          [14, 'Lunar Form', '+2d10 radiant once per turn in beast form.'],
        ] },
      },
    },
    fighter: {
      name: 'Fighter', hd: 10, saves: ['str', 'con'], armor: ['light', 'medium', 'heavy', 'shield'], weapons: ['simple', 'martial'],
      skills: { n: 2, from: ['acrobatics', 'animal-handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'persuasion', 'survival'] },
      blurb: 'The master of weapons. Most attacks, toughest armor, simplest to play.',
      asi: [4, 6, 8, 12, 14, 16, 19],
      rec: { abil: ['str', 'con', 'dex', 'wis', 'cha', 'int'], skills: ['perception', 'insight'], bg: 'soldier', gear: { armor: 'chain-mail', shield: true, weapons: ['longsword', 'javelin'] } },
      res: (L) => ({ secondWind: L >= 10 ? 4 : L >= 4 ? 3 : 2, actionSurge: L >= 17 ? 2 : L >= 2 ? 1 : 0, indomitable: L >= 17 ? 3 : L >= 13 ? 2 : L >= 9 ? 1 : 0 }),
      attacks: (L) => (L >= 20 ? 4 : L >= 11 ? 3 : L >= 5 ? 2 : 1),
      features: [
        [1, 'Fighting Style', (c) => (c.picks['fighting-style'] || []).map((id) => (FIGHTING_STYLES[id] || {}).name || hbName(c, id)).join(', ') || 'Choose a fighting style.'],
        [1, 'Second Wind', (c) => `Bonus action, ${c.res.secondWind} uses (one back on a short rest): heal 1d10 + ${c.L} (heal <id> 1d10+${c.L}).`],
        [1, 'Weapon Mastery', 'Use the mastery property of three kinds of weapons.'],
        [2, 'Action Surge', (c) => `${c.res.actionSurge}/short rest: one extra action (regain <id> action).`],
        [2, 'Tactical Mind', 'Spend a Second Wind use to add 1d10 to a failed ability check.'],
        [5, 'Extra Attack', 'Attack twice with the Attack action.'],
        [5, 'Tactical Shift', 'Second Wind also lets you move half your speed without provoking.'],
        [9, 'Indomitable', (c) => `${c.res.indomitable}/long rest: reroll a failed save, adding your fighter level.`],
        [11, 'Two Extra Attacks', 'Attack three times.'],
        [13, 'Studied Attacks', 'After you miss a creature, your next attack against it has advantage.'],
        [20, 'Three Extra Attacks', 'Attack four times.'],
      ],
      picks: () => [{ key: 'fighting-style', label: 'Fighting style', count: 1, step: 'class', options: styleOptions(), rec: ['defense'], hbSlot: 'fighting-style' }],
      subclasses: {
        champion: { name: 'Champion', blurb: 'Simple and deadly: crits more often.', crit: (L) => (L >= 15 ? 18 : 19), features: [
          [3, 'Improved Critical', 'Your weapon attacks crit on a 19 or 20.'],
          [3, 'Remarkable Athlete', 'Advantage on initiative and Athletics; move half speed after a crit.'],
          [7, 'Additional Fighting Style', 'A second fighting style.'],
          [10, 'Heroic Warrior', 'Gain Heroic Inspiration at the start of your turn if you have none.'],
          [15, 'Superior Critical', 'Crit on 18-20.'],
          [18, 'Survivor', 'Advantage on death saves; regain 5 + CON HP each turn while bloodied.'],
        ], picks: (L) => (L >= 7 ? [{ key: 'fighting-style-2', label: 'Additional fighting style', count: 1, step: 'class', options: styleOptions(), hbSlot: 'fighting-style', rec: ['archery'] }] : []) },
        'battle-master': { name: 'Battle Master', blurb: 'Tactical maneuvers fueled by superiority dice.', features: [
          [3, 'Combat Superiority', (c) => `${c.res.superiority} superiority dice (d${c.L >= 18 ? 12 : c.L >= 10 ? 10 : 8}), regained on a short or long rest. Maneuvers (save DC ${8 + c.pb + Math.max(c.m.str, c.m.dex)}): ${(c.picks.maneuvers || []).map((id) => MANEUVERS[id] ? `${MANEUVERS[id][0]} (${MANEUVERS[id][1]})` : id).join(' ')}`],
          [3, 'Student of War', 'One artisan\'s tool and one more fighter skill.'],
          [7, 'Know Your Enemy', 'Bonus action: learn a creature\'s immunities, resistances and vulnerabilities.'],
          [10, 'Improved Combat Superiority', 'Superiority dice become d10s.'],
          [15, 'Relentless', 'Once per turn, use a d8 instead of spending a die.'],
          [18, 'Ultimate Combat Superiority', 'Superiority dice become d12s.'],
        ], res: (L) => ({ superiority: L >= 15 ? 6 : L >= 7 ? 5 : 4 }),
        picks: (L) => [{ key: 'maneuvers', label: 'Maneuvers', count: L >= 15 ? 9 : L >= 10 ? 7 : L >= 7 ? 5 : 3, step: 'class',
          options: Object.entries(MANEUVERS).map(([id, [name, desc]]) => ({ id, name, desc })), rec: ['precision-attack', 'riposte', 'parry', 'trip-attack', 'menacing-attack', 'pushing-attack', 'commanders-strike', 'rally', 'distracting-strike'] },
        { key: 'student-of-war', label: 'Student of War skill', count: 1, step: 'class', skillPick: true, rec: ['history', 'perception', 'insight', 'survival'] }] },
      },
    },
    monk: {
      name: 'Monk', hd: 8, saves: ['str', 'dex'], armor: [], weapons: ['simple', 'martial-light'],
      skills: { n: 2, from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'] },
      blurb: 'A fast, unarmored martial artist. Flurries of blows and stunning strikes.',
      asi: [4, 8, 12, 16, 19], extra: 5, unarmored: ['wis'],
      rec: { abil: ['dex', 'wis', 'con', 'str', 'int', 'cha'], skills: ['acrobatics', 'insight'], bg: 'hermit', gear: { armor: null, shield: false, weapons: ['shortsword', 'dart'] } },
      res: (L) => ({ focus: L >= 2 ? L : 0 }),
      features: [
        [1, 'Martial Arts', (c) => `Unarmed strikes and monk weapons use DEX and a d${martialDie(c.L)}; bonus action unarmed strike.`],
        [1, 'Unarmored Defense', 'Without armor or shield, AC is 10 + DEX + WIS.'],
        [2, 'Monk\'s Focus', (c) => `${c.res.focus} focus points (short rest): Flurry of Blows (two bonus unarmed strikes), Patient Defense (Disengage + Dodge), Step of the Wind (Dash + Disengage, jump farther).`],
        [2, 'Unarmored Movement', (c) => `+${unarmoredMove(c.L)} ft speed without armor or shield.`],
        [2, 'Uncanny Metabolism', 'On initiative, once per long rest: regain all focus and heal a Martial Arts die + level.'],
        [3, 'Deflect Attacks', 'Reaction: reduce attack damage by 1d10 + DEX + level; spend 1 focus to redirect it.'],
        [4, 'Slow Fall', 'Reaction: reduce fall damage by 5 x level.'],
        [5, 'Extra Attack', 'Attack twice with the Attack action.'],
        [5, 'Stunning Strike', (c) => `Once per turn on a hit, 1 focus: CON save (DC ${8 + c.pb + c.m.wis}) or stunned until your next turn.`],
        [6, 'Empowered Strikes', 'Unarmed strikes can deal force damage.'],
        [7, 'Evasion', 'DEX saves for half: no damage on a success, half on a failure.'],
        [9, 'Acrobatic Movement', 'Run along walls and across liquids.'],
        [10, 'Heightened Focus', 'Flurry gets a third strike; better Patient Defense and Step of the Wind.'],
        [10, 'Self-Restoration', 'End charmed, frightened or poisoned on yourself at the end of each turn.'],
        [13, 'Deflect Energy', 'Deflect Attacks works on any damage type.'],
        [14, 'Disciplined Survivor', 'Proficiency in all saves; spend 1 focus to reroll one.'],
        [15, 'Perfect Focus', 'Start each initiative with at least 4 focus.'],
        [18, 'Superior Defense', '3 focus: resistance to everything but force for a minute.'],
        [20, 'Body and Mind', '+4 DEX and WIS (max 25).'],
      ],
      subclasses: {
        'open-hand': { name: 'Warrior of the Open Hand', blurb: 'Knock, push and trip with every flurry.', features: [
          [3, 'Open Hand Technique', 'Flurry hits can also: no reactions, push 15 ft (STR save), or knock prone (DEX save).'],
          [6, 'Wholeness of Body', 'Bonus action, WIS mod times per long rest: heal a Martial Arts die + WIS.'],
          [11, 'Fleet Step', 'Step of the Wind after any other bonus action.'],
          [17, 'Quivering Palm', 'Set lethal vibrations; later end them for 10d12 force (CON save, half).'],
        ] },
        shadow: { name: 'Warrior of Shadow', blurb: 'Darkness, teleports and stealth.', features: [
          [3, 'Shadow Arts', 'Cast Darkness with focus and see through it; darkvision 60 ft.'],
          [6, 'Shadow Step', 'Bonus action: teleport 60 ft between dim spots and gain advantage on your next melee attack.'],
          [11, 'Improved Shadow Step', 'Shadow Step anywhere for 1 focus, with an unarmed strike after.'],
          [17, 'Cloak of Shadows', 'Become invisible in dim light and darkness.'],
        ] },
      },
    },
    paladin: {
      name: 'Paladin', hd: 10, saves: ['wis', 'cha'], armor: ['light', 'medium', 'heavy', 'shield'], weapons: ['simple', 'martial'],
      skills: { n: 2, from: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'] },
      caster: { kind: 'half', abil: 'cha', cantrips: () => 0, prepared: PREPARED.half },
      blurb: 'A holy warrior. Heavy armor, healing hands and devastating smites.',
      asi: [4, 8, 12, 16, 19], extra: 5,
      rec: { abil: ['str', 'cha', 'con', 'wis', 'dex', 'int'], skills: ['athletics', 'persuasion'], bg: 'noble', gear: { armor: 'chain-mail', shield: true, weapons: ['longsword', 'javelin'] },
        spells: ['divine-smite', 'bless', 'shield-of-faith', 'cure-wounds', 'command', 'heroism', 'aid', 'find-steed', 'crusaders-mantle'] },
      res: (L) => ({ layOnHands: 5 * L, channelDivinity: L >= 11 ? 3 : L >= 3 ? 2 : 0 }),
      features: [
        [1, 'Lay On Hands', (c) => `Bonus action: heal from a pool of ${c.res.layOnHands} HP (or spend 5 to cure poison).`],
        [1, 'Spellcasting', 'Cast paladin spells with CHA.'],
        [1, 'Weapon Mastery', 'Use the mastery property of two kinds of weapons.'],
        [2, 'Fighting Style', (c) => (c.picks['fighting-style'] || []).map((id) => (FIGHTING_STYLES[id] || {}).name || hbName(c, id)).join(', ') || 'Choose a fighting style.'],
        [2, 'Paladin\'s Smite', 'Divine Smite always prepared; cast it once per long rest without a slot.'],
        [3, 'Channel Divinity', (c) => `${c.res.channelDivinity}/short rest. Divine Sense: detect celestials, fiends and undead within 60 ft.`],
        [5, 'Extra Attack', 'Attack twice with the Attack action.'],
        [5, 'Faithful Steed', 'Find Steed always prepared; cast it once per long rest without a slot.'],
        [6, 'Aura of Protection', (c) => `You and allies within ${c.L >= 18 ? 30 : 10} ft add +${Math.max(1, c.m.cha)} to saves.`],
        [9, 'Abjure Foes', 'Channel Divinity: frighten creatures of your choice within 60 ft (WIS save).'],
        [10, 'Aura of Courage', 'You and allies in your aura can\'t be frightened.'],
        [11, 'Radiant Strikes', '+1d8 radiant on melee weapon and unarmed hits.'],
        [14, 'Restoring Touch', 'Lay On Hands can also end blinded, charmed, deafened, frightened, paralyzed or stunned.'],
        [18, 'Aura Expansion', 'Your auras reach 30 ft.'],
      ],
      picks: (L) => (L >= 2 ? [{ key: 'fighting-style', label: 'Fighting style', count: 1, step: 'class', options: styleOptions(), rec: ['defense'], hbSlot: 'fighting-style' }] : []),
      subclasses: {
        devotion: { name: 'Oath of Devotion', blurb: 'The shining knight.', spells: { 3: ['protection-from-evil-and-good', 'shield-of-faith', 'aid'], 5: ['dispel-magic'] }, features: [
          [3, 'Sacred Weapon', 'Channel Divinity: add CHA to attack rolls with a weapon for 10 minutes, and it sheds light.'],
          [7, 'Aura of Devotion', 'You and allies in your aura can\'t be charmed.'],
          [15, 'Smite of Protection', 'Divine Smite gives allies in your aura half cover.'],
          [20, 'Holy Nimbus', 'Bonus action: a 30-ft aura of sunlight that burns enemies and gives you advantage against fiends and undead.'],
        ] },
        vengeance: { name: 'Oath of Vengeance', blurb: 'Relentless hunter of the wicked.', spells: { 3: ['bane', 'hunters-mark', 'hold-person'], 5: ['haste'] }, features: [
          [3, 'Vow of Enmity', 'Channel Divinity on an attack: advantage on attacks against that creature for a minute.'],
          [7, 'Relentless Avenger', 'After an opportunity attack hits, move half speed without provoking.'],
          [15, 'Soul of Vengeance', 'Reaction: attack the target of your vow when it attacks.'],
          [20, 'Avenging Angel', 'Wings (60 ft fly) and a frightening aura.'],
        ] },
      },
    },
    ranger: {
      name: 'Ranger', hd: 10, saves: ['str', 'dex'], armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'],
      skills: { n: 3, from: ['animal-handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'] },
      caster: { kind: 'half', abil: 'wis', cantrips: () => 0, prepared: PREPARED.half },
      blurb: 'A wilderness hunter. Bows, traps and a little nature magic.',
      asi: [4, 8, 12, 16, 19], extra: 5,
      rec: { abil: ['dex', 'wis', 'con', 'str', 'int', 'cha'], skills: ['perception', 'stealth', 'survival'], bg: 'guide', gear: { armor: 'studded-leather', shield: false, weapons: ['longbow', 'shortsword'] },
        spells: ['hunters-mark', 'cure-wounds', 'ensnaring-strike', 'goodberry', 'pass-without-trace', 'spike-growth', 'lightning-arrow', 'conjure-animals'] },
      res: (L, m, pb) => ({ favoredEnemy: L >= 17 ? 6 : L >= 13 ? 5 : L >= 9 ? 4 : L >= 5 ? 3 : 2 }),
      features: [
        [1, 'Spellcasting', 'Cast ranger spells with WIS.'],
        [1, 'Favored Enemy', (c) => `Hunter's Mark always prepared; cast it ${c.res.favoredEnemy}/long rest without a slot.`],
        [1, 'Weapon Mastery', 'Use the mastery property of two kinds of weapons.'],
        [2, 'Deft Explorer', 'Expertise in one skill; two extra languages.'],
        [2, 'Fighting Style', (c) => (c.picks['fighting-style'] || []).map((id) => (FIGHTING_STYLES[id] || {}).name || hbName(c, id)).join(', ') || 'Choose a fighting style.'],
        [5, 'Extra Attack', 'Attack twice with the Attack action.'],
        [6, 'Roving', '+10 ft speed without heavy armor; climbing and swimming speed.'],
        [9, 'Expertise', 'Expertise in two more skills.'],
        [10, 'Tireless', 'Temp HP (1d8 + WIS) as an action; short rests reduce exhaustion.'],
        [13, 'Relentless Hunter', 'Damage can\'t break concentration on Hunter\'s Mark.'],
        [14, 'Nature\'s Veil', 'Bonus action, WIS mod times per long rest: invisible until your next turn ends.'],
        [17, 'Precise Hunter', 'Advantage on attacks against your Hunter\'s Mark target.'],
        [18, 'Feral Senses', 'Blindsight 30 ft.'],
        [20, 'Foe Slayer', 'Hunter\'s Mark damage becomes a d10.'],
      ],
      picks: (L) => (L >= 2 ? [{ key: 'fighting-style', label: 'Fighting style', count: 1, step: 'class', options: styleOptions(), rec: ['archery'], hbSlot: 'fighting-style' }] : []),
      expertise: (L) => (L >= 9 ? 3 : L >= 2 ? 1 : 0),
      subclasses: {
        hunter: { name: 'Hunter', blurb: 'Takes down big prey and hordes.', features: [
          [3, 'Hunter\'s Lore', 'Know the immunities, resistances and vulnerabilities of your Hunter\'s Mark target.'],
          [3, 'Hunter\'s Prey', 'Colossus Slayer (+1d8 once per turn against a hurt creature) or Horde Breaker (an extra attack against a second creature nearby).'],
          [7, 'Defensive Tactics', 'Escape the Horde (opportunity attacks against you have disadvantage) or Multiattack Defense.'],
          [11, 'Superior Hunter\'s Prey', 'Hunter\'s Mark damage also hits a second creature nearby.'],
          [15, 'Superior Hunter\'s Defense', 'Reaction: resistance to one attack\'s damage.'],
        ] },
        'beast-master': { name: 'Beast Master', blurb: 'Fights alongside a primal beast.', features: [
          [3, 'Primal Companion', 'A beast of land, sea or sky that acts on your turn; command it with a bonus action.'],
          [7, 'Exceptional Training', 'Your beast can Dash, Disengage, Dodge or Help as a bonus action; its attacks deal force.'],
          [11, 'Bestial Fury', 'Your beast attacks twice.'],
          [15, 'Share Spells', 'Spells on yourself also affect your beast.'],
        ] },
      },
    },
    rogue: {
      name: 'Rogue', hd: 8, saves: ['dex', 'int'], armor: ['light'], weapons: ['simple', 'martial-finesse-light'],
      skills: { n: 4, from: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'persuasion', 'sleight-of-hand', 'stealth'] },
      blurb: 'Skill and precision. Sneak Attack, hiding, and a trick for every situation.',
      asi: [4, 8, 10, 12, 16, 19],
      rec: { abil: ['dex', 'con', 'wis', 'int', 'cha', 'str'], skills: ['stealth', 'perception', 'acrobatics', 'investigation'], bg: 'criminal', gear: { armor: 'leather', shield: false, weapons: ['shortbow', 'shortsword', 'dagger'] } },
      res: () => ({}),
      expertise: (L) => (L >= 6 ? 4 : 2),
      features: [
        [1, 'Expertise', 'Double proficiency in two skills (two more at 6th).'],
        [1, 'Sneak Attack', (c) => `Sneak Attack +${Math.ceil(c.L / 2)}d6 once per turn with a finesse or ranged weapon, when you have advantage or an ally is within 5 ft of the target (attack ... --sneak).`],
        [1, 'Thieves\' Cant', 'The secret language of thieves.'],
        [1, 'Weapon Mastery', 'Use the mastery property of two kinds of weapons.'],
        [2, 'Cunning Action', 'Cunning Action: Dash, Disengage or Hide as a bonus action.'],
        [3, 'Steady Aim', 'Bonus action if you haven\'t moved: advantage on your next attack; speed 0 this turn.'],
        [5, 'Cunning Strike', 'Trade Sneak Attack dice for effects: poison, trip, or withdraw.'],
        [5, 'Uncanny Dodge', 'Reaction: halve an attack\'s damage.'],
        [7, 'Evasion', 'DEX saves for half: no damage on a success, half on a failure.'],
        [7, 'Reliable Talent', 'Treat d20s below 10 as 10 on proficient checks.'],
        [11, 'Improved Cunning Strike', 'Two Cunning Strike effects at once.'],
        [14, 'Devious Strikes', 'Daze, knock out, or obscure with Cunning Strike.'],
        [15, 'Slippery Mind', 'Proficiency in WIS and CHA saves.'],
        [18, 'Elusive', 'No attack roll has advantage against you unless you\'re incapacitated.'],
        [20, 'Stroke of Luck', 'Turn a failed d20 test into a 20, once per short rest.'],
      ],
      subclasses: {
        thief: { name: 'Thief', blurb: 'Fast hands, climbing, and magic items.', features: [
          [3, 'Fast Hands', 'Cunning Action can also Sleight of Hand, use thieves\' tools, or use an object.'],
          [3, 'Second-Story Work', 'Climbing speed equal to your speed; jump farther using DEX.'],
          [9, 'Supreme Sneak', 'Stealth Attack Cunning Strike: attack without breaking hiding.'],
          [13, 'Use Magic Device', 'Attune to four items; use scrolls and charges more freely.'],
          [17, 'Thief\'s Reflexes', 'Take two turns in the first round of combat.'],
        ] },
        assassin: { name: 'Assassin', blurb: 'Strikes first and hardest.', features: [
          [3, 'Assassinate', 'Advantage on initiative and on attacks against creatures that haven\'t acted yet; extra damage in the first round.'],
          [3, 'Assassin\'s Tools', 'Disguise kit and poisoner\'s kit.'],
          [9, 'Infiltration Expertise', 'Masterful mimicry and steady aim without losing speed.'],
          [13, 'Envenom Weapons', 'Poison Cunning Strike deals 2d6 poison too.'],
          [17, 'Death Strike', 'First-round hits: CON save or double damage.'],
        ] },
      },
    },
    sorcerer: {
      name: 'Sorcerer', hd: 6, saves: ['con', 'cha'], armor: [], weapons: ['simple'],
      skills: { n: 2, from: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'] },
      caster: { kind: 'full', abil: 'cha', cantrips: (L) => tier(L, 4, 5, 6), prepared: PREPARED.sorcerer },
      blurb: 'Innate magic you can bend: twin, quicken and empower your spells.',
      asi: [4, 8, 12, 16, 19],
      rec: { abil: ['cha', 'con', 'dex', 'wis', 'int', 'str'], skills: ['arcana', 'persuasion'], bg: 'sage', gear: { armor: null, shield: false, weapons: ['dagger', 'light-crossbow'] },
        cantrips: ['fire-bolt', 'mind-sliver', 'mage-hand', 'prestidigitation', 'minor-illusion', 'ray-of-frost'], spells: ['shield', 'magic-missile', 'chromatic-orb', 'misty-step', 'scorching-ray', 'fireball', 'counterspell', 'haste'] },
      res: (L) => ({ sorceryPoints: L >= 2 ? L : 0 }),
      features: [
        [1, 'Spellcasting', 'Cast sorcerer spells with CHA.'],
        [1, 'Innate Sorcery', 'Bonus action, twice per long rest: for a minute, +1 spell save DC and advantage on spell attacks.'],
        [2, 'Font of Magic', (c) => `${c.res.sorceryPoints} sorcery points (long rest); trade them for slots and back.`],
        [2, 'Metamagic', (c) => (c.picks.metamagic || []).map((id) => METAMAGIC[id] ? `${METAMAGIC[id][0]} (${METAMAGIC[id][1]})` : id).join(' ') || 'Choose metamagic.'],
        [5, 'Sorcerous Restoration', 'Regain sorcery points on a short rest once per long rest.'],
        [7, 'Sorcery Incarnate', 'Spend sorcery points on Innate Sorcery; two Metamagic options per spell while it\'s active.'],
        [20, 'Arcane Apotheosis', 'One free Metamagic per turn during Innate Sorcery.'],
      ],
      picks: (L) => (L >= 2 ? [{ key: 'metamagic', label: 'Metamagic', count: L >= 17 ? 6 : L >= 10 ? 4 : 2, step: 'class', options: Object.entries(METAMAGIC).map(([id, [name, desc]]) => ({ id, name, desc })), rec: ['quickened-spell', 'twinned-spell', 'careful-spell', 'subtle-spell', 'heightened-spell', 'empowered-spell'] }] : []),
      subclasses: {
        draconic: { name: 'Draconic Sorcery', blurb: 'Dragon blood: tougher, scalier, eventually winged.', hpPerLevel: 1, unarmored: ['cha'], spells: { 3: ['chromatic-orb', 'command'], 5: ['fly'] }, features: [
          [3, 'Draconic Resilience', '+1 HP per sorcerer level; without armor, AC is 10 + DEX + CHA.'],
          [6, 'Elemental Affinity', 'Resistance to your dragon\'s damage type and +CHA to spell damage of that type.'],
          [14, 'Dragon Wings', 'Bonus action: 60 ft flying speed for an hour.'],
          [18, 'Dragon Companion', 'Summon Dragon without a slot or concentration.'],
        ] },
        wild: { name: 'Wild Magic Sorcery', blurb: 'Chaos with a smile.', features: [
          [3, 'Wild Magic Surge', 'Your spells sometimes trigger random magical effects.'],
          [3, 'Tides of Chaos', 'Advantage on one d20 test; the DM may trigger a surge to recharge it.'],
          [6, 'Bend Luck', 'Reaction, 1 SP: add or subtract 1d4 from another creature\'s roll.'],
          [14, 'Controlled Chaos', 'Roll twice on the surge table and choose.'],
          [18, 'Tamed Surge', 'Choose a surge effect once per long rest.'],
        ] },
      },
    },
    warlock: {
      name: 'Warlock', hd: 8, saves: ['wis', 'cha'], armor: ['light'], weapons: ['simple'],
      skills: { n: 2, from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'] },
      caster: { kind: 'pact', abil: 'cha', cantrips: (L) => tier(L, 2, 3, 4), prepared: PREPARED.warlock },
      blurb: 'Pact magic from a patron. Few slots, short rests, and a deadly Eldritch Blast.',
      asi: [4, 8, 12, 16, 19],
      rec: { abil: ['cha', 'con', 'dex', 'wis', 'int', 'str'], skills: ['arcana', 'deception'], bg: 'charlatan', gear: { armor: 'leather', shield: false, weapons: ['dagger'] },
        cantrips: ['eldritch-blast', 'mind-sliver', 'minor-illusion', 'prestidigitation'], spells: ['hex', 'armor-of-agathys', 'hellish-rebuke', 'misty-step', 'hold-person', 'shatter', 'counterspell', 'hunger-of-hadar', 'fly'] },
      res: () => ({}),
      features: [
        [1, 'Eldritch Invocations', (c) => (c.picks.invocations || []).map((id) => INVOCATIONS[id] ? `${INVOCATIONS[id][0]} (${INVOCATIONS[id][1]})` : id).join(' ') || 'Choose invocations.'],
        [1, 'Pact Magic', (c) => `${pactSlots(c.L)[0]} slot(s) of level ${pactSlots(c.L)[1]}, regained on a short rest.`],
        [2, 'Magical Cunning', 'Once per long rest, regain half your pact slots in a minute.'],
        [9, 'Contact Patron', 'Contact Other Plane always prepared; cast it free once per long rest.'],
        [11, 'Mystic Arcanum', 'One spell each of 6th (later 7th, 8th, 9th) level, once per long rest.'],
        [20, 'Eldritch Master', 'Magical Cunning restores all slots.'],
      ],
      picks: (L) => [{ key: 'invocations', label: 'Eldritch invocations', count: [1, 3, 3, 3, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10][L - 1], step: 'class',
        options: Object.entries(INVOCATIONS).filter(([, v]) => v[2] <= L).map(([id, [name, desc, lvl]]) => ({ id, name, desc: desc + (lvl > 1 ? ` (level ${lvl}+)` : '') })), rec: ['agonizing-blast', 'pact-of-the-tome', 'devils-sight', 'repelling-blast', 'eldritch-mind', 'armor-of-shadows', 'mask-of-many-faces', 'eldritch-spear', 'misty-visions', 'pact-of-the-chain'] }],
      subclasses: {
        fiend: { name: 'Fiend Patron', blurb: 'Infernal power: temp HP on kills, fire, and luck.', spells: { 3: ['burning-hands', 'command', 'scorching-ray', 'suggestion'], 5: ['fireball'] }, features: [
          [3, 'Dark One\'s Blessing', (c) => `When you drop an enemy to 0 HP, gain ${Math.max(1, c.m.cha + c.L)} temp HP.`],
          [6, 'Dark One\'s Own Luck', 'Add 1d10 to an ability check or save, CHA mod times per long rest.'],
          [10, 'Fiendish Resilience', 'Choose a damage type to resist after each rest.'],
          [14, 'Hurl Through Hell', 'On a hit, once per long rest: send the target through hell for 8d10 psychic.'],
        ] },
        archfey: { name: 'Archfey Patron', blurb: 'Fey trickery and teleports.', spells: { 3: ['faerie-fire', 'sleep', 'misty-step'], 5: ['fear'] }, features: [
          [3, 'Steps of the Fey', 'Misty Step CHA mod times per long rest without a slot, with a charming or frightening rider.'],
          [6, 'Misty Escape', 'Reaction when damaged: cast Misty Step.'],
          [10, 'Beguiling Defenses', 'Immune to charm; reaction: turn a charm back on its caster.'],
          [14, 'Bewitching Magic', 'Free Misty Step after casting an enchantment or illusion.'],
        ] },
      },
    },
    wizard: {
      name: 'Wizard', hd: 6, saves: ['int', 'wis'], armor: [], weapons: ['simple'],
      skills: { n: 2, from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'nature', 'religion'] },
      caster: { kind: 'full', abil: 'int', cantrips: (L) => tier(L, 3, 4, 5), prepared: PREPARED.wizard },
      blurb: 'The scholar of magic. The biggest spell list; fragile but decisive.',
      asi: [4, 8, 12, 16, 19],
      rec: { abil: ['int', 'con', 'dex', 'wis', 'cha', 'str'], skills: ['arcana', 'investigation'], bg: 'sage', gear: { armor: null, shield: false, weapons: ['quarterstaff', 'dagger'] },
        cantrips: ['fire-bolt', 'mage-hand', 'minor-illusion', 'ray-of-frost', 'prestidigitation'], spells: ['shield', 'magic-missile', 'mage-armor', 'sleep', 'misty-step', 'web', 'scorching-ray', 'fireball', 'counterspell', 'haste', 'hypnotic-pattern'] },
      res: (L) => ({ arcaneRecovery: 1 }),
      features: [
        [1, 'Spellcasting', 'Cast wizard spells with INT from your spellbook.'],
        [1, 'Ritual Adept', 'Cast rituals from your spellbook without preparing them.'],
        [1, 'Arcane Recovery', (c) => `Once per day on a short rest, regain slots totalling up to ${Math.ceil(c.L / 2)} levels.`],
        [2, 'Scholar', 'Expertise in one of Arcana, History, Investigation, Medicine, Nature or Religion.'],
        [5, 'Memorize Spell', 'Swap one prepared spell on a short rest.'],
        [18, 'Spell Mastery', 'Cast a chosen 1st- and 2nd-level spell at will.'],
        [20, 'Signature Spells', 'Two 3rd-level spells, each free once per short rest.'],
      ],
      picks: (L) => (L >= 2 ? [{ key: 'scholar', label: 'Scholar (expertise)', count: 1, step: 'class', options: ['arcana', 'history', 'investigation', 'medicine', 'nature', 'religion'].map((id) => ({ id, name: skillName(id) })), rec: ['arcana'], needsProf: true }] : []),
      subclasses: {
        evoker: { name: 'Evoker', blurb: 'Blast big, spare your friends.', features: [
          [3, 'Evocation Savant', 'Two evocation spells added to your spellbook for free.'],
          [3, 'Potent Cantrip', 'Your damage cantrips deal half damage even on a miss or a save.'],
          [6, 'Sculpt Spells', 'Allies automatically save and take no damage from your evocations.'],
          [10, 'Empowered Evocation', 'Add INT to one damage roll of a wizard evocation spell.'],
          [14, 'Overchannel', 'Maximize the damage of a spell of 5th level or lower (risky after the first time).'],
        ] },
        abjurer: { name: 'Abjurer', blurb: 'Wards and counterspells.', features: [
          [3, 'Arcane Ward', 'Casting abjurations creates a ward with 2 x level + INT HP that soaks your damage.'],
          [6, 'Projected Ward', 'Reaction: your ward soaks damage for an ally within 30 ft.'],
          [10, 'Spell Breaker', 'Counterspell and Dispel Magic always prepared; cast Dispel as a bonus action.'],
          [14, 'Spell Resistance', 'Advantage on saves against spells and resistance to their damage.'],
        ] },
      },
    },
  };

  // ---------- species ----------
  const SPECIES = {
    human: { name: 'Human', size: ['medium', 'small'], speed: 30, blurb: 'Adaptable and ambitious: an extra skill and an extra origin feat.',
      traits: [['Resourceful', 'Heroic Inspiration after every long rest (reroll any die once).'], ['Skillful', 'One extra skill proficiency.'], ['Versatile', 'An extra origin feat.']],
      res: () => ({ 'heroic inspiration': 1 }),
      picks: () => [{ key: 'species-skill', label: 'Skillful: one skill', count: 1, step: 'species', skillPick: true, rec: ['perception', 'insight', 'athletics'] },
        { key: 'species-feat', label: 'Versatile: an origin feat', count: 1, step: 'species', feat: 'origin', rec: ['tough', 'alert', 'lucky'] }] },
    elf: { name: 'Elf', size: ['medium'], speed: 30, darkvision: 60, blurb: 'Keen senses, fey grace, and a touch of innate magic.',
      traits: [['Fey Ancestry', 'Advantage on saves against being charmed.'], ['Keen Senses', 'Proficiency in Insight, Perception or Survival.'], ['Trance', 'A 4-hour trance replaces sleep.'], ['Elven Lineage', 'Drow, high elf or wood elf magic.']],
      picks: () => [{ key: 'lineage', label: 'Elven lineage', count: 1, step: 'species', options: [
        { id: 'drow', name: 'Drow', desc: 'Darkvision 120 ft; Dancing Lights, later Faerie Fire and Darkness.' },
        { id: 'high', name: 'High Elf', desc: 'Prestidigitation, later Detect Magic and Misty Step.' },
        { id: 'wood', name: 'Wood Elf', desc: 'Speed 35 ft; Druidcraft, later Longstrider and Pass without Trace.' }], rec: ['wood'] },
        { key: 'species-skill', label: 'Keen Senses', count: 1, step: 'species', options: ['insight', 'perception', 'survival'].map((id) => ({ id, name: skillName(id) })), rec: ['perception'] }],
      lineage: { drow: { darkvision: 120, cantrip: 'dancing-lights' }, high: { cantrip: 'prestidigitation' }, wood: { speed: 35, cantrip: 'druidcraft' } } },
    dwarf: { name: 'Dwarf', size: ['medium'], speed: 30, darkvision: 120, resist: ['poison'], hpPerLevel: 1, blurb: 'Tough as the mountain: extra HP every level and poison resistance.',
      traits: [['Dwarven Resilience', 'Resistance to poison; advantage on saves against being poisoned.'], ['Dwarven Toughness', '+1 HP per level.'], ['Stonecunning', 'Bonus action: tremorsense 60 ft on stone for 10 minutes, prof. bonus times per long rest.']] },
    halfling: { name: 'Halfling', size: ['small'], speed: 30, blurb: 'Small, brave and lucky. Slips past bigger creatures.',
      traits: [['Brave', 'Advantage on saves against being frightened.'], ['Halfling Nimbleness', 'Move through the space of larger creatures.'], ['Luck', 'Reroll a natural 1 on a d20 test.'], ['Naturally Stealthy', 'Hide behind creatures larger than you.']] },
    gnome: { name: 'Gnome', size: ['small'], speed: 30, darkvision: 60, blurb: 'Clever and hard to fool: advantage on INT, WIS and CHA saves.',
      traits: [['Gnomish Cunning', 'Advantage on INT, WIS and CHA saves.'], ['Gnomish Lineage', 'Forest gnome (Minor Illusion, Speak with Animals) or rock gnome (Mending, Prestidigitation, clockwork toys).']],
      picks: () => [{ key: 'lineage', label: 'Gnomish lineage', count: 1, step: 'species', options: [
        { id: 'forest', name: 'Forest Gnome', desc: 'Minor Illusion; Speak with Animals prof. bonus times per long rest.' },
        { id: 'rock', name: 'Rock Gnome', desc: 'Mending and Prestidigitation; build tiny clockwork devices.' }], rec: ['forest'] }],
      lineage: { forest: { cantrip: 'minor-illusion' }, rock: { cantrip: 'mending' } } },
    dragonborn: { name: 'Dragonborn', size: ['medium'], speed: 30, darkvision: 60, blurb: 'Dragon blood: a breath weapon, resistance, and later wings.',
      traits: [['Draconic Ancestry', 'Your dragon sets your damage type.'], ['Breath Weapon', 'Replace one attack: 15-ft cone or 30-ft line, DEX save.'], ['Damage Resistance', 'Resistance to your ancestry\'s damage type.'], ['Draconic Flight', 'From 5th level, sprout wings for 10 minutes once per long rest.']],
      res: (L, m, pb) => ({ breathWeapon: pb }),
      picks: () => [{ key: 'ancestry', label: 'Draconic ancestry', count: 1, step: 'species', options: [
        ['black', 'acid'], ['blue', 'lightning'], ['brass', 'fire'], ['bronze', 'lightning'], ['copper', 'acid'], ['gold', 'fire'], ['green', 'poison'], ['red', 'fire'], ['silver', 'cold'], ['white', 'cold']]
        .map(([id, t]) => ({ id, name: `${title(id)} (${t})`, desc: `Breath and resistance: ${t}.`, type: t })), rec: ['red'] }] },
    orc: { name: 'Orc', size: ['medium'], speed: 30, darkvision: 120, blurb: 'Relentless: bursts of speed and refusing to go down.',
      traits: [['Adrenaline Rush', 'Bonus action Dash and gain temp HP equal to your prof. bonus, prof. bonus times per short rest.'], ['Relentless Endurance', 'Once per long rest, drop to 1 HP instead of 0.']],
      res: (L, m, pb) => ({ adrenalineRush: pb, relentlessEndurance: 1 }) },
    tiefling: { name: 'Tiefling', size: ['medium', 'small'], speed: 30, darkvision: 60, blurb: 'Fiendish heritage: a resistance and innate spells.',
      traits: [['Fiendish Legacy', 'Abyssal (poison), chthonic (necrotic) or infernal (fire): resistance and spells.'], ['Otherworldly Presence', 'Thaumaturgy cantrip.']],
      picks: () => [{ key: 'lineage', label: 'Fiendish legacy', count: 1, step: 'species', options: [
        { id: 'abyssal', name: 'Abyssal', desc: 'Poison resistance; Poison Spray, later Ray of Sickness and Hold Person.' },
        { id: 'chthonic', name: 'Chthonic', desc: 'Necrotic resistance; Chill Touch, later False Life and Ray of Enfeeblement.' },
        { id: 'infernal', name: 'Infernal', desc: 'Fire resistance; Fire Bolt, later Hellish Rebuke and Darkness.' }], rec: ['infernal'] }],
      lineage: { abyssal: { resist: 'poison', cantrip: 'poison-spray' }, chthonic: { resist: 'necrotic', cantrip: 'chill-touch' }, infernal: { resist: 'fire', cantrip: 'fire-bolt' } } },
    goliath: { name: 'Goliath', size: ['medium'], speed: 35, blurb: 'Giant-kin: fast, strong, and a giant\'s gift.',
      traits: [['Giant Ancestry', 'A gift from your giant forebears, prof. bonus times per long rest.'], ['Large Form', 'From 5th level, become Large for 10 minutes once per long rest.'], ['Powerful Build', 'Advantage to end grapples; count as a size larger for carrying.']],
      res: (L, m, pb) => ({ giantGift: pb }),
      picks: () => [{ key: 'lineage', label: 'Giant ancestry', count: 1, step: 'species', options: [
        { id: 'cloud', name: 'Cloud\'s Jaunt', desc: 'Bonus action: teleport 30 ft.' },
        { id: 'fire', name: 'Fire\'s Burn', desc: 'On a hit: +1d10 fire.' },
        { id: 'frost', name: 'Frost\'s Chill', desc: 'On a hit: +1d6 cold and -10 ft speed.' },
        { id: 'hill', name: 'Hill\'s Tumble', desc: 'On a hit: knock a Large or smaller target prone.' },
        { id: 'stone', name: 'Stone\'s Endurance', desc: 'Reaction: reduce damage by 1d12 + CON.' },
        { id: 'storm', name: 'Storm\'s Thunder', desc: 'Reaction when damaged: 1d8 thunder to the attacker.' }], rec: ['stone'] }] },
    aasimar: { name: 'Aasimar', size: ['medium', 'small'], speed: 30, darkvision: 60, resist: ['necrotic', 'radiant'], blurb: 'Celestial spark: healing hands and radiant transformations.',
      traits: [['Celestial Resistance', 'Resistance to necrotic and radiant.'], ['Healing Hands', 'Once per long rest, heal prof. bonus d4s.'], ['Light Bearer', 'Light cantrip.'], ['Celestial Revelation', 'From 3rd level, transform for a minute once per long rest: wings, radiant aura, or a frightening shroud; +prof. bonus damage once per turn.']],
      res: () => ({ healingHands: 1 }) },
  };

  // ---------- backgrounds ----------
  const BG = (name, abil, skills, feat, extra = {}) => Object.assign({ name, abil, skills, feat }, extra);
  const BACKGROUNDS = {
    acolyte: BG('Acolyte', ['int', 'wis', 'cha'], ['insight', 'religion'], 'magic-initiate', { list: 'cleric' }),
    artisan: BG('Artisan', ['str', 'dex', 'int'], ['investigation', 'persuasion'], 'crafter'),
    charlatan: BG('Charlatan', ['dex', 'con', 'cha'], ['deception', 'sleight-of-hand'], 'skilled'),
    criminal: BG('Criminal', ['dex', 'con', 'int'], ['sleight-of-hand', 'stealth'], 'alert'),
    entertainer: BG('Entertainer', ['str', 'dex', 'cha'], ['acrobatics', 'performance'], 'musician'),
    farmer: BG('Farmer', ['str', 'con', 'wis'], ['animal-handling', 'nature'], 'tough'),
    guard: BG('Guard', ['str', 'int', 'wis'], ['athletics', 'perception'], 'alert'),
    guide: BG('Guide', ['dex', 'con', 'wis'], ['stealth', 'survival'], 'magic-initiate', { list: 'druid' }),
    hermit: BG('Hermit', ['con', 'wis', 'cha'], ['medicine', 'religion'], 'healer'),
    merchant: BG('Merchant', ['con', 'int', 'cha'], ['animal-handling', 'persuasion'], 'lucky'),
    noble: BG('Noble', ['str', 'int', 'cha'], ['history', 'persuasion'], 'skilled'),
    sage: BG('Sage', ['con', 'int', 'wis'], ['arcana', 'history'], 'magic-initiate', { list: 'wizard' }),
    sailor: BG('Sailor', ['str', 'dex', 'wis'], ['acrobatics', 'perception'], 'tavern-brawler'),
    scribe: BG('Scribe', ['dex', 'int', 'wis'], ['investigation', 'perception'], 'skilled'),
    soldier: BG('Soldier', ['str', 'dex', 'con'], ['athletics', 'intimidation'], 'savage-attacker'),
    wayfarer: BG('Wayfarer', ['dex', 'wis', 'cha'], ['insight', 'stealth'], 'lucky'),
    custom: BG('Custom background', ABIL, [], null, { custom: true }),
  };

  // ---------- feats ----------
  // Effects use the power vocabulary (lib/power.js) where they change the numbers.
  const FEATS = {
    alert: { name: 'Alert', cat: 'origin', desc: 'Add your proficiency bonus to initiative; swap initiative with a willing ally.', effects: [{ kind: 'initiative-prof' }] },
    crafter: { name: 'Crafter', cat: 'origin', desc: 'Three artisan\'s tools, 20% off nonmagical gear, craft faster.' },
    healer: { name: 'Healer', cat: 'origin', desc: 'Use a healer\'s kit to let a creature spend a Hit Die and add your prof. bonus; reroll 1s on healing.' },
    lucky: { name: 'Lucky', cat: 'origin', desc: 'Luck points equal to your prof. bonus per long rest: give yourself advantage, or an attacker disadvantage.', res: (pb) => ({ luck: pb }) },
    'magic-initiate': { name: 'Magic Initiate', cat: 'origin', desc: 'Two cantrips and one 1st-level spell (free once per long rest) from the cleric, druid or wizard list.', repeat: true },
    musician: { name: 'Musician', cat: 'origin', desc: 'Three instruments; after a rest, give Heroic Inspiration to allies equal to your prof. bonus.' },
    'savage-attacker': { name: 'Savage Attacker', cat: 'origin', desc: 'Once per turn, roll a weapon\'s damage dice twice and use either.' },
    skilled: { name: 'Skilled', cat: 'origin', desc: 'Proficiency in three skills.', repeat: true },
    'tavern-brawler': { name: 'Tavern Brawler', cat: 'origin', desc: 'Unarmed strikes deal 1d4 + STR, reroll 1s, push 5 ft once per turn; improvised weapon proficiency.' },
    tough: { name: 'Tough', cat: 'origin', desc: '+2 HP per level.', effects: [{ kind: 'hp-per-level', value: 2 }] },

    asi: { name: 'Ability Score Improvement', cat: 'general', desc: '+2 to one ability or +1 to two (max 20).', repeat: true },
    athlete: { name: 'Athlete', cat: 'general', abil: ['str', 'dex'], desc: '+1 STR or DEX; climbing speed; stand up with 5 ft; running jumps after 5 ft.' },
    charger: { name: 'Charger', cat: 'general', abil: ['str', 'dex'], desc: '+1 STR or DEX; Dash is +10 ft; after moving 10 ft straight, +1d8 or a 10-ft push on a melee hit.' },
    'crossbow-expert': { name: 'Crossbow Expert', cat: 'general', abil: ['dex'], desc: '+1 DEX; ignore loading; no disadvantage firing in melee; add ability modifier to the off-hand crossbow.' },
    'defensive-duelist': { name: 'Defensive Duelist', cat: 'general', abil: ['dex'], desc: '+1 DEX; reaction with a finesse weapon: +prof. bonus AC against melee attacks until your next turn.' },
    'dual-wielder': { name: 'Dual Wielder', cat: 'general', abil: ['str', 'dex'], desc: '+1 STR or DEX; off-hand attack with non-light weapons; draw two weapons at once.' },
    durable: { name: 'Durable', cat: 'general', abil: ['con'], desc: '+1 CON; advantage on death saves; bonus action to spend a Hit Die.' },
    'elemental-adept': { name: 'Elemental Adept', cat: 'general', abil: ['int', 'wis', 'cha'], desc: '+1 casting ability; your spells ignore resistance to one damage type and treat 1s as 2s.', needs: 'spells' },
    grappler: { name: 'Grappler', cat: 'general', abil: ['str', 'dex'], desc: '+1 STR or DEX; grapple as part of an unarmed hit; advantage on attacks against creatures you grapple.' },
    'great-weapon-master': { name: 'Great Weapon Master', cat: 'general', abil: ['str'], desc: '+1 STR; heavy weapon hits deal +prof. bonus damage; bonus action attack after a crit or a kill.' },
    'heavily-armored': { name: 'Heavily Armored', cat: 'general', abil: ['str', 'con'], desc: '+1 STR or CON; heavy armor training.', needs: 'medium', armor: 'heavy' },
    'heavy-armor-master': { name: 'Heavy Armor Master', cat: 'general', abil: ['str', 'con'], desc: '+1 STR or CON; in heavy armor, reduce bludgeoning, piercing and slashing damage by your prof. bonus.', needs: 'heavy' },
    'inspiring-leader': { name: 'Inspiring Leader', cat: 'general', abil: ['wis', 'cha'], desc: '+1 WIS or CHA; after a rest, allies gain temp HP equal to your level + modifier.' },
    'keen-mind': { name: 'Keen Mind', cat: 'general', abil: ['int'], desc: '+1 INT; expertise in a knowledge skill; Study action as a bonus action.' },
    'lightly-armored': { name: 'Lightly Armored', cat: 'general', abil: ['str', 'dex'], desc: '+1 STR or DEX; light armor and shield training.', armor: 'light' },
    'mage-slayer': { name: 'Mage Slayer', cat: 'general', abil: ['str', 'dex'], desc: '+1 STR or DEX; your hits break concentration more easily; reroll a failed mental save once per rest.' },
    'martial-weapon-training': { name: 'Martial Weapon Training', cat: 'general', abil: ['str', 'dex'], desc: '+1 STR or DEX; martial weapon proficiency.', weapons: 'martial' },
    'medium-armor-master': { name: 'Medium Armor Master', cat: 'general', abil: ['str', 'dex'], desc: '+1 STR or DEX; medium armor allows +3 DEX to AC.', needs: 'medium' },
    'moderately-armored': { name: 'Moderately Armored', cat: 'general', abil: ['str', 'dex'], desc: '+1 STR or DEX; medium armor training.', needs: 'light', armor: 'medium' },
    observant: { name: 'Observant', cat: 'general', abil: ['int', 'wis'], desc: '+1 INT or WIS; expertise in Insight, Investigation or Perception; Search as a bonus action.' },
    'polearm-master': { name: 'Polearm Master', cat: 'general', abil: ['str', 'dex'], desc: '+1 STR or DEX; bonus action butt-end attack (1d4); opportunity attacks when creatures enter your reach.' },
    resilient: { name: 'Resilient', cat: 'general', abil: ABIL, desc: '+1 to an ability and proficiency in its saving throw.', repeat: true },
    'ritual-caster': { name: 'Ritual Caster', cat: 'general', abil: ['int', 'wis', 'cha'], desc: '+1 INT, WIS or CHA; prepare rituals and cast one quickly per rest.' },
    sentinel: { name: 'Sentinel', cat: 'general', abil: ['str', 'dex'], desc: '+1 STR or DEX; opportunity attacks stop movement and trigger on Disengage and on attacks against allies.' },
    'shadow-touched': { name: 'Shadow Touched', cat: 'general', abil: ['int', 'wis', 'cha'], desc: '+1 INT, WIS or CHA; Invisibility and a 1st-level illusion or necromancy spell, each free once per long rest.' },
    sharpshooter: { name: 'Sharpshooter', cat: 'general', abil: ['dex'], desc: '+1 DEX; ranged attacks ignore half and three-quarters cover; no disadvantage at long range or in melee.' },
    'shield-master': { name: 'Shield Master', cat: 'general', abil: ['str'], desc: '+1 STR; shield bash to push or knock prone; add your shield to DEX saves and take no damage on a success.' },
    'skill-expert': { name: 'Skill Expert', cat: 'general', abil: ABIL, desc: '+1 to any ability; one skill proficiency; expertise in one skill.' },
    skulker: { name: 'Skulker', cat: 'general', abil: ['dex'], desc: '+1 DEX; blindsight 10 ft; missing a ranged attack doesn\'t reveal you; advantage on Stealth for... staying hidden.' },
    speedy: { name: 'Speedy', cat: 'general', abil: ['dex', 'con'], desc: '+1 DEX or CON; +10 ft speed; Dash ignores difficult terrain; opportunity attacks against you have disadvantage.', effects: [{ kind: 'speed', value: 10 }] },
    'spell-sniper': { name: 'Spell Sniper', cat: 'general', abil: ['int', 'wis', 'cha'], desc: '+1 casting ability; spell attacks ignore half and three-quarters cover and get +60 ft range; no disadvantage in melee.', needs: 'spells' },
    telekinetic: { name: 'Telekinetic', cat: 'general', abil: ['int', 'wis', 'cha'], desc: '+1 INT, WIS or CHA; invisible Mage Hand; bonus action shove 5 ft (STR save).' },
    telepathic: { name: 'Telepathic', cat: 'general', abil: ['int', 'wis', 'cha'], desc: '+1 INT, WIS or CHA; telepathy 60 ft; Detect Thoughts once per long rest.' },
    'war-caster': { name: 'War Caster', cat: 'general', abil: ['int', 'wis', 'cha'], desc: '+1 casting ability; advantage on concentration saves; cast a spell as an opportunity attack.', needs: 'spells' },
    'weapon-master': { name: 'Weapon Master', cat: 'general', abil: ['str', 'dex'], desc: '+1 STR or DEX; the mastery property of one more weapon.' },
  };

  // ---------- helpers ----------
  const martialDie = (L) => (L >= 17 ? 12 : L >= 11 ? 10 : L >= 5 ? 8 : 6);
  const unarmoredMove = (L) => (L >= 18 ? 30 : L >= 14 ? 25 : L >= 10 ? 20 : L >= 6 ? 15 : L >= 2 ? 10 : 0);
  const pactSlots = (L) => [L >= 17 ? 4 : L >= 11 ? 3 : L >= 2 ? 2 : 1, Math.min(5, Math.ceil(L / 2))];
  function styleOptions() { return Object.entries(FIGHTING_STYLES).map(([id, f]) => ({ id, name: f.name, desc: f.desc })); }
  function hbName(c, id) { const h = (c.b.homebrew || []).find((x) => 'hb:' + x.id === id); return h ? h.name + ' (homebrew)' : id; }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  // A fingerprint of what a homebrew element does; approval is tied to it, so editing undoes approval.
  function hbSig(h) { return JSON.stringify([h.name || '', h.slot || '', h.text || '', h.effects || []]); }

  function blank(level = 3) {
    return { name: '', level, species: null, class: null, subclass: null, background: null, bgBonus: {},
      abilities: { method: 'standard', base: { str: null, dex: null, con: null, int: null, wis: null, cha: null } },
      picks: {}, gear: { armor: null, shield: false, weapons: [], items: [] }, hp: { method: 'average' },
      details: { concept: '', persona: '', appearance: '', color: '#4fb3a4', size: null }, homebrew: [] };
  }

  // ---------- derive ----------
  function derive(input, opts = {}) {
    const b = Object.assign(blank(), clone(input || {}));
    b.abilities = Object.assign({ method: 'standard', base: {} }, b.abilities || {});
    b.picks = b.picks || {}; b.gear = Object.assign({ armor: null, shield: false, weapons: [], items: [] }, b.gear || {});
    b.details = Object.assign({}, blank().details, b.details || {});
    b.homebrew = b.homebrew || [];
    const L = Math.min(20, Math.max(1, Math.round(Number(b.level) || 3)));
    const pb = profBonus(L);
    const errors = [], todo = [], warnings = [], dm = [], needs = [];
    const err = (step, msg) => errors.push({ step, msg });
    const cfg = opts.config || {};

    // Homebrew: rate everything, decide what's active.
    const hbs = b.homebrew.map((h) => {
      const rating = Power.rate(h, { level: L, config: cfg });
      const approved = h.status === 'approved' && h.approvedSig === hbSig(h);
      const auto = h.status === 'auto' && !rating.needsDm && ['fair', 'under', 'creep'].includes(rating.verdict);
      return { h, rating, active: approved || auto, approved, auto };
    });
    const pool = Power.ratePool(hbs.filter((x) => x.auto).map((x) => x.rating), cfg);
    if (pool.over) for (const x of hbs) if (x.auto && x.rating.verdict === 'creep') { x.active = false; x.poolBlocked = true; }
    for (const x of hbs) {
      if (x.h.status === 'pending') dm.push({ step: 'homebrew', what: `Homebrew "${x.h.name || 'untitled'}" is waiting for the DM.` });
      else if (x.h.status === 'auto' && !x.active) dm.push({ step: 'homebrew', what: `Homebrew "${x.h.name || 'untitled'}" ${x.poolBlocked ? 'pushes the character past the power-creep pool' : 'is no longer inside the automatic allowance'}: trim it or send it to the DM.` });
      else if (x.h.status === 'approved' && !x.approved) dm.push({ step: 'homebrew', what: `Homebrew "${x.h.name || 'untitled'}" changed after the DM approved it: send it again.` });
    }
    const activeHb = (slot) => hbs.filter((x) => x.active && (!slot || x.h.slot === slot)).map((x) => x.h);
    const hbOptions = (slot) => activeHb(slot).map((h) => ({ id: 'hb:' + h.id, name: h.name + ' (homebrew)', desc: h.text || '', homebrew: true }));
    const pickedHb = (ids) => (ids || []).filter((id) => String(id).startsWith('hb:')).map((id) => b.homebrew.find((h) => 'hb:' + h.id === id)).filter(Boolean);

    // Needs: the choices left to make. Each is validated against b.picks[key].
    const picks = (key) => (Array.isArray(b.picks[key]) ? b.picks[key] : []);
    function need(n) {
      n.count = n.count || 1;
      if (n.skillPick && !n.options) n.options = ALL_SKILLS.map((id) => ({ id, name: skillName(id) }));
      const chosen = picks(n.key);
      const valid = new Set(n.options.map((o) => o.id));
      const bad = chosen.filter((id) => !valid.has(id) && !(n.custom && String(id).startsWith('custom:')));
      const dupes = bad.filter((id) => n.taken && n.taken.has(id)), gone = bad.filter((id) => !dupes.includes(id));
      if (dupes.length) err(n.step, `${n.label}: you already get ${dupes.map(skillName).join(' and ')} from elsewhere now; pick ${dupes.length > 1 ? 'others' : 'another'} instead.`);
      if (gone.length) err(n.step, `${n.label}: "${gone.map((x) => String(x).replace(/^(hb|custom):/, '')).join('", "')}" isn't an option any more.`);
      if (!n.dup && new Set(chosen).size !== chosen.length) err(n.step, `${n.label}: the same option is picked twice.`);
      if (chosen.length > n.count) err(n.step, `${n.label}: pick ${n.count}, not ${chosen.length}.`);
      // The curated spell list stops at 3rd level: past that, extra picks are named by hand and don't block.
      if (chosen.length < n.count && n.custom && chosen.length >= n.options.length) warnings.push({ step: n.step, msg: `${n.label}: ${n.count - chosen.length} more can be added by name.` });
      else if (chosen.length < n.count) todo.push({ step: n.step, msg: `${n.label}: ${n.count - chosen.length} more to pick.` });
      n.chosen = chosen.filter((id) => valid.has(id) || String(id).startsWith('custom:'));
      needs.push(n);
      return n.chosen;
    }

    // ---- species ----
    let sp = SPECIES[b.species];
    let spHb = null;
    if (!sp && String(b.species || '').startsWith('hb:')) {
      spHb = b.homebrew.find((h) => 'hb:' + h.id === b.species);
      if (spHb && hbs.find((x) => x.h === spHb).active) sp = { name: spHb.name, size: ['medium', 'small'], speed: 30, traits: [[spHb.name, spHb.text || '']], homebrew: true };
      else err('species', 'That homebrew species isn\'t approved yet.');
    }
    if (!sp) todo.push({ step: 'species', msg: 'Choose a species.' });
    const size = sp ? (sp.size.includes(b.details.size) ? b.details.size : sp.size[0]) : 'medium';
    let lineage = null;
    if (sp && sp.picks) for (const n of sp.picks(L)) {
      if (n.feat) n.options = featOptions('origin');
      const got = need(n);
      if (n.key === 'lineage' && got[0]) lineage = (sp.lineage || {})[got[0]] || null;
    }

    // ---- class ----
    const cls = CLASSES[b.class];
    if (!cls) todo.push({ step: 'class', msg: 'Choose a class.' });
    let sub = cls && cls.subclasses[b.subclass];
    if (cls && b.subclass && !sub) err('class', 'That subclass isn\'t one of this class\'s.');
    if (cls && L >= 3 && !sub) todo.push({ step: 'class', msg: `Choose a ${cls.name.toLowerCase()} subclass (3rd level).` });
    if (sub && L < 3) sub = null;

    // ---- background ----
    const bg = BACKGROUNDS[b.background];
    if (!bg) todo.push({ step: 'background', msg: 'Choose a background.' });
    const bonus = {};
    if (bg) {
      const entries = Object.entries(b.bgBonus || {}).filter(([, v]) => Number(v));
      const vals = entries.map(([, v]) => Number(v)).sort();
      const allowed = bg.custom ? ABIL : bg.abil;
      if (!entries.length) todo.push({ step: 'background', msg: 'Assign the background\'s ability bonuses (+2/+1 or +1/+1/+1).' });
      else if (entries.some(([k]) => !allowed.includes(k))) err('background', `${bg.name} can only raise ${allowed.map((a) => a.toUpperCase()).join(', ')}.`);
      else if (!(vals.join() === '1,2' || vals.join() === '1,1,1')) err('background', 'Background bonuses are +2 and +1, or +1 to three abilities.');
      else for (const [k, v] of entries) bonus[k] = (bonus[k] || 0) + Number(v);
    }

    // ---- ability scores ----
    const base = {};
    const meth = b.abilities.method;
    const vals = ABIL.map((a) => b.abilities.base[a]);
    const filled = vals.every((v) => Number.isInteger(v));
    for (const a of ABIL) base[a] = Number.isInteger(b.abilities.base[a]) ? b.abilities.base[a] : 10;
    if (!filled) todo.push({ step: 'abilities', msg: 'Assign all six ability scores.' });
    else if (meth === 'standard') {
      if ([...vals].sort((x, y) => y - x).join() !== STANDARD_ARRAY.join()) err('abilities', `The standard array is ${STANDARD_ARRAY.join(', ')}, each used once.`);
    } else if (meth === 'pointbuy') {
      if (vals.some((v) => v < 8 || v > 15)) err('abilities', 'Point buy scores run from 8 to 15.');
      else {
        const spent = vals.reduce((t, v) => t + POINT_COST[v], 0);
        if (spent > POINTS) err('abilities', `That costs ${spent} points; you have ${POINTS}.`);
        else if (spent < POINTS) warnings.push({ step: 'abilities', msg: `${POINTS - spent} point-buy points left unspent.` });
      }
    } else if (meth === 'rolled') {
      const rolls = (b.abilities.rolls || []).map((r) => (typeof r === 'number' ? r : r.total));
      if (rolls.length !== 6) todo.push({ step: 'abilities', msg: 'Roll your ability scores.' });
      else if ([...vals].sort((x, y) => y - x).join() !== [...rolls].sort((x, y) => y - x).join()) err('abilities', `Use each rolled score once: ${rolls.join(', ')}.`);
    } else if (meth === 'manual') {
      if (vals.some((v) => v < 3 || v > 20)) err('abilities', 'Scores run from 3 to 20.');
      if (!b.abilities.approved) dm.push({ step: 'abilities', what: 'Hand-entered ability scores need the DM\'s OK.' });
    } else err('abilities', 'Pick a method for ability scores.');

    // ---- feats: background, human, ASI levels ----
    const feats = []; // { id, key, src }
    const featNeeds = (prefix, featId, src) => {
      if (!featId) return;
      if (String(featId).startsWith('hb:')) {
        const h = pickedHb([featId])[0];
        if (h) feats.push({ id: featId, hb: h, key: prefix, src });
        return;
      }
      const f = FEATS[featId];
      if (!f) return;
      feats.push({ id: featId, key: prefix, src });
      if (featId === 'asi') need({ key: prefix + ':asi', label: `${src}: ability increases`, count: 2, dup: true, step: 'feats', options: ABIL.map((a) => ({ id: a, name: ABIL_NAME[a] })), group: src });
      else if (f.abil) need({ key: prefix + ':ability', label: `${f.name}: +1 to`, count: 1, step: 'feats', options: f.abil.map((a) => ({ id: a, name: ABIL_NAME[a] })), group: src });
      if (featId === 'skilled') need({ key: prefix + ':skills', label: 'Skilled: three skills', count: 3, step: 'feats', skillPick: true, group: src, rec: ['perception', 'stealth', 'insight', 'athletics', 'persuasion', 'investigation'] });
      if (featId === 'skill-expert') need({ key: prefix + ':skills', label: 'Skill Expert: one skill', count: 1, step: 'feats', skillPick: true, group: src, rec: ['perception', 'stealth'] });
      if (featId === 'observant') need({ key: prefix + ':expertise', label: 'Observant: expertise', count: 1, step: 'feats', options: ['insight', 'investigation', 'perception'].map((id) => ({ id, name: skillName(id) })), group: src, needsProf: true, rec: ['perception'] });
      if (featId === 'magic-initiate') {
        const fixed = src === 'Background' && bg && bg.list;
        const list = fixed || picks(prefix + ':list')[0] || null;
        if (!fixed) need({ key: prefix + ':list', label: 'Magic Initiate: spell list', count: 1, step: 'feats', options: ['cleric', 'druid', 'wizard'].map((id) => ({ id, name: title(id) })), group: src, rec: ['wizard'] });
        if (list) {
          const lc = list === 'wizard' ? ['wizard', 'sorcerer'] : [list];
          need({ key: prefix + ':cantrips', label: `Magic Initiate (${title(list)}): two cantrips`, count: 2, step: 'feats', group: src, options: SPELL_LIST.filter((s) => s.level === 0 && s.classes.includes(list)).map(spellOpt), rec: ((CLASSES[list] || {}).rec || {}).cantrips });
          need({ key: prefix + ':spell', label: `Magic Initiate (${title(list)}): one 1st-level spell`, count: 1, step: 'feats', group: src, options: SPELL_LIST.filter((s) => s.level === 1 && s.classes.includes(list)).map(spellOpt), rec: ((CLASSES[list] || {}).rec || {}).spells });
          void lc;
        }
      }
    };
    if (bg) {
      if (bg.custom) {
        need({ key: 'bg-skills', label: 'Background skills', count: 2, step: 'background', skillPick: true, rec: ['perception', 'insight', 'athletics', 'stealth'] });
        const f = need({ key: 'bg-feat', label: 'Background origin feat', count: 1, step: 'background', options: featOptions('origin'), hbSlot: 'origin-feat', rec: ['tough', 'alert'] });
        featNeeds('bg-feat', f[0], 'Background');
      } else featNeeds('bg-feat', bg.feat, 'Background');
    }
    if (sp && b.species === 'human') featNeeds('species-feat', picks('species-feat')[0], 'Human');
    if (cls) {
      for (const lv of cls.asi.filter((x) => x <= L)) {
        const key = `feat-${lv}`;
        const got = need({ key, label: `Level ${lv} feat`, count: 1, step: 'feats', options: featOptions('general', lv), hbSlot: 'feat', rec: ['asi'], group: `Level ${lv}` });
        featNeeds(key, got[0], `Level ${lv}`);
      }
    }
    function featOptions(cat, lv) {
      const out = Object.entries(FEATS).filter(([, f]) => f.cat === cat || (cat === 'general' && f.cat === 'origin'))
        .map(([id, f]) => ({ id, name: f.name, desc: f.desc + (f.cat === 'origin' && cat === 'general' ? ' (origin feat)' : ''), cat: f.cat }));
      return out.concat(hbOptions(cat === 'origin' ? 'origin-feat' : 'feat'), cat === 'general' ? hbOptions('origin-feat') : []);
    }
    // Feats can't be taken twice unless they say so.
    const seen = {};
    for (const f of feats) {
      if (seen[f.id] && !(FEATS[f.id] || {}).repeat) err('feats', `${(FEATS[f.id] || {}).name || f.id} is taken twice.`);
      seen[f.id] = true;
    }

    // ---- final ability scores ----
    const score = {};
    for (const a of ABIL) score[a] = base[a] + (bonus[a] || 0);
    for (const f of feats) {
      if (f.id === 'asi') for (const a of picks(f.key + ':asi')) score[a] = (score[a] || 0) + 1;
      else if (FEATS[f.id] && FEATS[f.id].abil) for (const a of picks(f.key + ':ability')) score[a] += 1;
    }
    const hbEffects = [];
    const useHb = (h) => { for (const e of h.effects || []) hbEffects.push(Object.assign({ from: h.name }, e)); };
    for (const h of activeHb()) if (!['origin-feat', 'feat', 'fighting-style', 'species'].includes(h.slot)) useHb(h);
    if (spHb && sp && sp.homebrew) useHb(spHb);
    for (const f of feats) if (f.hb) useHb(f.hb);
    const styleIds = [...picks('fighting-style'), ...picks('fighting-style-2')];
    for (const h of pickedHb(styleIds)) useHb(h);
    for (const e of hbEffects) if (e.kind === 'ability' && ABIL.includes(e.ability)) score[e.ability] += Number(e.value) || 1;
    const cap = {};
    for (const a of ABIL) cap[a] = 20;
    if (cls && b.class === 'barbarian' && L >= 20) { score.str += 4; score.con += 4; cap.str = cap.con = 25; }
    if (cls && b.class === 'monk' && L >= 20) { score.dex += 4; score.wis += 4; cap.dex = cap.wis = 25; }
    for (const a of ABIL) if (score[a] > cap[a]) { warnings.push({ step: 'feats', msg: `${ABIL_NAME[a]} would be ${score[a]}; it caps at ${cap[a]}.` }); score[a] = cap[a]; }
    const m = {};
    for (const a of ABIL) m[a] = mod(score[a]);

    // ---- proficiencies ----
    const skills = new Set(), expertise = new Set(), saveProf = new Set(cls ? cls.saves : []);
    const armorTr = new Set([...(cls ? cls.armor : []), ...((sub && sub.armor) || [])]);
    const weaponTr = new Set([...(cls ? cls.weapons : []), ...((sub && sub.weapons) || [])]);
    const granted = new Set();
    if (bg && !bg.custom) bg.skills.forEach((s) => granted.add(s));
    picks('bg-skills').forEach((s) => granted.add(s));
    if (sp) picks('species-skill').forEach((s) => granted.add(s));
    for (const f of feats) {
      picks(f.key + ':skills').forEach((s) => granted.add(s));
      if (f.id === 'resilient') picks(f.key + ':ability').forEach((a) => saveProf.add(a));
      if (FEATS[f.id] && FEATS[f.id].armor) { const t = FEATS[f.id].armor; armorTr.add(t); if (t === 'light') armorTr.add('shield'); }
      if (FEATS[f.id] && FEATS[f.id].weapons) weaponTr.add('martial');
      const req = FEATS[f.id] && FEATS[f.id].needs;
      if (req === 'spells' && !(cls && cls.caster) && !feats.some((x) => x.id === 'magic-initiate')) err('feats', `${FEATS[f.id].name} needs the ability to cast spells.`);
      if (['light', 'medium', 'heavy'].includes(req) && !armorTr.has(req)) err('feats', `${FEATS[f.id].name} needs ${req} armor training.`);
    }
    const order = picks('divine-order')[0], primal = picks('primal-order')[0];
    if (b.class === 'cleric' && order === 'protector') { armorTr.add('heavy'); weaponTr.add('martial'); }
    if (b.class === 'druid' && primal === 'warden') { armorTr.add('medium'); weaponTr.add('martial'); }
    for (const e of hbEffects) {
      if (e.kind === 'skill' && SKILLS[e.skill]) granted.add(e.skill);
      if (e.kind === 'save' && ABIL.includes(e.ability)) saveProf.add(e.ability);
      if (e.kind === 'armor-training') armorTr.add(e.armor || 'light');
      if (e.kind === 'weapon-training') weaponTr.add('martial');
    }
    granted.forEach((s) => skills.add(s));
    if (cls) {
      const from = cls.skills.from.filter((s) => !granted.has(s));
      const got = need({ key: 'skills', label: `${cls.name} skills`, count: cls.skills.n, step: 'class', options: from.map((id) => ({ id, name: skillName(id) })), rec: cls.rec.skills, taken: granted });
      got.forEach((s) => skills.add(s));
      if (b.class === 'barbarian' && L >= 3) need({ key: 'primal-knowledge', label: 'Primal Knowledge: one more skill', count: 1, step: 'class', options: cls.skills.from.filter((s) => !skills.has(s) || picks('primal-knowledge').includes(s)).map((id) => ({ id, name: skillName(id) })), rec: cls.skills.from }).forEach((s) => skills.add(s));
      if (sub && b.subclass === 'lore') need({ key: 'lore-skills', label: 'Bonus Proficiencies: three skills', count: 3, step: 'class', options: ALL_SKILLS.filter((s) => !skills.has(s) || picks('lore-skills').includes(s)).map((id) => ({ id, name: skillName(id) })), rec: ['arcana', 'history', 'insight', 'investigation', 'perception'] }).forEach((s) => skills.add(s));
    }
    // Class feature picks (fighting styles, maneuvers, invocations...).
    const classPicks = [...((cls && cls.picks && cls.picks(L)) || []), ...((sub && sub.picks && sub.picks(L)) || [])];
    for (const n of classPicks) {
      if (n.hbSlot) n.options = n.options.concat(hbOptions(n.hbSlot));
      if (n.key === 'fighting-style-2') n.options = n.options.filter((o) => !picks('fighting-style').includes(o.id));
      if (n.skillPick) n.options = ALL_SKILLS.filter((s) => !skills.has(s) || picks(n.key).includes(s)).map((id) => ({ id, name: skillName(id) }));
      const got = need(n);
      if (n.skillPick) got.forEach((s) => skills.add(s));
    }
    if (b.class === 'monk' && L >= 14) ABIL.forEach((a) => saveProf.add(a));
    if (b.class === 'rogue' && L >= 15) { saveProf.add('wis'); saveProf.add('cha'); }
    // Expertise.
    const expCount = cls ? (b.class === 'bard' ? (L >= 9 ? 4 : L >= 2 ? 2 : 0) : cls.expertise ? cls.expertise(L) : 0) : 0;
    if (expCount) need({ key: 'expertise', label: 'Expertise', count: expCount, step: 'class', options: [...skills].sort().map((id) => ({ id, name: skillName(id) })), rec: cls.rec.skills }).forEach((s) => expertise.add(s));
    for (const n of needs.filter((x) => x.needsProf)) for (const s of n.chosen) { if (!skills.has(s)) err(n.step, `${n.label}: expertise needs proficiency in ${skillName(s)} first.`); else expertise.add(s); }
    for (const f of feats) if (f.id === 'skill-expert') need({ key: f.key + ':expertise', label: 'Skill Expert: expertise', count: 1, step: 'feats', options: [...skills].sort().map((id) => ({ id, name: skillName(id) })), group: f.src }).forEach((s) => expertise.add(s));
    for (const e of hbEffects) if (e.kind === 'expertise' && skills.has(e.skill)) expertise.add(e.skill);
    const styles = new Set(styleIds.filter((id) => FIGHTING_STYLES[id]));

    // ---- spells ----
    const spellInfo = { cantrips: [], prepared: [], always: [], slots: [], dc: null, atk: null, abil: null, extra: [] };
    const caster = cls && cls.caster;
    if (caster) {
      const ab = caster.abil;
      spellInfo.abil = ab; spellInfo.dc = 8 + pb + m[ab]; spellInfo.atk = pb + m[ab];
      let maxLevel;
      if (caster.kind === 'pact') { const [n, lv] = pactSlots(L); spellInfo.pact = { n, level: lv }; maxLevel = lv; }
      else { spellInfo.slots = caster.kind === 'half' ? FULL_SLOTS[Math.ceil(L / 2) - 1] : FULL_SLOTS[L - 1]; maxLevel = spellInfo.slots.length; }
      const always = new Set();
      if (sub && sub.spells) for (const [lv, list] of Object.entries(sub.spells)) if (L >= Number(lv)) list.forEach((s) => always.add(s));
      if (b.class === 'paladin' && L >= 2) always.add('divine-smite');
      if (b.class === 'ranger') always.add('hunters-mark');
      spellInfo.always = [...always];
      const nCantrips = caster.cantrips(L) + ((b.class === 'cleric' && order === 'thaumaturge') || (b.class === 'druid' && primal === 'magician') ? 1 : 0);
      const listFor = b.class === 'bard' && L >= 10 ? ['bard', 'cleric', 'druid', 'wizard'] : [b.class];
      const onList = (s) => s.classes.some((c) => listFor.includes(c));
      if (nCantrips) spellInfo.cantrips = need({ key: 'cantrips', label: 'Cantrips', count: nCantrips, step: 'spells', custom: true, options: SPELL_LIST.filter((s) => s.level === 0 && onList(s)).map(spellOpt), rec: cls.rec.cantrips });
      const nPrep = caster.prepared[L - 1];
      spellInfo.prepared = need({ key: 'spells', label: `Prepared spells (up to level ${maxLevel})`, count: nPrep, step: 'spells', custom: true, maxLevel,
        options: SPELL_LIST.filter((s) => s.level >= 1 && s.level <= maxLevel && onList(s) && !always.has(s.id)).map(spellOpt), rec: cls.rec.spells });
    }
    for (const f of feats) if (f.id === 'magic-initiate') spellInfo.extra.push(...picks(f.key + ':cantrips'), ...picks(f.key + ':spell').map((id) => id + '*'));
    if (lineage && lineage.cantrip) spellInfo.extra.push(lineage.cantrip);

    // ---- gear and attacks ----
    const g = b.gear;
    const armor = g.armor ? ARMOR[g.armor] : null;
    if (g.armor && !armor) err('gear', 'Unknown armor.');
    if (armor && !armorTr.has(armor.type)) warnings.push({ step: 'gear', msg: `No ${armor.type} armor training: disadvantage on STR/DEX rolls and no spellcasting while wearing ${armor.name}.` });
    if (g.shield && !armorTr.has('shield')) warnings.push({ step: 'gear', msg: 'No shield training: the shield\'s AC doesn\'t count.' });
    const weapons = (g.weapons || []).filter((id) => WEAPONS[id]);
    if ((g.weapons || []).length !== weapons.length) err('gear', 'Unknown weapon in the list.');
    const strShort = armor && armor.str && score.str < armor.str;
    if (strShort) warnings.push({ step: 'gear', msg: `${armor.name} needs STR ${armor.str}: speed -10 ft.` });

    const profWith = (w) => weaponTr.has(w.cat) || (w.cat === 'martial' && ((weaponTr.has('martial-light') && w.props.includes('light')) || (weaponTr.has('martial-finesse-light') && (w.props.includes('light') || w.props.includes('finesse')))));
    const hbAtk = (scope) => hbEffects.filter((e) => e.kind === 'attack' && hbScope(e.scope, scope)).reduce((t, e) => t + (Number(e.value) || 1), 0);
    const hbDmg = (scope) => hbEffects.filter((e) => e.kind === 'damage' && hbScope(e.scope, scope)).reduce((t, e) => t + (Number(e.value) || 1), 0);
    const hbDice = (scope) => hbEffects.filter((e) => e.kind === 'damage-dice' && hbScope(e.scope, scope)).map((e) => e.dice || '1d4');
    function hbScope(es, tags) { return !es || es === 'all' || tags.includes(es); }
    const crit = sub && sub.crit ? sub.crit(L) : hbEffects.some((e) => e.kind === 'crit-range') ? 19 : null;
    const attacks = [];
    const pactBlade = picks('invocations').includes('pact-of-the-blade');
    const fmt = (dice, n) => (n ? `${dice}${n > 0 ? '+' : ''}${n}` : dice);
    for (const id of weapons) {
      const w = WEAPONS[id];
      const ranged = isRangedWeapon(w), finesse = w.props.includes('finesse');
      const monkW = b.class === 'monk' && (w.cat === 'simple' || (w.cat === 'martial' && w.props.includes('light'))) && !w.props.includes('heavy');
      let ab = finesse || monkW ? (m.dex > m.str ? 'dex' : 'str') : ranged ? 'dex' : 'str';
      if (pactBlade && !ranged && m.cha > m[ab]) ab = 'cha';
      const prof = profWith(w);
      const make = (label, opt) => {
        const tags = ['weapon', opt.ranged ? 'ranged' : 'melee', opt.thrown ? 'thrown' : '', w.props.includes('heavy') ? 'heavy' : ''].filter(Boolean);
        let toHit = m[ab] + (prof ? pb : 0) + (opt.ranged && !opt.thrown && styles.has('archery') ? 2 : 0) + hbAtk(tags);
        let dmg = m[ab] + hbDmg(tags);
        if (!opt.ranged && !opt.twoHands && !w.props.includes('two-handed') && styles.has('dueling')) dmg += 2;
        if (opt.thrown && styles.has('thrown-weapon-fighting')) dmg += 2;
        let die = opt.twoHands ? w.versatile : w.dmg;
        if (monkW && !opt.ranged && avgDie(`1d${martialDie(L)}`) > avgDie(die)) die = `1d${martialDie(L)}`;
        const extraDice = hbDice(tags);
        const a = { name: label, bonus: toHit, damage: fmt(die, dmg) + extraDice.map((d) => '+' + d).join(''), type: w.type };
        if (opt.range) a.range = opt.range; else a.reach = w.props.includes('reach') ? 10 : 5;
        if (finesse) a.finesse = true;
        if (crit) a.critRange = crit;
        if (!prof) a.note = 'not proficient';
        attacks.push(a);
      };
      if (ranged) make(w.name, { ranged: true, range: w.range });
      else {
        make(w.name, {});
        if (w.versatile && !g.shield && weapons.filter((x) => !isRangedWeapon(WEAPONS[x])).length === 1) make(`${w.name} (two hands)`, { twoHands: true });
        if (w.props.includes('thrown')) make(`${w.name} (thrown)`, { ranged: true, thrown: true, range: w.range });
      }
      if (w.props.includes('heavy') && size === 'small') warnings.push({ step: 'gear', msg: `${w.name} is heavy: a Small character attacks with it at disadvantage.` });
      if (w.props.includes('two-handed') && g.shield && !ranged) warnings.push({ step: 'gear', msg: `${w.name} needs two hands; you'd have to put the shield away.` });
    }
    if (b.class === 'monk' || styles.has('unarmed-fighting') || feats.some((f) => f.id === 'tavern-brawler')) {
      const ab = b.class === 'monk' && m.dex > m.str ? 'dex' : 'str';
      const die = b.class === 'monk' ? `1d${martialDie(L)}` : styles.has('unarmed-fighting') ? '1d6' : '1d4';
      attacks.push({ name: 'Unarmed Strike', bonus: m[ab] + pb + hbAtk(['unarmed', 'melee']), damage: fmt(die, m[ab] + hbDmg(['unarmed', 'melee'])), type: 'bludgeoning', reach: 5 });
    }
    // Spell attacks the engine can roll; save spells become notes with the exact command.
    const spellNotes = [];
    const allSpells = [...new Set([...spellInfo.cantrips, ...spellInfo.always, ...spellInfo.prepared, ...spellInfo.extra.map((x) => x.replace(/\*$/, ''))])];
    const castMod = caster ? m[caster.abil] : Math.max(m.int, m.wis, m.cha);
    const castAtk = pb + castMod + hbAtk(['spell']);
    const castDc = 8 + pb + castMod;
    const cantripN = 1 + (L >= 5) + (L >= 11) + (L >= 17);
    for (const id of allSpells) {
      const s = SPELLS[id];
      if (!s || !s.mech) continue;
      const mc = s.mech;
      const dice = (d) => (s.level === 0 && mc.scale ? d.replace(/^(\d+)d/, (x, n) => `${Number(n) * cantripN}d`) : d);
      if (mc.atk) {
        let dmg = dice(mc.atk);
        let extra = mc.mod ? castMod : 0;
        if (id === 'eldritch-blast' && picks('invocations').includes('agonizing-blast')) extra += m.cha;
        const a = { name: s.name + (mc.beams && cantripN > 1 ? ` (${cantripN} beams)` : ''), bonus: castAtk, damage: fmt(dmg, extra), type: mc.type, spell: true };
        if (mc.range) a.range = [mc.range, mc.range]; else a.reach = mc.reach || 5;
        if (mc.bonus) a.bonusAction = true;
        attacks.push(a);
      } else if (mc.save) spellNotes.push(`${s.name}: damage <id> ${dice(mc.dmg)} ${mc.type} --save ${mc.save} --dc ${castDc}${mc.half ? ' --half' : ''}`);
      else if (mc.heal) spellNotes.push(`${s.name}: heal <id> ${mc.heal}+${castMod}${sub && b.subclass === 'life' ? ` (+${2 + s.level} Disciple of Life)` : ''}`);
    }

    // ---- AC ----
    const dexCap = armor ? (armor.type === 'light' ? 99 : armor.type === 'medium' ? (feats.some((f) => f.id === 'medium-armor-master') ? 3 : 2) : 0) : 99;
    const shieldAc = g.shield && armorTr.has('shield') && !(b.class === 'monk' && !armor) ? 2 : 0;
    const acOpts = [];
    if (armor) acOpts.push({ v: armor.base + Math.min(m.dex, dexCap), why: armor.name });
    else {
      acOpts.push({ v: 10 + m.dex, why: 'no armor' });
      const un = [...((cls && cls.unarmored) || []), ...((sub && sub.unarmored) || [])];
      for (const a of un) acOpts.push({ v: 10 + m.dex + m[a], why: `Unarmored Defense (DEX + ${a.toUpperCase()})` });
    }
    const bestAc = acOpts.sort((x, y) => y.v - x.v)[0];
    let ac = bestAc.v + (b.class === 'monk' && g.shield ? 0 : shieldAc);
    const acWhy = [bestAc.why];
    if (shieldAc && !(b.class === 'monk')) acWhy.push('shield');
    if (armor && styles.has('defense')) { ac += 1; acWhy.push('Defense'); }
    const hbAc = hbEffects.filter((e) => e.kind === 'ac').reduce((t, e) => t + (Number(e.value) || 1), 0);
    if (hbAc) { ac += hbAc; acWhy.push('homebrew'); }

    // ---- HP ----
    const hd = cls ? cls.hd : 8;
    const avg = hd / 2 + 1;
    const rolled = b.hp && b.hp.method === 'rolled' ? b.hp.rolls || {} : {};
    let hp = 0;
    const hpParts = [];
    for (let lv = 1; lv <= L; lv++) {
      const die = lv === 1 ? hd : rolled[lv] !== undefined ? Number(rolled[lv]) : avg;
      hp += Math.max(1, die + m.con);
    }
    if (b.hp && b.hp.method === 'rolled') { const missing = []; for (let lv = 2; lv <= L; lv++) if (rolled[lv] === undefined) missing.push(lv); if (missing.length) todo.push({ step: 'finish', msg: `Roll hit points for level${missing.length > 1 ? 's' : ''} ${missing.join(', ')}.` }); }
    hpParts.push(`d${hd}${b.hp && b.hp.method === 'rolled' ? ' rolled' : ' average'} + CON`);
    let perLevel = (sp && sp.hpPerLevel) || 0;
    if (perLevel) hpParts.push(`${sp.name} +${perLevel}/level`);
    if (sub && sub.hpPerLevel) { perLevel += sub.hpPerLevel; hpParts.push(`${sub.name} +${sub.hpPerLevel}/level`); }
    if (feats.some((f) => f.id === 'tough')) { perLevel += 2; hpParts.push('Tough +2/level'); }
    const hbPer = hbEffects.filter((e) => e.kind === 'hp-per-level').reduce((t, e) => t + (Number(e.value) || 1), 0);
    const hbFlat = hbEffects.filter((e) => e.kind === 'hp').reduce((t, e) => t + (Number(e.value) || 0), 0);
    if (hbPer || hbFlat) hpParts.push('homebrew');
    hp += (perLevel + hbPer) * L + hbFlat;

    // ---- speed, initiative, senses, resistances ----
    let speed = (lineage && lineage.speed) || (sp ? sp.speed : 30);
    if (b.class === 'barbarian' && L >= 5 && !(armor && armor.type === 'heavy')) speed += 10;
    if (b.class === 'monk' && !armor && !g.shield) speed += unarmoredMove(L);
    if (b.class === 'ranger' && L >= 6 && !(armor && armor.type === 'heavy')) speed += 10;
    if (feats.some((f) => f.id === 'speedy')) speed += 10;
    speed += hbEffects.filter((e) => e.kind === 'speed').reduce((t, e) => t + (Number(e.value) || 5), 0);
    if (strShort) speed -= 10;
    let init = m.dex + (feats.some((f) => f.id === 'alert') ? pb : 0) + hbEffects.filter((e) => e.kind === 'initiative').reduce((t, e) => t + (Number(e.value) || 1), 0)
      + (hbEffects.some((e) => e.kind === 'initiative-prof') && !feats.some((f) => f.id === 'alert') ? pb : 0);
    const darkvision = Math.max((lineage && lineage.darkvision) || (sp && sp.darkvision) || 0, ...hbEffects.filter((e) => e.kind === 'darkvision').map((e) => Number(e.value) || 60));
    const resist = new Set([...((sp && sp.resist) || []), ...(lineage && lineage.resist ? [lineage.resist] : [])]);
    if (b.species === 'dragonborn') { const t = ((needs.find((n) => n.key === 'ancestry') || {}).options || []).find((o) => o.id === picks('ancestry')[0]); if (t) resist.add(t.type); }
    hbEffects.filter((e) => e.kind === 'resistance').forEach((e) => e.type && resist.add(e.type));
    const immune = hbEffects.filter((e) => e.kind === 'immunity' && e.type).map((e) => e.type);

    // ---- saves & skills ----
    const auraBonus = b.class === 'paladin' && L >= 6 ? Math.max(1, m.cha) : 0;
    const hbSave = (a) => hbEffects.filter((e) => e.kind === 'save-bonus' && (!e.ability || e.ability === 'all' || e.ability === a)).reduce((t, e) => t + (Number(e.value) || 1), 0);
    const saves = {}, allSaves = {};
    for (const a of ABIL) { allSaves[a] = m[a] + (saveProf.has(a) ? pb : 0) + auraBonus + hbSave(a); if (saveProf.has(a) || auraBonus || hbSave(a)) saves[a] = allSaves[a]; }
    const joat = b.class === 'bard' && L >= 2;
    const skillTotals = {}, allSkills = {};
    for (const s of ALL_SKILLS) {
      const p = expertise.has(s) ? 2 * pb : skills.has(s) ? pb : joat ? Math.floor(pb / 2) : 0;
      allSkills[s] = m[SKILLS[s]] + p;
      if (skills.has(s) || joat) skillTotals[s] = allSkills[s];
    }

    // ---- features, resources, notes ----
    const ctx = { L, pb, m, b, picks: b.picks, res: {} };
    const res = {};
    if (cls) Object.assign(res, cls.res(L, m, pb));
    if (sub && sub.res) Object.assign(res, sub.res(L, m, pb));
    if (sp && sp.res) Object.assign(res, sp.res(L, m, pb));
    for (const f of feats) if (FEATS[f.id] && FEATS[f.id].res) Object.assign(res, FEATS[f.id].res(pb));
    if (spellInfo.slots.length) spellInfo.slots.forEach((n, i) => { res['slots' + (i + 1)] = n; });
    if (spellInfo.pact) res.pactSlots = spellInfo.pact.n;
    for (const k of Object.keys(res)) if (!res[k]) delete res[k];
    ctx.res = res;
    const features = [];
    const addF = (src, list) => { for (const [lv, name, d] of list) if (lv <= L) features.push({ name, src, level: lv, desc: typeof d === 'function' ? d(ctx) : d }); };
    if (sp) for (const [name, desc] of sp.traits || []) features.push({ name, src: sp.name, level: 1, desc });
    if (cls) addF(cls.name, cls.features);
    if (sub) addF(sub.name, sub.features);
    for (const f of feats) features.push(f.hb ? { name: f.hb.name, src: `${f.src} feat (homebrew)`, level: 1, desc: f.hb.text || '' } : { name: FEATS[f.id].name, src: `${f.src} feat`, level: 1, desc: FEATS[f.id].desc });
    for (const id of styleIds.filter((x) => FIGHTING_STYLES[x])) features.push({ name: FIGHTING_STYLES[id].name, src: 'Fighting style', level: 1, desc: FIGHTING_STYLES[id].desc });
    for (const h of activeHb()) if (!['origin-feat', 'feat', 'fighting-style'].includes(h.slot) || styleIds.includes('hb:' + h.id)) {
      if (h.slot === 'species' && b.species !== 'hb:' + h.id) continue;
      features.push({ name: h.name, src: `Homebrew (${(Power.SLOTS[h.slot] || Power.SLOTS.other).label.toLowerCase()})`, level: 1, desc: h.text || hbEffectsText(h) });
    }

    const subName = sub ? ` (${sub.name})` : '';
    const header = `${sp ? sp.name : 'Unknown'} ${cls ? cls.name : 'Adventurer'} ${L}${subName}.`;
    const noteParts = [header];
    if (darkvision) noteParts.push(`Darkvision ${darkvision} ft.`);
    for (const f of features) if (!NOTE_SKIP.test(f.name)) noteParts.push(`${f.name}: ${f.desc}`);
    if (caster || spellInfo.extra.length) {
      const names = (ids) => ids.map((id) => (SPELLS[id] ? SPELLS[id].name : String(id).replace(/^custom:/, ''))).join(', ');
      if (caster) noteParts.push(`Spells (${caster.abil.toUpperCase()}, save DC ${castDc}, attack ${sign(castAtk)}): cantrips ${names(spellInfo.cantrips) || 'none'}; prepared ${names(spellInfo.prepared) || 'none'}${spellInfo.always.length ? '; always prepared ' + names(spellInfo.always) : ''}.`);
      if (spellInfo.extra.length) noteParts.push(`Extra spells: ${spellInfo.extra.map((x) => (SPELLS[x.replace(/\*$/, '')] || { name: x }).name + (x.endsWith('*') ? ' (1/long rest)' : '')).join(', ')}.`);
    }
    if (spellNotes.length) noteParts.push(spellNotes.join('. ') + '.');
    for (const e of hbEffects.filter((x) => !['ability', 'skill', 'expertise', 'save', 'ac', 'hp-per-level', 'hp', 'resistance', 'speed', 'attack', 'damage', 'damage-dice', 'initiative', 'initiative-prof', 'darkvision', 'armor-training', 'weapon-training', 'save-bonus', 'crit-range'].includes(x.kind))) noteParts.push(`${e.from}: ${Power.describe(e)}.`);

    // Engine-facing feature strings (core.featuresOf reads Sneak Attack and Cunning Action from these).
    const engineFeatures = features.filter((f) => /Sneak Attack|Cunning Action|Rage|Extra Attack|Action Surge|Second Wind/.test(f.name)).map((f) => (f.name === 'Sneak Attack' ? `Sneak Attack +${Math.ceil(L / 2)}d6` : f.name));
    let attacksPerAction = cls ? (cls.attacks ? cls.attacks(L) : cls.extra && L >= cls.extra ? 2 : 1) : 1;
    if (sub && sub.extra && L >= sub.extra) attacksPerAction = Math.max(attacksPerAction, 2);
    if (picks('invocations').includes('thirsting-blade') && pactBlade) attacksPerAction = Math.max(attacksPerAction, 2);
    attacksPerAction += hbEffects.filter((e) => e.kind === 'extra-attack').length;

    const creature = {
      name: b.name || 'Unnamed', side: 'party', controller: 'player', size,
      hp, ac, speed, initBonus: init, stats: score, saves, skills: skillTotals,
      attacks: attacks.map(({ note, ...a }) => a), resources: res, features: engineFeatures,
      notes: noteParts.join(' '), persona: [b.details.persona, b.details.appearance].filter(Boolean).join(' ') || undefined,
    };
    if (attacksPerAction > 1) creature.attacksPerAction = attacksPerAction;
    if (resist.size) creature.resist = [...resist];
    if (immune.length) creature.immune = immune;
    if (b.details.color) creature.color = b.details.color;
    // Armor that hampers Stealth is loud: NPC minds hear these footsteps from twice as far.
    if (armor && armor.stealth) creature.noisy = true;

    // ---- the review step ----
    if (!b.name || !String(b.name).trim()) todo.push({ step: 'concept', msg: 'Give your character a name.' });
    for (const x of hbs) if (x.h.status === 'draft' && (x.h.effects || []).length) warnings.push({ step: 'homebrew', msg: `Homebrew "${x.h.name || 'untitled'}" is a draft: use it or send it to the DM.` });
    const steps = {};
    for (const s of STEPS) steps[s.id] = 'ok';
    for (const t of todo) if (steps[t.step] === 'ok') steps[t.step] = 'todo';
    for (const e of errors) steps[e.step] = 'error';
    for (const d of dm) if (steps[d.step] === 'ok') steps[d.step] = 'dm';
    const status = errors.length || todo.length ? 'incomplete' : dm.length ? 'needs-dm' : 'ready';

    return {
      level: L, pb, status, errors, todo, warnings, dm, needs, steps,
      homebrew: hbs.map((x) => ({ id: x.h.id, rating: x.rating, active: x.active, poolBlocked: !!x.poolBlocked })), pool,
      sheet: {
        name: b.name, line: `${sp ? sp.name : '—'} ${cls ? cls.name : '—'} ${L}${subName}`, size, abilities: Object.fromEntries(ABIL.map((a) => [a, { score: score[a], mod: m[a], save: allSaves[a], prof: saveProf.has(a) }])),
        ac, acWhy: acWhy.join(' + '), hp, hpWhy: hpParts.join(', '), speed, init, pb, darkvision, resist: [...resist], immune,
        skills: ALL_SKILLS.map((s) => ({ id: s, name: skillName(s), abil: SKILLS[s], bonus: allSkills[s], prof: skills.has(s), exp: expertise.has(s) })),
        passive: 10 + allSkills.perception, attacks, features, resources: res,
        spells: caster || spellInfo.extra.length ? Object.assign({}, spellInfo, { dc: castDc, atk: castAtk }) : null,
        armorTraining: [...armorTr], weaponTraining: [...weaponTr].map((w) => w.replace('martial-finesse-light', 'martial (finesse or light)').replace('martial-light', 'martial (light)')),
      },
      creature,
    };
  }
  // Features that only matter while building (they're already counted in the numbers) stay out of the notes.
  const NOTE_SKIP = /^(Spellcasting|Weapon Mastery|Thieves' Cant|Druidic|Trance|Expertise|Skillful|Versatile|Keen Senses|Elven Lineage|Gnomish Lineage|Draconic Ancestry|Fiendish Legacy|Giant Ancestry|Student of War|Bonus Proficiencies|Scholar|Ability Score Improvement|Evocation Savant|Ritual Adept|Primal Knowledge|Deft Explorer|Fighting Style|Magic Initiate|Skilled|Dwarven Toughness|Light Bearer|Otherworldly Presence)$/;
  const avgDie = (d) => Power.avgDice(d);
  function spellOpt(s) { return { id: s.id, name: s.name, desc: s.desc, level: s.level }; }
  function hbEffectsText(h) { return (h.effects || []).map((e) => Power.describe(e)).join('; '); }

  const STEPS = [
    { id: 'concept', name: 'Concept' }, { id: 'species', name: 'Species' }, { id: 'class', name: 'Class' },
    { id: 'background', name: 'Background' }, { id: 'abilities', name: 'Abilities' }, { id: 'feats', name: 'Feats' },
    { id: 'spells', name: 'Spells' }, { id: 'gear', name: 'Gear' }, { id: 'homebrew', name: 'Homebrew' }, { id: 'finish', name: 'Finish' },
  ];

  // Fill every unmade choice with a sensible default, without touching anything already chosen.
  function recommend(input, opts = {}) {
    const b = Object.assign(blank(), clone(input || {}));
    const cls = CLASSES[b.class];
    if (cls) {
      if (!b.background) b.background = cls.rec.bg;
      const bg = BACKGROUNDS[b.background];
      if (bg && !Object.values(b.bgBonus || {}).some(Number)) {
        const pool = bg.custom ? ABIL : bg.abil;
        const ranked = cls.rec.abil.filter((a) => pool.includes(a));
        b.bgBonus = { [ranked[0]]: 2, [ranked[1]]: 1 };
      }
      const base = b.abilities.base || {};
      if (!ABIL.some((a) => Number.isInteger(base[a]))) {
        b.abilities.method = b.abilities.method === 'rolled' && (b.abilities.rolls || []).length === 6 ? 'rolled' : 'standard';
        const vals = b.abilities.method === 'rolled' ? b.abilities.rolls.map((r) => (typeof r === 'number' ? r : r.total)).sort((x, y) => y - x) : STANDARD_ARRAY;
        b.abilities.base = {};
        cls.rec.abil.forEach((a, i) => { b.abilities.base[a] = vals[i]; });
      }
      if (!b.subclass && b.level >= 3) b.subclass = Object.keys(cls.subclasses)[0];
      if (!b.gear || (!b.gear.armor && !(b.gear.weapons || []).length && !b.gear.shield)) b.gear = Object.assign({ items: [] }, clone(cls.rec.gear));
      if (b.class === 'cleric' && b.gear.armor === 'chain-mail' && (b.picks['divine-order'] || [])[0] === 'thaumaturge') b.gear.armor = 'scale-mail';
    }
    for (let pass = 0; pass < 6; pass++) {
      const d = derive(b, opts);
      let changed = false;
      for (const n of d.needs) {
        const have = (b.picks[n.key] || []).filter((id) => n.options.some((o) => o.id === id) || String(id).startsWith('custom:'));
        if (have.length >= n.count) continue;
        const order = [...(n.rec || []), ...n.options.map((o) => o.id)];
        for (const id of order) {
          if (have.length >= n.count) break;
          if (!n.options.some((o) => o.id === id && !o.homebrew)) continue;
          if (!n.dup && have.includes(id)) continue;
          have.push(id);
          if (n.dup && have.length < n.count && n.key.endsWith(':asi')) have.push(id);
        }
        b.picks[n.key] = have.slice(0, n.count);
        changed = true;
      }
      if (!changed) break;
    }
    return b;
  }

  // Apply a DM suggestion's patch ({ "path.to.field": value }) to a build. Homebrew entries are
  // addressed by id ("homebrew.hb3.effects"), picks by key ("picks.feat-4").
  function applyPatch(build, patch) {
    const b = clone(build);
    for (const [path, value] of Object.entries(patch || {})) {
      const parts = String(path).split('.');
      let o = b;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (Array.isArray(o)) {
          let el = o.find((x) => x && x.id === k);
          if (!el) { el = { id: k }; o.push(el); }
          o = el;
        } else {
          if (o[k] === undefined || o[k] === null || typeof o[k] !== 'object') o[k] = k === 'homebrew' ? [] : {};
          o = o[k];
        }
      }
      const last = parts[parts.length - 1];
      if (Array.isArray(o)) {
        const i = o.findIndex((x) => x && x.id === last);
        if (value === null) { if (i >= 0) o.splice(i, 1); } else if (i >= 0) o[i] = Object.assign({ id: last }, value); else o.push(Object.assign({ id: last }, value));
      } else if (value === null) delete o[last];
      else o[last] = value;
    }
    return b;
  }

  function summary(build) {
    const sp = SPECIES[build.species] || (String(build.species || '').startsWith('hb:') ? { name: ((build.homebrew || []).find((h) => 'hb:' + h.id === build.species) || {}).name || 'Homebrew' } : null);
    const cls = CLASSES[build.class];
    const sub = cls && cls.subclasses[build.subclass];
    return `${sp ? sp.name + ' ' : ''}${cls ? cls.name : 'New character'} ${build.level || 3}${sub && build.level >= 3 ? ` (${sub.name})` : ''}`;
  }

  return {
    ABIL, ABIL_NAME, SKILLS, ALL_SKILLS, skillName, title, mod, sign, profBonus, STANDARD_ARRAY, POINT_COST, POINTS,
    WEAPONS, ARMOR, SPELLS, SPELL_LIST, CLASSES, SPECIES, BACKGROUNDS, FEATS, FIGHTING_STYLES, MANEUVERS, INVOCATIONS, METAMAGIC,
    STEPS, blank, derive, recommend, applyPatch, summary, hbSig,
  };
});
