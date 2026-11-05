import * as THREE from 'three';
import { SpatialIndex } from './spatial-index';
import type { MovableEntity } from '../world/collision';

/** The actor data needed by the deterministic mob movement/combat loop. */
export interface MobActor extends MovableEntity {
  kind: string;
  hostile: boolean;
  golem: boolean;
  persist: boolean;
  r: number; h: number;
  hp: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  onGround: boolean; hit: boolean;
  atk: number; burn: number; phase: number; ai: number;
  walk: boolean; dx: number; dz: number; panic: number; face: number;
  jumpCd: number; fuse: number; shoot: number; snd: number;
  hx: number; hz: number;
  group: THREE.Group;
  village: ({ vSpawned?: boolean } & { cx: number; cz: number }) | null;
  raid?: boolean;
  stuckT?: number;
}

export interface MobAttack {
  d: number;
  dmg: number;
  cd: number;
  lift?: number;
}
export interface MobMovementRules {
  speed: number;
  melee?: MobAttack;
  illager?: boolean;
  golem?: boolean;
  follow?: boolean;
  range?: number;
}
export interface MobDifficulty {
  cap: number;
  dmg: number;
  fuse: number;
  speed: number;
  aggro: number;
  shoot: number;
}
export interface MobCombatDependencies {
  mobs: MobActor[];
  player: { x: number; y: number; z: number; vx: number; vy: number; vz: number; onGround: boolean };
  kinds: Record<string, MobMovementRules>;
  raid: { st: { cx: number; cz: number } | null };
  hostileActors: SpatialIndex<MobActor>;
  defenders: SpatialIndex<MobActor>;
  getDifficulty: () => MobDifficulty;
  isDaylight: () => boolean;
  isNight: () => boolean;
  isSunExposed?: (x: number, y: number, z: number) => boolean;
  getRainLevel: () => number;
  canTakeDamage: () => boolean;
  removeMobAt: (index: number) => void;
  damagePlayer: (amount: number, scaled: boolean) => void;
  showHint: (message: string, milliseconds: number) => void;
  playSoundAt: (sound: string, x: number, y: number, z: number) => void;
  hasLineOfSight: (mob: MobActor, target?: MobActor | null) => boolean;
  shootArrow: (mob: MobActor, damage?: number, target?: MobActor | null) => void;
  moveEntity: (mob: MobActor, axis: number, distance: number) => void;
  pendingHits: Array<{ m: MobActor; d: number }>;
  pendingBlasts: Array<{ x: number; y: number; z: number; r: number; p: number }>;
}

/**
 * One pass over all creatures, using nearby spatial queries rather than
 * nested full-list scans for targets. No new per-frame index allocation.
 */
export function createMobSimulation(deps: MobCombatDependencies) {
  const { mobs, player, raid, hostileActors, defenders, removeMobAt,
    damagePlayer, showHint, pendingHits, pendingBlasts } = deps;
  const KINDS = deps.kinds;
  const sfxAt = deps.playSoundAt;
  const hasLOS = deps.hasLineOfSight;
  const shootArrow = deps.shootArrow;
  const moveEnt = deps.moveEntity;

  function stepMobActors(dt: number): void {
    const D = deps.getDifficulty();
    const isDay = deps.isDaylight();
    const isNight = deps.isNight();
    const rainLevel = deps.getRainLevel();
  for (let i = mobs.length - 1; i >= 0; i--) {
    const m = mobs[i], K = KINDS[m.kind];
    const dx = player.x - m.x, dz = player.z - m.z;
    const dist = Math.hypot(dx, dz) || 0.0001;
    if (m.kind === 'enderdragon') {
      m.phase += dt * 2.4;
      const targetX = player.x + Math.sin(m.phase * 0.55) * 10;
      const targetZ = player.z + Math.cos(m.phase * 0.55) * 10;
      const targetY = 27 + Math.sin(m.phase * 1.3) * 4;
      const ex = targetX - m.x, ez = targetZ - m.z, ey = targetY - m.y;
      const ed = Math.hypot(ex, ez) || 1;
      m.x += ex / ed * Math.min(ed, K.speed * dt);
      m.z += ez / ed * Math.min(ed, K.speed * dt);
      m.y += Math.max(-1, Math.min(1, ey)) * dt * 2.2;
      m.group.position.set(m.x, m.y + Math.sin(m.phase * 2) * 0.35, m.z);
      m.group.rotation.y = Math.atan2(ex, ez);
      hostileActors.upsert(m);
      if (m.group.userData.wings) (m.group.userData.wings as Array<THREE.Object3D & { userData: { flapSide: number } }>).forEach(function (w) { w.rotation.z = Math.sin(m.phase * 5) * 0.55 * w.userData.flapSide; });
      m.atk -= dt;
      if (dist < 5.5 && Math.abs(player.y - m.y) < 7 && m.atk <= 0) {
        m.atk = 1.4; damagePlayer(5, true); player.vx += dx / dist * 7; player.vz += dz / dist * 7; player.vy = 5;
        showHint('The Ender Dragon knocked you back!', 1400);
      }
      continue;
    }
    if (m.y < -30) { removeMobAt(i); continue; }
    if (m.hostile && D.cap === 0 && deps.canTakeDamage()) { removeMobAt(i); continue; }   // Peaceful: no monsters at all
    if (m.kind === 'villager' || m.village) { if (dist > 140) { if (m.village) m.village.vSpawned = false; removeMobAt(i); continue; } }
    else if (dist > (m.persist ? 120 : (K.illager ? 130 : (m.hostile ? 70 : 95)))) { removeMobAt(i); continue; }
    m.snd -= dt;
    if (m.snd <= 0) {
      m.snd = 6 + Math.random() * 10;
      if (m.kind !== 'creeper' && dist < (m.hostile ? 18 : 26)) sfxAt(m.kind, m.x, m.y + 1, m.z);
    }
    let tx = 0, tz = 0, ax = dx, az = dz, ad = dist, huntV = null;   // a*, huntV: who this monster is going after
    if (m.hostile) {
      if (isDay && rainLevel < 0.5 && !m.persist &&
        (m.kind === 'zombie' || m.kind === 'skeleton') &&
        (deps.isSunExposed?.(m.x, m.y, m.z) ?? true)) {   // rain keeps monsters from burning in daylight
        if (m.burn < 0) m.burn = 1 + Math.random() * 5; m.burn -= dt; if (m.burn <= 0) { removeMobAt(i); continue; } }
      else m.burn = -1;
      const ill = !!K.illager;
      if (m.kind === 'zombie' || ill) {   // zombies and illagers go for the nearest villager when it is closer than you
        for (const o of defenders.near(m.x, m.z, 40)) {
          const vd = Math.hypot(o.x - m.x, o.z - m.z);
          if (vd < ad && vd < 40) { ad = vd; ax = o.x - m.x; az = o.z - m.z; huntV = o; }
        }
      }
      const sees = ad < (ill ? (m.raid ? 70 : D.aggro + 12) : D.aggro);
      if (ill && !sees) {   // patrols and raiders march towards the player or the village
        const hx = (m.raid && raid.st) ? raid.st.cx : player.x, hz = (m.raid && raid.st) ? raid.st.cz : player.z, hd = Math.hypot(hx - m.x, hz - m.z) || 1;
        tx = (hx - m.x) / hd * 1.5; tz = (hz - m.z) / hd * 1.5;
      }
      m.jumpCd -= dt;
      if (m.kind === 'creeper') {
        if (m.fuse >= 0) {
          m.fuse -= dt;
          const sw = 1 + (D.fuse - m.fuse) * 0.2 + (Math.floor(m.fuse * 8) % 2 ? 0.05 : 0);
          m.group.scale.setScalar(sw);
          if (m.fuse <= 0) { pendingBlasts.push({ x: m.x, y: m.y + 0.8, z: m.z, r: 3.4, p: 24 * D.dmg }); removeMobAt(i); continue; }
          if (dist > 5) { m.fuse = -1; m.group.scale.setScalar(1); }
        } else if (sees) {
          if (dist < 3.2) { m.fuse = D.fuse; sfxAt('creeper', m.x, m.y + 1, m.z); }
          else if (dist > 0.9) { tx = dx / dist * K.speed * D.speed; tz = dz / dist * K.speed * D.speed; }
        }
      } else if (m.kind === 'skeleton') {
        if (sees && dist > 11) { tx = dx / dist * K.speed * D.speed; tz = dz / dist * K.speed * D.speed; }
        else if (sees && dist < 6) { tx = -dx / dist * K.speed * D.speed; tz = -dz / dist * K.speed * D.speed; }
        m.shoot -= dt;
        if (dist < 22 && m.shoot <= 0 && hasLOS(m)) { m.shoot = (2 + Math.random() * 0.8) * D.shoot; shootArrow(m); }
      } else if (m.kind === 'pillager') {
        if (sees && ad > 13) { tx = ax / ad * K.speed * D.speed; tz = az / ad * K.speed * D.speed; }
        else if (sees && ad < 8) { tx = -ax / ad * K.speed * D.speed; tz = -az / ad * K.speed * D.speed; }
        m.shoot -= dt;
        if (ad < 26 && m.shoot <= 0 && hasLOS(m, huntV)) { m.shoot = (2.4 + Math.random() * 0.8) * D.shoot; shootArrow(m, 4, huntV); }
      } else {
        if (sees && ad > 0.9) { tx = ax / ad * K.speed * D.speed; tz = az / ad * K.speed * D.speed; }
        if (m.kind === 'spider' && sees && dist < 4.5 && m.onGround && m.jumpCd <= 0) { m.jumpCd = 1.2; m.vy = 7; m.vx = dx / dist * 5; m.vz = dz / dist * 5; }
      }
    } else if (K.golem) {
      // Golems fight any monster nearby. Copper and diamond golems tag along with you; iron golems guard their post.
      const golemAttack = K.melee;
      const golemRange = K.range ?? 0;
      let tgt = null, td = golemRange;
      for (const o of hostileActors.near(m.x, m.z, golemRange)) {
        const d2 = Math.hypot(o.x - m.x, o.z - m.z);
        if (d2 < td) { td = d2; tgt = o; }
      }
      m.atk -= dt; m.ai -= dt;
      if (tgt) {
        const ex = tgt.x - m.x, ez = tgt.z - m.z;
        if (td > (golemAttack?.d ?? 0) * 0.7) { tx = ex / td * K.speed; tz = ez / td * K.speed; }
        if (td < (golemAttack?.d ?? 0) && Math.abs(tgt.y - m.y) < 3 && m.atk <= 0) {
          m.atk = golemAttack?.cd ?? 1;
          tgt.vx += ex / (td || 1) * 6; tgt.vz += ez / (td || 1) * 6; tgt.vy = golemAttack?.lift ?? 0;
          pendingHits.push({ m: tgt, d: golemAttack?.dmg ?? 0 });
          sfxAt('hit', tgt.x, tgt.y + 1, tgt.z);
        }
      } else if (K.follow) {
        // snap back to you when it falls far behind or gets stuck on a cliff
        m.stuckT = (dist > 6 && Math.hypot(m.vx, m.vz) < 0.5) ? (m.stuckT || 0) + dt : 0;
        if (dist > 40 || m.stuckT > 2.5) { m.stuckT = 0; m.x = player.x + (Math.random() - 0.5) * 3; m.z = player.z + (Math.random() - 0.5) * 3; m.y = player.y + 0.2; m.vx = m.vy = m.vz = 0; }
        else if (dist > 5) { tx = dx / dist * K.speed; tz = dz / dist * K.speed; }
      } else {
        const hd = Math.hypot(m.hx - m.x, m.hz - m.z) || 0.01;
        if (hd > 18) { tx = (m.hx - m.x) / hd * 1.5; tz = (m.hz - m.z) / hd * 1.5; }
        else {
          if (m.ai <= 0) { m.ai = 3 + Math.random() * 5; m.walk = Math.random() < 0.4; const a = Math.random() * Math.PI * 2; m.dx = Math.cos(a); m.dz = Math.sin(a); }
          if (m.walk) { tx = m.dx; tz = m.dz; }
        }
      }
    } else if (m.kind === 'villager') {
      m.panic -= dt; m.ai -= dt;
      let fx = 0, fz = 0, scared = false;
      for (const o of hostileActors.near(m.x, m.z, 9)) {
        const ox = m.x - o.x, oz = m.z - o.z, od = Math.hypot(ox, oz);
        if (od < 9 && od > 0.01) { fx += ox / od; fz += oz / od; scared = true; }
      }
      const hd = Math.hypot(m.hx - m.x, m.hz - m.z) || 0.01;
      if (scared) { const fl = Math.hypot(fx, fz) || 1; tx = fx / fl * 3.2; tz = fz / fl * 3.2; }
      else if (m.panic > 0) { tx = -dx / dist * 3.4; tz = -dz / dist * 3.4; }
      else if (hd > 18) { tx = (m.hx - m.x) / hd * 1.2; tz = (m.hz - m.z) / hd * 1.2; }
      else {
        if (m.ai <= 0) { m.ai = 2 + Math.random() * 4; m.walk = Math.random() < (isNight ? 0.2 : 0.45); const a = Math.random() * Math.PI * 2; m.dx = Math.cos(a); m.dz = Math.sin(a); }
        if (m.walk) { tx = m.dx * K.speed; tz = m.dz * K.speed; }
      }
    } else {
      m.panic -= dt; m.ai -= dt;
      if (m.panic > 0) { tx = -dx / dist * 3.6; tz = -dz / dist * 3.6; }
      else {
        if (m.ai <= 0) { m.ai = 2 + Math.random() * 4; m.walk = Math.random() < 0.55; const a = Math.random() * Math.PI * 2; m.dx = Math.cos(a); m.dz = Math.sin(a); }
        if (m.walk) { tx = m.dx * K.speed; tz = m.dz * K.speed; }
      }
    }
    const k = Math.min(1, 8 * dt);
    if (m.kind === 'spider' && !m.onGround) { /* keep the pounce going */ }
    else { m.vx += (tx - m.vx) * k; m.vz += (tz - m.vz) * k; }
    m.vy = Math.max(-50, m.vy - 28 * dt);
    m.onGround = false; m.hit = false;
    moveEnt(m, 0, m.vx * dt); moveEnt(m, 2, m.vz * dt); moveEnt(m, 1, m.vy * dt);
    if (m.hit && m.onGround && (!m.hostile || dist > 1)) m.vy = m.hostile ? 8.2 : 7.8;
    if (m.hostile) {
      const ml = K.melee;
      m.atk -= dt;
      if (ml && huntV && m.atk <= 0 && Math.hypot(huntV.x - m.x, huntV.z - m.z) < ml.d && Math.abs(huntV.y - m.y) < 1.6) {
        m.atk = ml.cd;
        huntV.vx += ax / ad * 6; huntV.vz += az / ad * 6; huntV.vy = 4;
        pendingHits.push({ m: huntV, d: ml.dmg });
        sfxAt('hit', huntV.x, huntV.y + 1, huntV.z);
      } else if (ml && dist < ml.d && Math.abs(player.y - m.y) < 1.6 && m.atk <= 0) {
        m.atk = ml.cd;
        damagePlayer(ml.dmg, true);
        player.vx += dx / dist * 6; player.vz += dz / dist * 6; if (player.onGround) player.vy = 4;
      }
      m.face = Math.atan2(ax, az);
    } else if (Math.hypot(m.vx, m.vz) > 0.25) m.face = Math.atan2(m.vx, m.vz);
    else if (m.kind === 'villager' && dist < 4) m.face = Math.atan2(dx, dz);
    m.group.position.set(m.x, m.y, m.z);
    m.group.rotation.y = m.face;
    if (m.hostile) hostileActors.upsert(m);
    if (m.kind === 'villager' || m.golem) defenders.upsert(m);
    const sp = Math.hypot(m.vx, m.vz);
    m.phase += dt * sp * 3.2;
    const sw = Math.sin(m.phase) * Math.min(0.8, sp * 0.5 + 0.05), legs = m.group.userData.legs as THREE.Object3D[];
    for (let j = 0; j < legs.length; j++) legs[j].rotation.x = (legs.length === 4 ? (j === 0 || j === 3) : (j === 0)) ? sw : -sw;
  }
  }
  return stepMobActors;
}
