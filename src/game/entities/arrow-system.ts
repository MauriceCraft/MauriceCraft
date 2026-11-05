import * as THREE from 'three';
import { part } from './mob-models';
import type { MobActor } from './mob-simulation';

export interface ArrowProjectile {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  mesh: THREE.Group;
  life: number;
  stuck: boolean;
  dmg: number;
}

export interface ArrowDependencies {
  scene: THREE.Scene;
  player: { x: number; y: number; z: number };
  mobs: MobActor[];
  getBlock: (x: number, y: number, z: number) => number;
  solid: (block: number) => boolean;
  collides: (x: number, y: number, z: number, radius?: number, height?: number) => boolean;
  hasHealth: () => boolean;
  damagePlayer: (damage: number, scaled: boolean) => void;
  damageMob: (mob: MobActor, damage: number) => void;
  playSound: (event: string) => void;
  playSoundAt: (event: string, x: number, y: number, z: number) => void;
}

/** Owns arrow meshes, flight, line-of-sight and hit resolution. */
export function createArrowSystem(deps: ArrowDependencies) {
  const { scene, player, mobs } = deps;
  const get = deps.getBlock, solid = deps.solid, collides = deps.collides;
  const hasHealth = deps.hasHealth, damagePlayer = deps.damagePlayer;
  const damageMob = deps.damageMob, sfx = deps.playSound, sfxAt = deps.playSoundAt;
  const arrows: ArrowProjectile[] = [];

function hasLOS(m: MobActor, tgt?: MobActor | null): boolean {
  const tx0 = tgt ? tgt.x : player.x, ty0 = (tgt ? tgt.y : player.y) + 1.2, tz0 = tgt ? tgt.z : player.z;
  const ox = m.x, oy = m.y + 1.5, oz = m.z, dx = tx0 - ox, dy = ty0 - oy, dz = tz0 - oz, d = Math.hypot(dx, dy, dz);
  const n = Math.ceil(d / 0.6);
  for (let i = 1; i < n; i++) { const t = i / n; if (solid(get(Math.floor(ox + dx * t), Math.floor(oy + dy * t), Math.floor(oz + dz * t)))) return false; }
  return true;
}
function shootArrow(m: MobActor, dmg?: number, tgt?: MobActor | null): void {
  const tx0 = tgt ? tgt.x : player.x, ty0 = (tgt ? tgt.y : player.y) + 1.2, tz0 = tgt ? tgt.z : player.z;
  const ox = m.x, oy = m.y + 1.5, oz = m.z, dx = tx0 - ox, dy = ty0 - oy, dz = tz0 - oz;
  const d = Math.hypot(dx, dy, dz) || 1, sp = 20;
  const vx = dx / d * sp, vz = dz / d * sp, vy = dy / d * sp + 0.3 * d;
  const g = new THREE.Group();
  part(g, 0.05, 0.05, 0.6, 0x8a6a3c, 0, 0, 0); part(g, 0.08, 0.08, 0.08, 0xcfcfcf, 0, 0, 0.32);
  g.position.set(ox, oy, oz); scene.add(g); g.lookAt(ox + vx, oy + vy, oz + vz);
  arrows.push({ x: ox, y: oy, z: oz, vx: vx, vy: vy, vz: vz, mesh: g, life: 6, stuck: false, dmg: dmg || 3 });
  sfxAt('arrow', ox, oy, oz);
}
function updateArrows(dt: number): void {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    a.life -= dt;
    if (a.life <= 0) { scene.remove(a.mesh); arrows.splice(i, 1); continue; }
    if (a.stuck) continue;
    a.vy -= 12 * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(a.vx, a.vy, a.vz) * dt / 0.3));
    let gone = false;
    for (let s2 = 0; s2 < steps; s2++) {
      const nx = a.x + a.vx * dt / steps, ny = a.y + a.vy * dt / steps, nz = a.z + a.vz * dt / steps;
      if (collides(nx, ny - 0.05, nz, 0.05, 0.1)) { a.stuck = true; a.life = Math.min(a.life, 3); break; }
      a.x = nx; a.y = ny; a.z = nz;
      if (hasHealth() && Math.abs(a.x - player.x) < 0.45 && Math.abs(a.z - player.z) < 0.45 && a.y > player.y && a.y < player.y + 1.8) {
        damagePlayer(a.dmg || 3, true); sfx('hit'); scene.remove(a.mesh); arrows.splice(i, 1); gone = true; break;
      }
      for (let q = 0; q < mobs.length; q++) {   // arrows hit villagers too
        const o = mobs[q];
        if ((o.kind === 'villager' || o.golem) && Math.abs(a.x - o.x) < o.r + 0.15 && Math.abs(a.z - o.z) < o.r + 0.15 && a.y > o.y && a.y < o.y + o.h) {
          sfxAt('hit', o.x, o.y + 1, o.z); scene.remove(a.mesh); arrows.splice(i, 1); gone = true;
          damageMob(o, a.dmg || 3);
          break;
        }
      }
      if (gone) break;
    }
    if (gone) continue;
    a.mesh.position.set(a.x, a.y, a.z);
    if (!a.stuck) a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
  }
}

  return { arrows, hasLOS, shootArrow, updateArrows };
}
