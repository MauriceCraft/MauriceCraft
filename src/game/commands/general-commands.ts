import type { SpawnMob } from '../entities/mob-spawning';

type RegisteredCommand = { name: string; usage: string; desc: string };
type Register = (
  aliases: string[],
  usage: string,
  description: string,
  handler: (args: string[]) => string | void,
  choices?: (argumentIndex: number, args: string[]) => string[],
) => void;

export interface GeneralCommandsDependencies {
  register: Register;
  commands: Record<string, RegisteredCommand>;
  player: { x: number; y: number; z: number; yaw: number };
  maxHeight: number;
  getDimension: () => 'overworld' | 'nether' | 'end';
  buildPortalFrame: (dimension: 'overworld' | 'nether', x: number, y: number, z: number) => { x: number; y: number; z: number };
  changeDimension: (dimension: 'overworld' | 'nether' | 'end') => void;
  saveWorld: () => Promise<unknown>;
  refreshWorlds: () => void;
  isStorageAvailable: () => boolean;
  slug: (name: string) => string;
  mobs: SpawnMob[];
  kinds: Readonly<Record<string, { hostile?: boolean; r: number; h: number }>>;
  jobs: readonly string[];
  getDifficultyCap: () => number;
  hasHealth: () => boolean;
  setHealth: (hp: number) => void;
  damagePlayer: (damage: number) => void;
  spawnSpot: () => [number, number, number];
  getOrGenerateChunk: (cx: number, cz: number) => unknown;
  topY: (x: number, z: number) => number;
  collides: (x: number, y: number, z: number, radius?: number, height?: number) => boolean;
  addMob: (kind: string, x: number, y: number, z: number, options?: { job?: string } | null) => SpawnMob;
  removeMobAt: (index: number) => void;
}

/** Register UI-independent built-in commands without owning game state. */
export function registerGeneralCommands(deps: GeneralCommandsDependencies): void {
  const register = deps.register, CMDS = deps.commands;
  const { player, mobs, kinds: KINDS, jobs: JOBS } = deps;
  const { slug, saveWorld, refreshWorlds, buildPortalFrame, changeDimension } = deps;
  const { hasHealth, damagePlayer, spawnSpot, topY, collides, addMob, removeMobAt } = deps;
  const getOrGen = deps.getOrGenerateChunk;
  const mobNames = () => Object.keys(KINDS);

register(['help', '?'], '/help [command]', 'List the commands, or explain one', function (a) {
  if (a[0]) {
    const c = CMDS[a[0].toLowerCase().replace(/^\//, '')];
    if (!c) throw new Error('No command called "' + a[0] + '"');
    return c.usage + '  -  ' + c.desc;
  }
  const names: string[] = []; Object.keys(CMDS).forEach(function (k) { if (CMDS[k].name === k) names.push(k); });
  return 'Commands: ' + names.sort().map(function (n) { return '/' + n; }).join('  ') + '   (try /help <command>)';
}, function () { return Object.keys(CMDS); });

register(['portal'], '/portal [build]', 'Build an obsidian Nether portal frame in front of you; walk through it to travel', function (a) {
  const dimension = deps.getDimension();
  if (dimension === 'end') throw new Error('Nether portals do not work in the End. Return to the Overworld first.');
  if (a.length && a[0].toLowerCase() !== 'build') throw new Error('Usage: /portal [build]');
  const cx = Math.round(player.x - Math.sin(player.yaw) * 3);
  const cz = Math.round(player.z - Math.cos(player.yaw) * 3);
  const by = Math.max(1, Math.min(deps.maxHeight - 6, Math.floor(player.y) - 1));
  const made = buildPortalFrame(dimension, cx, by, cz);
  saveWorld();
  return 'Built an obsidian Nether portal frame at ' + made.x + ' ' + made.y + ' ' + made.z + '. Walk through the doorway to travel.';
}, function () { return ['build']; });
register(['dimension', 'dim'], '/dimension <overworld|nether|end>', 'Travel between the Overworld, Nether, and End', function (a) {
  const dimension = deps.getDimension();
  const target = (a[0] || '').toLowerCase();
  if (['overworld', 'nether', 'end'].indexOf(target) < 0) throw new Error('Usage: /dimension <overworld|nether|end>');
  if (target === dimension) return 'You are already in the ' + target + '.';
  changeDimension(target as 'overworld' | 'nether' | 'end');
  return 'Entered the ' + target + '.';
}, function () { return ['overworld', 'nether', 'end']; });

register(['spawn', 'summon'], '/spawn <creature> [count]', 'Spawn creatures in front of you', function (a) {
  if (!a[0]) throw new Error('Usage: /spawn <creature> [count]. Creatures: ' + mobNames().join(', '));
  const q = slug(a[0]).replace(/_/g, '');
  let kind = mobNames().filter(function (k) { return k === q; })[0] || (q === 'golem' ? 'irongolem' : null);
  if (!kind) { const c = mobNames().filter(function (k) { return k.indexOf(q) === 0; }); if (c.length === 1) kind = c[0]; }
  if (!kind) throw new Error('Unknown creature "' + a[0] + '". Creatures: ' + mobNames().join(', '));
  const K = KINDS[kind];
  if (K.hostile && hasHealth() && deps.getDifficultyCap() === 0) throw new Error('Monsters cannot spawn on Peaceful');
  const n = Math.max(1, Math.min(20, Math.floor(+(a[1] || 1)) || 1)), sp = spawnSpot();
  let made = 0;
  for (let i = 0; i < n; i++) {
    const x = sp[0] + (Math.random() - 0.5) * (n > 1 ? 4 : 0), z = sp[2] + (Math.random() - 0.5) * (n > 1 ? 4 : 0);
    getOrGen(Math.floor(x) >> 4, Math.floor(z) >> 4);
    let y = topY(Math.floor(x), Math.floor(z)) + 1.01;
    for (let k = 0; k < 3 && collides(x, y, z, K.r, K.h); k++) y += 1;
    if (collides(x, y, z, K.r, K.h)) continue;
    const m = addMob(kind, x, y, z, kind === 'villager' ? { job: JOBS[Math.floor(Math.random() * JOBS.length)] } : null);
    m.persist = true; m.hx = x; m.hz = z; made++;
  }
  return made ? 'Spawned ' + made + ' ' + kind + (made === 1 ? '' : 's') : 'There was no room to spawn that here';
}, function (i) { return i === 1 ? mobNames() : []; });
register(['kill'], '/kill [hostile|passive|villagers|golems|all|me]', 'Remove creatures (or yourself)', function (a) {
  const what = (a[0] || 'hostile').toLowerCase();
  if (what === 'me' || what === 'self') {
    if (!hasHealth()) throw new Error('You can only do that in Survival or Adventure');
    deps.setHealth(1); damagePlayer(1); return 'Ouch.';
  }
  const selectors: Record<string, (mob: SpawnMob) => boolean> = { hostile: function (m) { return m.hostile; }, passive: function (m) { return !m.hostile && !m.golem && m.kind !== 'villager'; }, villagers: function (m) { return m.kind === 'villager'; }, golems: function (m) { return m.golem; }, all: function () { return true; } };
  const sel = selectors[what];
  if (!sel) throw new Error('Usage: /kill [hostile|passive|villagers|golems|all|me]');
  let n = 0;
  for (let i = mobs.length - 1; i >= 0; i--) if (sel(mobs[i])) { removeMobAt(i); n++; }
  return 'Removed ' + n + ' creature' + (n === 1 ? '' : 's');
}, function () { return ['hostile', 'passive', 'villagers', 'golems', 'all', 'me']; });

register(['save'], '/save', 'Save the world now', function () { saveWorld().then(refreshWorlds); return deps.isStorageAvailable() ? 'Saving the world...' : 'Saving is not available in this browser'; });
register(['say'], '/say <message>', 'Write a message in the chat', function (a) { return '[You] ' + a.join(' '); });

}
