import * as THREE from 'three';

/** Geometry factories: pure Three.js object creation, no DOM or scene state. */
const GEO: Record<string, THREE.BoxGeometry> = {};
const MAT: Record<number, THREE.MeshBasicMaterial> = {};
export const bg = (w: number, h: number, d: number): THREE.BoxGeometry => { const k = w + ',' + h + ',' + d; return GEO[k] || (GEO[k] = new THREE.BoxGeometry(w, h, d)); };
export const bm = (c: number): THREE.MeshBasicMaterial => { return MAT[c] || (MAT[c] = new THREE.MeshBasicMaterial({ color: c })); };
export function part(g: THREE.Group, w: number, h: number, d: number, c: number, x: number, y: number, z: number): THREE.Mesh { const m = new THREE.Mesh(bg(w, h, d), bm(c)); m.position.set(x, y, z); g.add(m); return m; }
function leg(g: THREE.Group, w: number, h: number, c: number, x: number, y: number, z: number): void {
  const pv = new THREE.Group(); pv.position.set(x, y, z);
  const m = new THREE.Mesh(bg(w, h, w), bm(c)); m.position.y = -h / 2; pv.add(m); g.add(pv);
  g.userData.legs.push(pv);
}
function makeZombie(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  leg(g, 0.25, 0.7, 0x34469a, -0.14, 0.7, 0); leg(g, 0.25, 0.7, 0x34469a, 0.14, 0.7, 0);
  part(g, 0.55, 0.7, 0.3, 0x2f8a9a, 0, 1.05, 0);
  part(g, 0.45, 0.45, 0.45, 0x5f9a45, 0, 1.58, 0);
  part(g, 0.08, 0.08, 0.02, 0x1b1b1b, -0.11, 1.62, 0.23); part(g, 0.08, 0.08, 0.02, 0x1b1b1b, 0.11, 1.62, 0.23);
  for (const sx of [-1, 1]) {
    const arm = part(g, 0.2, 0.65, 0.2, 0x5f9a45, sx * 0.375, 1.08, 0.3); arm.rotation.x = -1.45; arm.position.set(sx * 0.375, 1.3, 0.28);
  }
  return g;
}
function makeCow(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  part(g, 0.8, 0.7, 1.2, 0x4b2f1c, 0, 0.95, 0);
  part(g, 0.5, 0.04, 0.45, 0xeeeae0, -0.12, 1.31, -0.15); part(g, 0.3, 0.45, 0.04, 0xeeeae0, 0.41, 0.95, 0.2);
  part(g, 0.55, 0.5, 0.5, 0x4b2f1c, 0, 1.22, 0.85); part(g, 0.35, 0.2, 0.1, 0xd9b8a0, 0, 1.12, 1.13);
  part(g, 0.08, 0.2, 0.08, 0xeeeae0, -0.24, 1.55, 0.85); part(g, 0.08, 0.2, 0.08, 0xeeeae0, 0.24, 1.55, 0.85);
  part(g, 0.07, 0.07, 0.02, 0x111111, -0.15, 1.28, 1.11); part(g, 0.07, 0.07, 0.02, 0x111111, 0.15, 1.28, 1.11);
  leg(g, 0.2, 0.6, 0x3a2415, -0.26, 0.6, 0.45); leg(g, 0.2, 0.6, 0x3a2415, 0.26, 0.6, 0.45);
  leg(g, 0.2, 0.6, 0x3a2415, -0.26, 0.6, -0.45); leg(g, 0.2, 0.6, 0x3a2415, 0.26, 0.6, -0.45);
  return g;
}
function makePig(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  part(g, 0.6, 0.5, 0.95, 0xf2a6a6, 0, 0.62, 0);
  part(g, 0.46, 0.42, 0.4, 0xf2a6a6, 0, 0.72, 0.66); part(g, 0.26, 0.18, 0.1, 0xd98080, 0, 0.66, 0.9);
  part(g, 0.06, 0.06, 0.02, 0x222222, -0.12, 0.8, 0.87); part(g, 0.06, 0.06, 0.02, 0x222222, 0.12, 0.8, 0.87);
  leg(g, 0.18, 0.37, 0xe39393, -0.18, 0.37, 0.3); leg(g, 0.18, 0.37, 0xe39393, 0.18, 0.37, 0.3);
  leg(g, 0.18, 0.37, 0xe39393, -0.18, 0.37, -0.3); leg(g, 0.18, 0.37, 0xe39393, 0.18, 0.37, -0.3);
  return g;
}
function makeSheep(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  part(g, 0.85, 0.75, 1.0, 0xf0f0ea, 0, 0.98, 0);
  part(g, 0.42, 0.42, 0.45, 0x6f5d4c, 0, 1.15, 0.72); part(g, 0.44, 0.12, 0.36, 0xf0f0ea, 0, 1.42, 0.62);
  part(g, 0.06, 0.06, 0.02, 0x111111, -0.1, 1.2, 0.95); part(g, 0.06, 0.06, 0.02, 0x111111, 0.1, 1.2, 0.95);
  leg(g, 0.18, 0.6, 0x6f5d4c, -0.25, 0.6, 0.35); leg(g, 0.18, 0.6, 0x6f5d4c, 0.25, 0.6, 0.35);
  leg(g, 0.18, 0.6, 0x6f5d4c, -0.25, 0.6, -0.35); leg(g, 0.18, 0.6, 0x6f5d4c, 0.25, 0.6, -0.35);
  return g;
}
function makeChicken(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  part(g, 0.3, 0.3, 0.45, 0xf4f4f0, 0, 0.45, 0);
  part(g, 0.04, 0.2, 0.3, 0xe2e2dc, -0.17, 0.48, 0); part(g, 0.04, 0.2, 0.3, 0xe2e2dc, 0.17, 0.48, 0);
  part(g, 0.2, 0.25, 0.2, 0xf4f4f0, 0, 0.72, 0.25); part(g, 0.1, 0.06, 0.12, 0xe9b830, 0, 0.7, 0.4);
  part(g, 0.06, 0.1, 0.12, 0xd02828, 0, 0.88, 0.25); part(g, 0.05, 0.1, 0.1, 0xd02828, 0, 0.62, 0.36);
  part(g, 0.1, 0.1, 0.1, 0xf4f4f0, 0, 0.55, -0.26);
  leg(g, 0.05, 0.3, 0xe9b830, -0.08, 0.3, 0); leg(g, 0.05, 0.3, 0xe9b830, 0.08, 0.3, 0);
  return g;
}
function makeCreeper(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  part(g, 0.5, 0.8, 0.3, 0x4caf3a, 0, 0.95, 0); part(g, 0.5, 0.5, 0.5, 0x58b845, 0, 1.6, 0);
  part(g, 0.1, 0.1, 0.02, 0x111111, -0.12, 1.68, 0.26); part(g, 0.1, 0.1, 0.02, 0x111111, 0.12, 1.68, 0.26);
  part(g, 0.16, 0.22, 0.02, 0x111111, 0, 1.5, 0.26); part(g, 0.3, 0.08, 0.02, 0x111111, 0, 1.58, 0.26);
  leg(g, 0.22, 0.55, 0x3f9a30, -0.14, 0.55, 0.2); leg(g, 0.22, 0.55, 0x3f9a30, 0.14, 0.55, 0.2);
  leg(g, 0.22, 0.55, 0x3f9a30, -0.14, 0.55, -0.2); leg(g, 0.22, 0.55, 0x3f9a30, 0.14, 0.55, -0.2);
  return g;
}
function makeSkeleton(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  leg(g, 0.14, 0.8, 0xd9d9cf, -0.12, 0.8, 0); leg(g, 0.14, 0.8, 0xd9d9cf, 0.12, 0.8, 0);
  part(g, 0.4, 0.75, 0.2, 0xd9d9cf, 0, 1.2, 0); part(g, 0.42, 0.06, 0.22, 0x8e8e84, 0, 1.4, 0); part(g, 0.42, 0.06, 0.22, 0x8e8e84, 0, 1.2, 0);
  part(g, 0.45, 0.45, 0.45, 0xe8e8de, 0, 1.82, 0);
  part(g, 0.09, 0.09, 0.02, 0x111111, -0.1, 1.86, 0.23); part(g, 0.09, 0.09, 0.02, 0x111111, 0.1, 1.86, 0.23);
  for (const sx of [-1, 1]) { const arm = part(g, 0.12, 0.7, 0.12, 0xd9d9cf, sx * 0.3, 1.4, 0.3); arm.rotation.x = -1.3; }
  part(g, 0.05, 0.75, 0.05, 0x7a5a30, 0.3, 1.4, 0.55);
  return g;
}
function makeSpider(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  part(g, 0.7, 0.4, 0.9, 0x2a2326, 0, 0.45, 0); part(g, 0.45, 0.35, 0.4, 0x3a3034, 0, 0.45, 0.65);
  part(g, 0.07, 0.07, 0.02, 0xff2020, -0.1, 0.52, 0.86); part(g, 0.07, 0.07, 0.02, 0xff2020, 0.1, 0.52, 0.86);
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
    const l = part(g, 0.6, 0.06, 0.06, 0x1c1719, sx * 0.55, 0.38, -0.3 + i * 0.25); l.rotation.z = sx * 0.45; l.rotation.y = sx * (i - 1.5) * 0.18;
  }
  return g;
}
function makePillager(o: { leader?: boolean } = {}): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  leg(g, 0.26, 0.75, 0x3a3a3e, -0.14, 0.75, 0); leg(g, 0.26, 0.75, 0x3a3a3e, 0.14, 0.75, 0);
  part(g, 0.6, 0.8, 0.38, 0x5a5a5e, 0, 1.15, 0);
  part(g, 0.5, 0.5, 0.5, 0xbba08a, 0, 1.75, 0); part(g, 0.14, 0.24, 0.16, 0xa88a74, 0, 1.68, 0.3);
  part(g, 0.1, 0.05, 0.02, 0x222222, -0.12, 1.8, 0.26); part(g, 0.1, 0.05, 0.02, 0x222222, 0.12, 1.8, 0.26);
  part(g, 0.52, 0.08, 0.02, 0x2a2a2e, 0, 1.92, 0.26);
  part(g, 0.6, 0.2, 0.28, 0x5a5a5e, 0, 1.3, 0.2);
  part(g, 0.6, 0.1, 0.1, 0x4a3826, 0, 1.35, 0.42); part(g, 0.08, 0.4, 0.08, 0x4a3826, 0, 1.35, 0.42);
  if (o && o.leader) { part(g, 0.06, 1.0, 0.06, 0x6b4f2e, 0, 1.6, -0.3); part(g, 0.5, 0.45, 0.04, 0x2a5db0, 0, 1.9, -0.3); part(g, 0.3, 0.1, 0.05, 0xeeeeee, 0, 1.9, -0.31); }
  return g;
}
function makeVindicator(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  leg(g, 0.26, 0.75, 0x2a2a2e, -0.14, 0.75, 0); leg(g, 0.26, 0.75, 0x2a2a2e, 0.14, 0.75, 0);
  part(g, 0.62, 0.82, 0.4, 0x2f4a3a, 0, 1.15, 0); part(g, 0.66, 0.1, 0.42, 0x1f3226, 0, 1.5, 0);
  part(g, 0.5, 0.5, 0.5, 0xbba08a, 0, 1.75, 0); part(g, 0.14, 0.24, 0.16, 0xa88a74, 0, 1.68, 0.3);
  part(g, 0.1, 0.05, 0.02, 0x222222, -0.12, 1.8, 0.26); part(g, 0.1, 0.05, 0.02, 0x222222, 0.12, 1.8, 0.26);
  part(g, 0.52, 0.08, 0.02, 0x2a2a2e, 0, 1.92, 0.26);
  part(g, 0.6, 0.2, 0.28, 0x2f4a3a, 0, 1.3, 0.2);
  part(g, 0.06, 0.7, 0.06, 0x6b4f2e, 0.34, 1.3, 0.45); part(g, 0.3, 0.22, 0.06, 0x9aa0a8, 0.34, 1.62, 0.45);
  return g;
}
function makeIronGolem(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  leg(g, 0.36, 0.8, 0x9aa0a6, -0.25, 0.8, 0); leg(g, 0.36, 0.8, 0x9aa0a6, 0.25, 0.8, 0);
  leg(g, 0.3, 1.2, 0xb8bcc2, -0.82, 2.0, 0); leg(g, 0.3, 1.2, 0xb8bcc2, 0.82, 2.0, 0);
  part(g, 0.95, 0.7, 0.55, 0xb8bcc2, 0, 1.15, 0); part(g, 1.3, 0.85, 0.7, 0xcdd1d6, 0, 1.8, 0);
  part(g, 0.5, 0.5, 0.5, 0xc2c6cc, 0, 2.45, 0.02); part(g, 0.12, 0.24, 0.14, 0x9a8a78, 0, 2.38, 0.3);
  part(g, 0.1, 0.07, 0.02, 0xc02020, -0.13, 2.52, 0.26); part(g, 0.1, 0.07, 0.02, 0xc02020, 0.13, 2.52, 0.26);
  part(g, 0.18, 0.3, 0.04, 0x5f8f4a, 0.2, 1.8, 0.37); part(g, 0.12, 0.25, 0.04, 0x5f8f4a, -0.3, 1.55, 0.37);
  return g;
}
function makeCopperGolem(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  leg(g, 0.14, 0.3, 0xb8642e, -0.1, 0.3, 0); leg(g, 0.14, 0.3, 0xb8642e, 0.1, 0.3, 0);
  leg(g, 0.1, 0.35, 0xd2793f, -0.26, 0.72, 0); leg(g, 0.1, 0.35, 0xd2793f, 0.26, 0.72, 0);
  part(g, 0.4, 0.4, 0.28, 0xd2793f, 0, 0.5, 0); part(g, 0.44, 0.34, 0.38, 0xe08a4a, 0, 0.9, 0);
  part(g, 0.06, 0.06, 0.02, 0x1d2b2a, -0.1, 0.93, 0.2); part(g, 0.06, 0.06, 0.02, 0x1d2b2a, 0.1, 0.93, 0.2);
  part(g, 0.1, 0.1, 0.1, 0x4fa38a, 0, 0.84, 0.22); part(g, 0.3, 0.08, 0.02, 0x4fa38a, 0, 0.42, 0.15);
  part(g, 0.04, 0.3, 0.04, 0xb8642e, 0, 1.22, 0); part(g, 0.1, 0.06, 0.1, 0x4fa38a, 0, 1.4, 0);
  return g;
}
function makeDiamondGolem(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  leg(g, 0.45, 0.9, 0x3ccfd0, -0.35, 0.9, 0); leg(g, 0.45, 0.9, 0x3ccfd0, 0.35, 0.9, 0);
  leg(g, 0.38, 1.5, 0x4be3d6, -1.0, 2.5, 0); leg(g, 0.38, 1.5, 0x4be3d6, 1.0, 2.5, 0);
  part(g, 1.2, 0.8, 0.7, 0x45d8cd, 0, 1.3, 0); part(g, 1.6, 0.95, 0.85, 0x5beadf, 0, 2.05, 0);
  part(g, 0.6, 0.6, 0.6, 0x7ff5ea, 0, 2.85, 0.02);
  part(g, 0.14, 0.14, 0.02, 0xffffff, -0.15, 2.92, 0.31); part(g, 0.14, 0.14, 0.02, 0xffffff, 0.15, 2.92, 0.31);
  part(g, 0.3, 0.45, 0.3, 0xb6fff8, -0.85, 2.7, 0); part(g, 0.3, 0.45, 0.3, 0xb6fff8, 0.85, 2.7, 0); part(g, 0.2, 0.55, 0.2, 0xb6fff8, 0, 3.3, 0);
  return g;
}
export const JOBS = ['farmer', 'butcher', 'mason', 'blacksmith', 'cleric'];
export const JOB_NAMES = { farmer: 'Farmer', butcher: 'Butcher', mason: 'Mason', blacksmith: 'Blacksmith', cleric: 'Cleric' };
const JOBLOOK = {
  farmer: { robe: 0x8a6a3c, apron: 0x6c8a3a }, butcher: { robe: 0xe8e4dc, apron: 0xb83a3a }, mason: { robe: 0x8b8b8b, apron: 0x5f5f66 },
  blacksmith: { robe: 0x3a3a40, apron: 0x151518 }, cleric: { robe: 0x7a3aa0, apron: 0xd8b24a }
};
function makeVillager(o: { job?: keyof typeof JOBLOOK } = {}): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  const L = JOBLOOK[o.job ?? 'farmer'];
  leg(g, 0.28, 0.75, 0x4a3a2a, -0.15, 0.75, 0); leg(g, 0.28, 0.75, 0x4a3a2a, 0.15, 0.75, 0);
  part(g, 0.62, 0.8, 0.4, L.robe, 0, 1.15, 0); part(g, 0.66, 0.5, 0.05, L.apron, 0, 1.0, 0.22);
  part(g, 0.5, 0.5, 0.5, 0xc9a07a, 0, 1.75, 0); part(g, 0.14, 0.24, 0.16, 0xb98a68, 0, 1.68, 0.3);
  part(g, 0.08, 0.06, 0.02, 0x2a5a2a, -0.12, 1.8, 0.26); part(g, 0.08, 0.06, 0.02, 0x2a5a2a, 0.12, 1.8, 0.26);
  part(g, 0.5, 0.06, 0.02, 0x3a2a1a, 0, 1.9, 0.26);
  part(g, 0.6, 0.2, 0.28, L.robe, 0, 1.3, 0.2);
  if (o.job === 'farmer') { part(g, 0.85, 0.05, 0.85, 0xd9bf62, 0, 2.0, 0); part(g, 0.5, 0.14, 0.5, 0xd9bf62, 0, 2.08, 0); }
  else if (o.job === 'butcher') part(g, 0.55, 0.16, 0.55, 0xf4f0e6, 0, 2.02, 0);
  else if (o.job === 'blacksmith') part(g, 0.52, 0.1, 0.52, 0x2a2018, 0, 2.0, 0);
  else if (o.job === 'cleric') part(g, 0.54, 0.3, 0.54, 0x7a3aa0, 0, 2.08, 0);
  return g;
}
function makeEnderDragon(): THREE.Group {
  const g = new THREE.Group(); g.userData.legs = [];
  // Long black-purple body, neck, head, tail and angular wings.
  part(g, 1.35, 1.15, 3.8, 0x171322, 0, 0, 0);
  part(g, 0.8, 0.8, 2.0, 0x21172f, 0, 0.15, 2.2);
  part(g, 0.95, 0.8, 1.0, 0x171322, 0, 0.3, 3.4);
  part(g, 0.22, 0.22, 0.08, 0xff35f2, -0.28, 0.42, 3.92);
  part(g, 0.22, 0.22, 0.08, 0xff35f2, 0.28, 0.42, 3.92);
  for (let i=0;i<4;i++) part(g, 0.38-i*0.065, 0.38-i*0.065, 1.35, 0x21172f, 0, -0.08-i*0.02, -2.0-i*1.0);
  for (const side of [-1,1]) {
    const wing = new THREE.Group(); wing.position.set(side*0.55,0.25,0.25); g.add(wing);
    part(wing, 3.2, 0.12, 1.65, 0x21172f, side*1.6, 0, -0.2);
    part(wing, 2.7, 0.1, 0.12, 0x49305e, side*1.7, 0, 0.62);
    part(wing, 0.12, 0.1, 1.7, 0x49305e, side*3.05, 0, -0.2);
    wing.userData.flapSide = side; g.userData.wings = g.userData.wings || []; g.userData.wings.push(wing);
  }
  return g;
}

export { makeZombie, makeCow, makePig, makeSheep, makeChicken, makeCreeper, makeSkeleton, makeSpider, makePillager, makeVindicator, makeIronGolem, makeCopperGolem, makeDiamondGolem, makeVillager, makeEnderDragon };
