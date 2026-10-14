// Props you can pick (Card 14c) and wall faces you can pick (Card 14d). The props' looks stay in the terrain build;
// this adds an invisible pick box per prop (from the view's `objects`), a gold outline for the hovered or selected one,
// and a gold frame on a selected face. Kept apart from map3d.js's terrain so merging terrain meshes doesn't touch it.
import * as THREE from 'three';

const FT = 1 / 5;
const GOLD = '#d8b45a';
const STEP = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

export function createProps3D(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1), edgeGeo = new THREE.EdgesGeometry(boxGeo);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });   // never drawn, still raycast
  const lineMat = new THREE.LineBasicMaterial({ color: GOLD, transparent: true, depthTest: false });
  const hoverMat = new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.5, depthTest: false });
  const outline = new THREE.LineSegments(edgeGeo, lineMat), hoverLine = new THREE.LineSegments(edgeGeo, hoverMat);
  outline.renderOrder = hoverLine.renderOrder = 10;
  outline.visible = hoverLine.visible = false;
  const faceGeo = new THREE.PlaneGeometry(1, 1);
  const face = new THREE.Group();
  face.add(new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })),
    new THREE.LineSegments(new THREE.EdgesGeometry(faceGeo), new THREE.LineBasicMaterial({ color: GOLD })));
  face.visible = false;
  scene.add(outline, hoverLine, face);
  const boxes = new Map();   // id -> pick mesh
  let sig = '';

  function sync(v, floorFt) {
    const list = v.objects || [], s = JSON.stringify(list.map((o) => [o.id, o.at, o.height]));
    if (s === sig) return;
    sig = s;
    for (const m of boxes.values()) group.remove(m);
    boxes.clear();
    for (const o of list) {
      const x = o.at.charCodeAt(0) - 65, y = parseInt(o.at.slice(1), 10) - 1, h = Math.max(0.4, (o.height || 4) * FT);
      const m = new THREE.Mesh(boxGeo, hitMat);
      m.scale.set(0.9, h, 0.9); m.position.set(x + 0.5, floorFt(x, y) * FT + h / 2, y + 0.5);
      m.userData.obj = o.id;
      group.add(m); boxes.set(o.id, m);
    }
    group.updateMatrixWorld(true);
  }
  const wrap = (line, id) => {
    const m = id && boxes.get(id);
    line.visible = !!m;
    if (m) { line.position.copy(m.position); line.scale.copy(m.scale).multiplyScalar(1.04); }
  };
  function highlight(selected, hovered) {
    wrap(outline, selected);
    wrap(hoverLine, hovered !== selected ? hovered : null);
  }
  // The prop the ray meets first, unless terrain (a wall, a rise) is clearly nearer. { id, distance } | null
  function pick(ray, terrainDist = Infinity) {
    const h = ray.intersectObjects(group.children, false)[0];
    return h && h.distance <= terrainDist + 0.05 ? { id: h.object.userData.obj, distance: h.distance } : null;
  }
  // A side of a terrain mesh that the ray hit: { x, y, side }, from the hit point and its face normal (not the mesh, so it
  // still works once terrain is merged). `isFace(x, y, side)` says whether that side is a real climbable face.
  function faceOf(hit, isFace) {
    if (!hit || !hit.face) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (Math.abs(n.y) > 0.5) return null;
    const side = Math.abs(n.x) > Math.abs(n.z) ? (n.x > 0 ? 'e' : 'w') : (n.z > 0 ? 's' : 'n');
    const p = hit.point.clone().addScaledVector(n, -0.01), x = Math.floor(p.x), y = Math.floor(p.z);
    return isFace(x, y, side) ? { x, y, side } : null;
  }
  // Frame the selected face: on the side of square (x, y), from y0 to y1 (world units).
  function showFace(f, y0, y1) {
    face.visible = !!f;
    if (!f) return;
    const [dx, dz] = STEP[f.side], h = Math.max(0.2, y1 - y0);
    face.position.set(f.x + 0.5 + dx * 0.505, y0 + h / 2, f.y + 0.5 + dz * 0.505);
    face.rotation.set(0, dx ? Math.PI / 2 : 0, 0);
    face.scale.set(0.96, h, 1);
  }
  function dispose() {
    scene.remove(group, outline, hoverLine, face);
    boxGeo.dispose(); edgeGeo.dispose(); faceGeo.dispose();
    face.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
    hitMat.dispose(); lineMat.dispose(); hoverMat.dispose();
  }
  return { sync, highlight, pick, faceOf, showFace, has: (id) => boxes.has(id), dispose };
}
