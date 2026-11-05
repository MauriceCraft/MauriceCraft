import type { WorldRecord } from '../storage/world-storage';
import type { PortalFrame } from '../portals/frame';
import { restorePortals } from '../portals/persistence';
import type { SpawnMob } from '../entities/mob-spawning';

interface SavedPlayer {
  x: number; y: number; z: number;
  yaw: number; pitch: number; fly: boolean;
}
interface SavedGolem { kind: string; x: number; y: number; z: number; hp: number; hx: number; hz: number }
interface SavedRelic { x: number; y: number; z: number; got: boolean }
type SavedWorld = WorldRecord & {
  dimension?: string; enderDragonDefeated?: boolean; portals?: unknown;
  player?: SavedPlayer; inv?: Record<string, number>; hotbar?: number[];
  selected?: number; tod?: number; toolWear?: Record<string, number>;
  mode?: string; difficulty?: string;
  spawn?: { x: number; y: number; z: number } | null;
  omen?: boolean; weather?: { w: string; t: number; r: number };
  relics?: SavedRelic[]; hp?: number; hunger?: number; sat?: number; golems?: SavedGolem[];
};

export interface RestorableGameState {
  dimension: string;
  enderDragonDefeated: boolean;
  selected: number; tod: number;
  mode: string; difficulty: string;
  spawnPoint: { x: number; y: number; z: number } | null;
  omen: boolean;
  weather: string; weatherT: number; rainLevel: number; rainTarget: number;
  ready: boolean; dead: boolean; hp: number; hunger: number; sat: number;
}

export interface WorldRestoreDependencies {
  state: RestorableGameState;
  player: SavedPlayer & { vx: number; vy: number; vz: number; fallStart: number | null };
  portals: PortalFrame[];
  inventory: Record<string, number>;
  toolWear: Record<string, number>;
  hotbar: number[];
  allBlocks: readonly number[];
  savedChunks: Map<number, Uint8Array>;
  validDifficulties: Readonly<Record<string, unknown>>;
  weatherLabels: Readonly<Record<string, string>>;
  kinds: Readonly<Record<string, unknown>>;
  mobs: SpawnMob[];
  relics: readonly unknown[];
  maximumHealth: number;
  resetWorld: (seed: number, x: number, z: number, generatorVersion?: number) => void;
  clearPortalVisuals: () => void;
  showPortalVisual: (portal: PortalFrame) => void;
  clearMobs: () => void;
  clearRelics: () => void;
  addRelic: (x: number, y: number, z: number, got?: boolean) => void;
  createRelics: () => void;
  setMode: (mode: string) => void;
  updateHearts: () => void;
  renderFood: () => void;
  updateWeatherUI: () => void;
  addMob: (kind: string, x: number, y: number, z: number, opts?: object | null) => SpawnMob;
  hasChunk: (x: number, z: number) => boolean;
  respawn: () => void;
  random?: () => number;
}

function resetNumbers(values: Record<string, number>): void {
  for (const key in values) delete values[key];
}
function restoreNumbers(values: Record<string, number>, source?: Record<string, number>): void {
  resetNumbers(values);
  for (const [key, value] of Object.entries(source ?? {})) values[key] = value;
}

/** Interpret original saved-world fields without changing the on-disk format. */
export function createWorldRestore(deps: WorldRestoreDependencies) {
  const { state, player, portals, inventory, hotbar, toolWear } = deps;
  const random = deps.random ?? Math.random;

  function applyWorld(world: WorldRecord): void {
    const m = world as SavedWorld;
    const p = m.player || { x: 0.5, y: 60, z: 0.5, yaw: 0, pitch: 0, fly: false };
    state.dimension = ['overworld', 'nether', 'end'].includes(m.dimension ?? '') ? m.dimension! : 'overworld';
    state.enderDragonDefeated = !!m.enderDragonDefeated;
    portals.length = 0;
    portals.push(...restorePortals(m.portals));
    deps.clearPortalVisuals();
    portals.forEach(deps.showPortalVisual);
    deps.resetWorld(m.seed, Math.floor(p.x / 16), Math.floor(p.z / 16), m.generatorVersion ?? 1);
    deps.clearMobs();
    player.x = p.x; player.y = p.y; player.z = p.z;
    player.vx = player.vy = player.vz = 0;
    player.yaw = p.yaw || 0; player.pitch = p.pitch || 0; player.fallStart = null;
    restoreNumbers(inventory, m.inv);
    if (m.hotbar && m.hotbar.length === 9) for (let i = 0; i < 9; i++) hotbar[i] = m.hotbar[i];
    state.selected = m.selected || 0;
    state.tod = typeof m.tod === 'number' ? m.tod : 0.22;
    restoreNumbers(toolWear, m.toolWear);
    state.mode = m.mode || 'creative';
    state.difficulty = m.difficulty && deps.validDifficulties[m.difficulty] ? m.difficulty : 'normal';
    state.spawnPoint = m.spawn || null;
    state.omen = !!m.omen;
    if (m.weather && deps.weatherLabels[m.weather.w]) {
      state.weather = m.weather.w; state.weatherT = m.weather.t || 300;
      state.rainLevel = m.weather.r || 0;
    } else {
      state.weather = 'clear'; state.weatherT = 420; state.rainLevel = 0;
    }
    state.rainTarget = state.weather === 'clear' ? 0 : (state.weather === 'cloudy' ? 0.16 : state.weather === 'rain' ? 0.75 : 1);
    deps.updateWeatherUI();
    deps.clearRelics();
    (m.relics || []).forEach(r => deps.addRelic(r.x, r.y, r.z, r.got));
    state.ready = true; state.dead = false;
    if (!deps.relics.length) deps.createRelics();
    deps.setMode(state.mode);
    state.hp = (m.hp ?? 0) > 0 ? m.hp! : deps.maximumHealth;
    deps.updateHearts();
    state.hunger = typeof m.hunger === 'number' ? m.hunger : 20;
    state.sat = typeof m.sat === 'number' ? m.sat : 5;
    deps.renderFood();
    (m.golems || []).forEach(g => {
      if (!deps.kinds[g.kind] || Math.hypot(g.x - player.x, g.z - player.z) > 60 ||
        !deps.hasChunk(Math.floor(g.x) >> 4, Math.floor(g.z) >> 4)) return;
      const mob = deps.addMob(g.kind, g.x, g.y, g.z, null);
      mob.hp = g.hp; mob.persist = true; mob.hx = g.hx; mob.hz = g.hz;
    });
    if (state.mode === 'creative') player.fly = !!p.fly;
  }

  function prepareNewWorld(world: WorldRecord): void {
    deps.savedChunks.clear();
    deps.resetWorld(world.seed, 0, 0, world.generatorVersion ?? 1);
    state.spawnPoint = null;
    state.omen = false;
    state.weather = 'clear';
    state.weatherT = 190 + random() * 340;
    state.rainLevel = 0;
    state.rainTarget = 0;
    deps.updateWeatherUI();
    deps.respawn();
    deps.clearMobs();
    resetNumbers(inventory);
    for (let i = 0; i < 9; i++) hotbar[i] = deps.allBlocks[i];
    state.selected = 0;
    state.tod = 0.22;
    resetNumbers(toolWear);
    deps.createRelics();
    state.ready = true;
    state.dead = false;
    deps.setMode(state.mode);
  }

  return { applyWorld, prepareNewWorld };
}
