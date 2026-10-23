// Small, reusable low-poly furnishings. Visuals only: the engine owns all footprints and rules.
import * as THREE from 'three';

const materials = new Map();
function material(color, dim) {
  const key = `${color}:${dim}`;
  if (!materials.has(key)) {
    const c = new THREE.Color(color);
    if (dim) c.multiplyScalar(0.38);
    materials.set(key, new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true }));
  }
  return materials.get(key);
}

export function buildBarracksProp(o, ctx) {
  const { x, y, top, dim, variant, add, geo, terrainName = '', addFire } = ctx;
  const kinds = ['bunk', 'chest', 'table', 'desk', 'shelf', 'rack', 'hearth', 'sacks', 'dummy', 'hay', 'well'];
  // Existing encounters keep their clustered barrels; named barracks stores get individual vessels.
  const storeBarrel = o.kind === 'barrel' && /water barrel|apple barrel|ale cask/i.test(terrainName);
  if (!kinds.includes(o.kind) && !storeBarrel) return false;
  const H = o.height / 5, at = { x, y };
  const wood = '#695440', edge = '#493d31', iron = '#44484a', straw = '#b29a64';
  const cloth = ['#677363', '#7b7162', '#62747b', '#80735b'][variant % 4];
  function mesh(g, color, px, py, pz) {
    const m = add(new THREE.Mesh(geo(g), material(color, dim)), at);
    m.position.set(x + 0.5 + px, top + py, y + 0.5 + pz);
    return m;
  }
  const block = (w, h, d, color, px = 0, py = h / 2, pz = 0) => mesh(new THREE.BoxGeometry(w, h, d), color, px, py, pz);
  const cyl = (rt, rb, h, color, px = 0, py = h / 2, pz = 0, sides = 8) => mesh(new THREE.CylinderGeometry(rt, rb, h, sides), color, px, py, pz);
  function blob(radius, color, px, py, pz, scale = [1, 1, 1]) {
    const m = mesh(new THREE.IcosahedronGeometry(radius, 0), color, px, py, pz);
    m.scale.set(...scale); return m;
  }
  function bowl(px, py, pz) {
    cyl(0.067, 0.043, 0.045, '#aa9471', px, py, pz);
    cyl(0.054, 0.054, 0.004, '#55432e', px, py + 0.024, pz);
  }
  function legs(height, width = 0.64, depth = 0.56) {
    for (const a of [-1, 1]) for (const b of [-1, 1]) block(0.065, height, 0.065, edge, a * width / 2, height / 2, b * depth / 2);
  }
  function bindings(py, width = 0.8, depth = 0.64) {
    for (const a of [-1, 1]) block(0.05, 0.028, depth + 0.02, iron, a * width * 0.32, py);
  }

  switch (o.kind) {
    case 'bunk': {
      for (const a of [-1, 1]) for (const b of [-1, 1]) block(0.065, H, 0.065, edge, a * 0.32, H / 2, b * 0.4);
      for (const level of [H * 0.22, H * 0.77]) {
        block(0.7, 0.07, 0.88, wood, 0, level);
        block(0.61, 0.085, 0.77, straw, 0, level + 0.07);
        block(0.62, 0.035, 0.5, cloth, 0, level + 0.13, 0.12);
        block(0.025, 0.13, 0.5, cloth, 0.3, level + 0.08, 0.12);
        block(0.26, 0.055, 0.16, '#bcb39a', -0.05, level + 0.125, -0.27);
        block(0.12, 0.006, 0.1, '#9a927c', 0.12, level + 0.15, 0.24);
      }
      for (let i = 0; i < 4; i++) block(0.2, 0.035, 0.035, wood, 0.22, 0.16 + i * H * 0.18, 0.44);
      break;
    }
    case 'chest': {
      block(0.78, H * 0.75, 0.6, wood, 0, H * 0.375);
      block(0.81, H * 0.2, 0.64, '#80694e', 0, H * 0.85);
      bindings(H * 0.96);
      for (const a of [-1, 1]) block(0.045, H * 0.78, 0.012, iron, a * 0.25, H * 0.4, 0.31);
      block(0.085, 0.095, 0.025, iron, 0, H * 0.72, 0.325);
      // A few lid scars, without readable initials or hidden inventory clues.
      for (let i = 0; i < 3; i++) block(0.12, 0.004, 0.008, edge, -0.11 + i * 0.04, H * 0.952, -0.12 + i * 0.06).rotation.y = 0.4;
      break;
    }
    case 'table':
    case 'desk': {
      const desk = o.kind === 'desk';
      legs(H - 0.08);
      block(0.88, 0.08, desk ? 0.72 : 0.58, wood, 0, H - 0.04);
      for (let i = 0; i < 3; i++) block(0.82, 0.004, 0.008, edge, 0, H + 0.002, -0.2 + i * 0.18);
      if (desk) {
        block(0.44, 0.009, 0.32, '#c1b28c', -0.06, H + 0.01, 0.01).rotation.y = -0.12;
        for (let i = 0; i < 3; i++) block(0.25, 0.003, 0.007, '#8c8568', -0.06, H + 0.017, -0.08 + i * 0.065).rotation.y = 0.3 * i;
        cyl(0.045, 0.05, 0.055, iron, 0.29, H + 0.028, -0.21);
        block(0.17, 0.025, 0.23, cloth, -0.29, H + 0.025, -0.17);
        block(0.035, 0.008, 0.17, iron, 0.24, H + 0.01, 0.16).rotation.y = 0.7;
      } else {
        for (const a of [-1, 1]) {
          block(0.88, 0.05, 0.12, '#786249', 0, H * 0.52, a * 0.4);
          for (const b of [-1, 1]) block(0.04, H * 0.5, 0.09, edge, b * 0.31, H * 0.25, a * 0.4);
          bowl(a * 0.26, H + 0.026, a * 0.12);
        }
        block(0.11, 0.02, 0.09, '#b2a17d', 0.12, H + 0.012, -0.04);
      }
      break;
    }
    case 'shelf': {
      for (const a of [-1, 1]) block(0.065, H, 0.43, edge, a * 0.39, H / 2, -0.17);
      block(0.84, H, 0.035, wood, 0, H / 2, -0.39);
      for (let i = 0; i < 3; i++) {
        const level = 0.14 + i * H * 0.3;
        block(0.8, 0.055, 0.45, wood, 0, level, -0.16);
        for (let j = 0; j < 3; j++) {
          const px = -0.25 + j * 0.24;
          if ((x + i) % 3 === 0) blob(0.105, '#ab8854', px, level + 0.1, -0.14, [1, 0.65, 0.75]);
          else if ((x + i) % 3 === 1) cyl(0.055, 0.08, 0.17, ['#8b7964', '#a29072', '#736f56'][j], px, level + 0.11, -0.14);
          else block(0.16, 0.12, 0.18, '#b7a382', px, level + 0.09, -0.15);
        }
      }
      break;
    }
    case 'rack': {
      const practice = /practice/i.test(terrainName);
      for (const a of [-1, 1]) { block(0.075, H, 0.075, edge, a * 0.36, H / 2); block(0.2, 0.065, 0.45, wood, a * 0.36, 0.035); }
      block(0.8, 0.09, 0.09, wood, 0, H * 0.72);
      for (let i = 0; i < 4; i++) {
        const px = -0.26 + i * 0.17, height = H * (i % 2 ? 0.82 : 0.94);
        const blade = block(0.045, height, 0.03, practice ? '#ab906a' : '#929999', px, height / 2, 0.07);
        blade.rotation.z = (i - 1.5) * 0.04;
        block(0.14, 0.027, 0.04, practice ? wood : iron, px, height * 0.25, 0.07);
      }
      cyl(0.18, 0.18, 0.045, practice ? cloth : '#6c7773', 0.22, 0.24, 0.19, 10).rotation.x = Math.PI / 2;
      break;
    }
    case 'hearth': {
      block(0.88, 0.1, 0.85, '#77786e', 0, 0.05);
      for (const a of [-1, 1]) block(0.17, H * 0.85, 0.7, '#808177', a * 0.35, H * 0.425, -0.06);
      block(0.9, 0.12, 0.78, '#96958a', 0, H * 0.91, -0.06);
      block(0.55, H * 0.73, 0.08, '#4f514a', 0, H * 0.4, -0.37);
      for (const a of [-1, 1]) block(0.35, 0.065, 0.08, edge, 0, 0.13, a * 0.1).rotation.y = a * 0.5;
      cyl(0.22, 0.16, 0.23, '#343837', 0, 0.39, 0);
      cyl(0.19, 0.19, 0.012, '#827044', 0, 0.51, 0);
      block(0.022, 0.3, 0.022, iron, 0, 0.68);
      bowl(-0.19, H * 0.99, 0.03); bowl(0.03, H * 0.99, 0.03);
      addFire(x + 0.5, top + 0.13, y + 0.6, 0.55, dim);
      break;
    }
    case 'sacks':
    case 'hay': {
      const hay = o.kind === 'hay';
      for (let i = 0; i < 3; i++) {
        const py = i === 2 ? H * 0.68 : H * 0.23, px = i === 2 ? 0.03 : (i - 0.5) * 0.38;
        if (hay) {
          block(0.38, H * 0.43, 0.62, straw, px, py);
          for (const a of [-1, 1]) block(0.39, 0.012, 0.025, edge, px, py + H * 0.22, a * 0.17);
        } else {
          blob(0.28, ['#b3a58a', '#9e957d', '#c0b396'][i], px, py, 0, [0.72, H * 0.9, 1]);
          cyl(0.055, 0.09, 0.07, edge, px, py + H * 0.19, 0);
        }
      }
      break;
    }
    case 'dummy': {
      block(0.09, H * 0.93, 0.09, edge, 0, H * 0.465);
      block(0.65, 0.07, 0.2, wood, 0, 0.04);
      block(0.63, 0.065, 0.065, wood, 0, H * 0.67);
      blob(0.26, '#a39166', 0, H * 0.59, 0, [0.85, 1.2, 0.65]);
      blob(0.145, '#b3a178', 0, H * 0.87, 0);
      for (const p of [-1, 1]) block(0.14, 0.02, 0.025, edge, p * 0.06, H * 0.63, 0.17).rotation.z = p * 0.45;
      block(0.12, 0.006, 0.14, cloth, 0.09, H * 0.51, 0.16).rotation.x = 0.2;
      break;
    }
    case 'well': {
      const radius = 0.34, rim = Math.min(H * 0.62, 0.4);
      for (let i = 0; i < 10; i++) {
        const a = i * Math.PI / 5;
        block(0.22, rim, 0.12, i % 2 ? '#898a7f' : '#777b73', Math.sin(a) * radius, rim / 2, Math.cos(a) * radius).rotation.y = a;
      }
      cyl(0.27, 0.27, 0.015, '#303e3e', 0, 0.055);
      for (const a of [-1, 1]) block(0.065, H, 0.07, edge, a * 0.37, H / 2);
      const axle = cyl(0.055, 0.055, 0.88, wood, 0, H * 0.85); axle.rotation.z = Math.PI / 2;
      block(0.018, H * 0.6, 0.018, '#a5936d', 0, H * 0.52);
      cyl(0.095, 0.075, 0.13, wood, 0.19, rim + 0.065, 0.2);
      break;
    }
    case 'barrel': {
      cyl(0.29, 0.26, H * 0.92, '#846b4e', 0, H * 0.46, 0, 10);
      for (const level of [0.13, 0.72]) cyl(0.297, 0.297, 0.045, iron, 0, H * level, 0, 10);
      const apples = /apple/i.test(terrainName), water = /water/i.test(terrainName);
      cyl(0.264, 0.264, 0.01, water ? '#4f6e70' : apples ? '#51442f' : '#9b805e', 0, H * 0.924);
      if (apples) for (let i = 0; i < 7; i++) blob(0.065, i % 2 ? '#9b5841' : '#a9a063', Math.sin(i * 2.4) * 0.17, H * 0.95, Math.cos(i * 2.4) * 0.17);
      else if (water) { block(0.025, 0.34, 0.025, '#a99b82', 0.24, H * 0.8, 0.08).rotation.z = -0.25; }
      else { block(0.06, 0.055, 0.13, edge, 0, H * 0.28, 0.31); for (let i = 0; i < 4; i++) block(0.012, 0.06, 0.004, '#b8ad8d', -0.09 + i * 0.035, H * 0.52, 0.29); }
      break;
    }
  }
  return true;
}
