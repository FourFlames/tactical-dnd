// Example library command. This is the format approved commands use.
// Usage: node engine.js shove <attacker> <target> [--prone]
'use strict';

module.exports = {
  usage: 'shove <attacker> <target> [--prone]',
  description: 'Contested Athletics vs the target\'s best of Athletics/Acrobatics. Success pushes the target 5 ft directly away (or knocks it prone with --prone). Pushed off a ledge, it falls (1d6 per 10 ft); walls and higher ledges stop it; chasms are left to the DM.',
  origin: 'Shipped with the starter kit as the reference example.',
  run(s, { pos, flags }, api) {
    const { C, who, fail, abilityBonus, addCond, sign, fallOn } = api;
    const a = who(pos[0]), t = who(pos[1]);
    const ap = C.at(s, a), tp = C.at(s, t);
    if (C.distFeet(ap, tp) > 5) fail(`${t.name} must be within 5 ft to shove.`);

    const atk = abilityBonus(a, 'athletics').bonus;
    const def = Math.max(abilityBonus(t, 'athletics').bonus, abilityBonus(t, 'acrobatics').bonus);
    const ra = C.d20(), rt = C.d20();
    const won = ra.nat + atk > rt.nat + def;
    let text = `${a.name} shoves ${t.name}: ${ra.detail}${sign(atk)} = ${ra.nat + atk} vs ${rt.detail}${sign(def)} = ${rt.nat + def} → `;

    if (!won) text += 'resisted.';
    else if (flags.prone) { addCond(t, 'prone'); text += `${t.name} is knocked prone.`; }
    else {
      const dx = Math.sign(tp.x - ap.x), dy = Math.sign(tp.y - ap.y);
      const nx = tp.x + dx, ny = tp.y + dy;
      const dest = C.cellId(nx, ny);
      const onMap = C.inBounds(s, nx, ny);
      const tags = onMap ? C.tagsAt(s, nx, ny) : ['wall'];
      const wallInWay = onMap && C.blocksMove(C.wallBetween(s, tp, { x: nx, y: ny }));
      const drop = onMap ? tp.z - C.elevAt(s, nx, ny) : 0;
      if (tags.includes('wall') || wallInWay) text += `${t.name} slams into the ${!onMap ? 'edge of the map' : wallInWay ? 'wall' : C.terrainName(s, nx, ny)} and doesn't budge.`;
      else if (drop <= -5) text += `${t.name} is driven back against the ledge at ${dest} and doesn't budge.`;
      else if (C.occupant(s, nx, ny, pos[1])) text += `${t.name} is pushed back but ${s.creatures[C.occupant(s, nx, ny, pos[1])].name} is in the way.`;
      else if (tags.includes('chasm') || tags.includes('impassable')) {
        text += `${t.name} is shoved toward ${dest} (${C.terrainName(s, nx, ny)})! DM: rule on it, e.g. DEX save DC 10 to catch the edge, otherwise "remove ${pos[1]}".`;
      } else if (drop >= 5) {
        text += `${t.name} is shoved off the ledge! ` + fallOn(pos[1], drop, dest);
      } else {
        t.pos = dest;
        text += `${t.name} is pushed to ${dest}${tags.length ? ` [${tags.join(', ')}]` : ''}.`;
      }
    }
    C.appendLog(s, 'action', text);
    console.log(text);
    return s;
  },
};
