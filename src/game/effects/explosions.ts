import * as THREE from 'three';
import { bg, bm, part } from '../entities/mob-models';

interface BlastMob {
  x: number; y: number; z: number; h: number; r: number;
  vx: number; vy: number; vz: number;
}
interface BlastBase {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  r: number; h: number; fuse: number; snd?: number;
}
type TntBlast = BlastBase & {
  type: 'tnt'; mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial; onGround: boolean; hit: boolean;
};
type DynamiteBlast = BlastBase & {
  type: 'dyn'; mesh: THREE.Group; tipMat: THREE.MeshBasicMaterial;
  stuck: boolean; host: BlastMob | null; ox: number; oy: number; oz: number;
};
type Blast = TntBlast | DynamiteBlast;
type BlastEffect =
  | { kind: 'flash'; mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      life: number; t: number; rad: number }
  | { kind: 'debris'; mesh: THREE.Mesh; life: number; t: number;
      vx: number; vy: number; vz: number };

export interface ExplosionDependencies {
  scene: THREE.Scene;
  texture: THREE.Texture;
  tntId: number;
  torchId: number;
  worldHeight: number;
  breakTimes: Readonly<Record<number, number>>;
  blockGeometry: (blockId: number) => THREE.BufferGeometry;
  getBlock: (x: number, y: number, z: number) => number;
  setBlock: (x: number, y: number, z: number, blockId: number) => void;
  hasChunk: (chunkX: number, chunkZ: number) => boolean;
  buildChunk: (chunkX: number, chunkZ: number) => void;
  getMobs: () => BlastMob[];
  getPlayer: () => BlastMob;
  damageMob: (mob: BlastMob, damage: number) => void;
  damagePlayer: (damage: number) => void;
  moveEntity: (actor: TntBlast, axis: number, delta: number) => void;
  collides: (x: number, y: number, z: number, radius: number, height: number) => boolean;
  playSound: (event: string, x: number, y: number, z: number) => void;
  increaseShake: (amount: number) => void;
}

/** TNT and dynamite simulation, separated from the game loop and controls. */
export function createExplosionSystem(deps: ExplosionDependencies) {
  const { scene, getBlock: get, setBlock, buildChunk, getMobs, getPlayer,
    damageMob, damagePlayer, collides, increaseShake } = deps;
  const TNT = deps.tntId, TORCH = deps.torchId, H = deps.worldHeight;
  const BREAK_TIME = deps.breakTimes, tex = deps.texture;
  const blockGeo = deps.blockGeometry;
  const chunkAt = (x: number, z: number) => deps.hasChunk(x, z);
  const sfxAt = deps.playSound;
  const moveEnt = deps.moveEntity;

  /* ---------- TNT, dynamite and explosions ---------- */
  const blasts: Blast[] = [], fx: BlastEffect[] = [];
  let tntGeo: THREE.BufferGeometry | null = null;
  function spawnTnt(x: number, y: number, z: number, fuse: number, vx = 0, vy = 0, vz = 0): void {   // x,z = centre, y = bottom
    if (!tntGeo) tntGeo = blockGeo(TNT);
    const m2 = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });
    const mesh = new THREE.Mesh(tntGeo, m2); mesh.position.set(x, y + 0.5, z); scene.add(mesh);
    blasts.push({ type: 'tnt', x: x, y: y, z: z, vx: vx || 0, vy: vy || 0, vz: vz || 0, r: 0.49, h: 0.98, fuse: fuse, mesh: mesh, mat: m2, onGround: false, hit: false });
  }
  function addDynamite(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {   // x,y,z = centre
    const g = new THREE.Group();
    part(g, 0.1, 0.1, 0.42, 0xc9302b, 0, 0, 0); part(g, 0.11, 0.11, 0.08, 0xe8d8a8, 0, 0, 0.04);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xffb236 });
    const tip = new THREE.Mesh(bg(0.05, 0.05, 0.1), tipMat); tip.position.z = 0.25; g.add(tip);
    g.position.set(x, y, z); scene.add(g);
    g.lookAt(x + vx, y + vy, z + vz);
    blasts.push({ type: 'dyn', x: x, y: y - 0.08, z: z, vx: vx, vy: vy, vz: vz, r: 0.08, h: 0.16, fuse: 3, mesh: g, tipMat: tipMat, stuck: false, host: null, ox: 0, oy: 0, oz: 0 });
  }
  function removeBlastAt(i: number): void {
    const b = blasts[i];
    scene.remove(b.mesh);
    if (b.mat) b.mat.dispose();
    if (b.tipMat) b.tipMat.dispose();
    blasts.splice(i, 1);
  }
  function removeFxAt(i: number): void {
    const f = fx[i];
    scene.remove(f.mesh);
    if (f.kind === 'flash') f.mesh.material.dispose();
    fx.splice(i, 1);
  }
  const rebuildSet = new Set<string>();
  function queueRebuild(x: number, z: number, wide = false): void {
    const cx = x >> 4, cz = z >> 4, lx = x & 15, lz = z & 15, dxs = [0], dzs = [0];
    if (wide) { dxs.push(-1, 1); dzs.push(-1, 1); }
    if (lx === 0) dxs.push(-1);
    if (lx === 15) dxs.push(1);
    if (lz === 0) dzs.push(-1);
    if (lz === 15) dzs.push(1);
    dxs.forEach(function (dx) { dzs.forEach(function (dz) { rebuildSet.add((cx + dx) + ',' + (cz + dz)); }); });
  }
  function flushRebuilds(): void {
    rebuildSet.forEach(function (k) { const q = k.split(','); buildChunk(+q[0], +q[1]); });
    rebuildSet.clear();
  }
  const fxFlashGeo = new THREE.SphereGeometry(1, 14, 10);
  const fxDebrisGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  const FX_COLS = [0xffa21f, 0xff5a1a, 0x666666, 0x2b2b2b, 0xffd35c];
  function spawnBlastFx(x: number, y: number, z: number, rad: number): void {
    const fm = new THREE.Mesh(fxFlashGeo, new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
    fm.position.set(x, y, z); fm.scale.setScalar(0.5); scene.add(fm);
    fx.push({ kind: 'flash', mesh: fm, life: 0.35, t: 0, rad: rad });
    const n = Math.round(10 + rad * 5);
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(fxDebrisGeo, bm(FX_COLS[i % FX_COLS.length]));
      p.position.set(x, y, z); scene.add(p);
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2, sp = 4 + Math.random() * 7;
      fx.push({ kind: 'debris', mesh: p, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 4, vz: Math.sin(a) * Math.cos(e) * sp, life: 0.7 + Math.random() * 0.6, t: 0 });
    }
  }
  function updateFx(dt: number): void {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.t += dt;
      if (f.t >= f.life) { removeFxAt(i); continue; }
      if (f.kind === 'flash') { const u = f.t / f.life; f.mesh.scale.setScalar(0.5 + u * f.rad * 1.3); f.mesh.material.opacity = 0.85 * (1 - u); }
      else { f.vy -= 22 * dt; f.mesh.position.x += f.vx * dt; f.mesh.position.y += f.vy * dt; f.mesh.position.z += f.vz * dt; f.mesh.scale.setScalar(Math.max(0.1, 1 - f.t / f.life)); }
    }
  }
  function explode(x: number, y: number, z: number, rad: number, power: number): void {
    const player = getPlayer();
    const R0 = Math.ceil(rad), bx0 = Math.floor(x), by0 = Math.floor(y), bz0 = Math.floor(z);
    for (let dx = -R0; dx <= R0; dx++) for (let dy = -R0; dy <= R0; dy++) for (let dz = -R0; dz <= R0; dz++) {
      const bx = bx0 + dx, by = by0 + dy, bz = bz0 + dz;
      if (by <= 0 || by >= H) continue;
      const b = get(bx, by, bz);
      if (!b || b === 3 && !chunkAt(bx >> 4, bz >> 4)) continue;
      const d = Math.hypot(bx + 0.5 - x, by + 0.5 - y, bz + 0.5 - z);
      if (d > rad) continue;
      if (b === TNT) {
        setBlock(bx, by, bz, 0); queueRebuild(bx, bz);
        const dd = d || 1;
        spawnTnt(bx + 0.5, by, bz + 0.5, 0.35 + Math.random() * 0.7, (bx + 0.5 - x) / dd * 4, 3 + Math.random() * 3, (bz + 0.5 - z) / dd * 4);
        continue;
      }
      const tough = (BREAK_TIME[b] || 1) >= 2 ? 0.75 : 1;
      if (d / rad > tough * (0.7 + Math.random() * 0.3)) continue;
      setBlock(bx, by, bz, 0); queueRebuild(bx, bz, b === TORCH);
    }
    flushRebuilds();
    const reach = rad * 2;
    getMobs().slice().forEach(function (m) {
      const d = Math.hypot(m.x - x, m.y + m.h / 2 - y, m.z - z);
      if (d >= reach) return;
      const f = 1 - d / reach, dd = d || 1;
      m.vx += (m.x - x) / dd * f * 14; m.vz += (m.z - z) / dd * f * 14; m.vy = 3 + f * 8;
      damageMob(m, Math.round(f * power));
    });
    const pd = Math.hypot(player.x - x, player.y + 0.9 - y, player.z - z);
    if (pd < reach) {
      const f = 1 - pd / reach, dd = pd || 1;
      player.vx += (player.x - x) / dd * f * 14; player.vz += (player.z - z) / dd * f * 14; player.vy += 3 + f * 8;
      damagePlayer(Math.round(f * power));
    }
    blasts.forEach(function (b) {
      const d = Math.hypot(b.x - x, b.y - y, b.z - z);
      if (d >= reach) return;
      const f = 1 - d / reach, dd = d || 1;
      b.vx += (b.x - x) / dd * f * 8; b.vz += (b.z - z) / dd * f * 8; b.vy += 2 + f * 5; b.stuck = false; b.host = null;
    });
    increaseShake(Math.max(0, 1 - pd / 24));
    spawnBlastFx(x, y, z, rad);
    sfxAt('explode', x, y, z);
  }
  function updateBlasts(dt: number): void {
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i];
      b.fuse -= dt;
      b.snd = (b.snd || 0) - dt;
      if (b.snd <= 0) { b.snd = b.fuse < 1 ? 0.12 : 0.25; sfxAt('fuse', b.x, b.y, b.z); }
      if (b.type === 'tnt') {
        b.vy = Math.max(-40, b.vy - 28 * dt);
        const fr = 1 - Math.min(1, 3 * dt); b.vx *= fr; b.vz *= fr;
        b.onGround = false; b.hit = false;
        moveEnt(b, 0, b.vx * dt); moveEnt(b, 2, b.vz * dt); moveEnt(b, 1, b.vy * dt);
        const on = Math.floor(b.fuse * (b.fuse < 1 ? 10 : 5)) % 2 === 0;
        b.mat.color.setScalar(on ? 1 : 2.8);
        b.mesh.scale.setScalar(1 + (b.fuse < 0.6 ? (0.6 - b.fuse) * 0.3 : 0));
        b.mesh.position.set(b.x, b.y + 0.49, b.z);
        if (b.fuse <= 0) { const cx = b.x, cy = b.y + 0.49, cz = b.z; removeBlastAt(i); explode(cx, cy, cz, 4.2, 30); }
      } else {
        if (b.host) {
          if (getMobs().indexOf(b.host) >= 0) { b.x = b.host.x + b.ox; b.y = b.host.y + b.oy; b.z = b.host.z + b.oz; }
          else { b.host = null; b.stuck = false; }
        }
        if (!b.stuck) {
          b.vy -= 18 * dt;
          const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy, b.vz) * dt / 0.15));
          for (let s2 = 0; s2 < steps; s2++) {
            const nx = b.x + b.vx * dt / steps, ny = b.y + b.vy * dt / steps, nz = b.z + b.vz * dt / steps;
            if (collides(nx, ny, nz, b.r, b.h)) { b.stuck = true; b.vx = b.vy = b.vz = 0; break; }
            b.x = nx; b.y = ny; b.z = nz;
            for (const m of getMobs()) {
              if (Math.abs(b.x - m.x) < m.r + 0.1 && Math.abs(b.z - m.z) < m.r + 0.1 && b.y + 0.08 > m.y && b.y + 0.08 < m.y + m.h) {
                b.stuck = true; b.host = m; b.ox = b.x - m.x; b.oy = b.y - m.y; b.oz = b.z - m.z; b.vx = b.vy = b.vz = 0; break;
              }
            }
            if (b.stuck) break;
          }
          if (!b.stuck) b.mesh.lookAt(b.x + b.vx, b.y + b.vy + 0.08, b.z + b.vz);
        }
        b.mesh.position.set(b.x, b.y + 0.08, b.z);
        b.tipMat.color.setHex(Math.floor(b.fuse * (b.fuse < 1 ? 12 : 6)) % 2 === 0 ? 0xfff1a8 : 0xff6a1a);
        if (b.fuse <= 0) { const cx = b.x, cy = b.y + 0.08, cz = b.z; removeBlastAt(i); explode(cx, cy, cz, 2.8, 16); }
      }
    }
  }
  return { blasts, fx, rebuildSet, spawnTnt, addDynamite, removeBlastAt,
    removeFxAt, queueRebuild, flushRebuilds, explode, updateBlasts, updateFx };
}
