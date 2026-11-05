import * as THREE from 'three';

export interface Relic {
  x: number;
  y: number;
  z: number;
  got: boolean;
  group: THREE.Group;
  gem: THREE.Mesh;
}
export interface RelicDependencies {
  scene: THREE.Scene;
  getMode: () => string;
  getPlayer: () => { x: number; y: number; z: number };
  getOrGenerateChunk: (chunkX: number, chunkZ: number) => unknown;
  topBlockY: (x: number, z: number) => number;
  getBlock: (x: number, y: number, z: number) => number;
  inStructureZone: (x: number, z: number) => boolean;
  grassBlock: number;
  sandBlock: number;
  showHint: (message: string, milliseconds: number) => void;
  random?: () => number;
}

export function createRelicSystem(deps: RelicDependencies) {
  const RELIC_COUNT = 5;
  const relics: Relic[] = [];
  let collected = 0;
  const random = deps.random ?? Math.random;
  const gemGeometry = new THREE.OctahedronGeometry(0.38);
  const gemMaterial = new THREE.MeshBasicMaterial({ color: 0xffd34d });
  const beamGeometry = new THREE.CylinderGeometry(0.07, 0.07, 40, 8);
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe28a, transparent: true, opacity: 0.4, fog: false, depthWrite: false,
  });

  function clearRelics(): void {
    for (const relic of relics) deps.scene.remove(relic.group);
    relics.length = 0;
    collected = 0;
  }

  function addRelic(x: number, y: number, z: number, got = false): void {
    const group = new THREE.Group();
    const gem = new THREE.Mesh(gemGeometry, gemMaterial);
    group.add(gem);
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.position.y = 20;
    group.add(beam);
    const relic: Relic = { x, y, z, group, gem, got: Boolean(got) };
    group.position.set(x, y, z);
    group.visible = deps.getMode() === 'adventure' && !relic.got;
    deps.scene.add(group);
    relics.push(relic);
    if (relic.got) collected++;
  }

  function createRelics(): void {
    clearRelics();
    let minimumDistance = 30;
    for (let attempt = 0; attempt < 600 && relics.length < RELIC_COUNT; attempt++) {
      if (attempt === 300) minimumDistance = 14;
      const angle = random() * Math.PI * 2;
      const distance = 28 + random() * 75;
      const blockX = Math.floor(Math.cos(angle) * distance);
      const blockZ = Math.floor(Math.sin(angle) * distance);
      deps.getOrGenerateChunk(blockX >> 4, blockZ >> 4);
      const groundY = deps.topBlockY(blockX, blockZ);
      const surface = deps.getBlock(blockX, groundY, blockZ);
      if (surface !== deps.grassBlock && surface !== deps.sandBlock) continue;
      if (deps.inStructureZone(blockX, blockZ)) continue;
      if (relics.some(relic => Math.hypot(relic.x - blockX, relic.z - blockZ) < minimumDistance)) continue;
      addRelic(blockX + 0.5, groundY + 2, blockZ + 0.5);
    }
  }

  function updateRelics(deltaSeconds: number, elapsedSeconds: number): void {
    for (const relic of relics) {
      if (relic.got) continue;
      relic.gem.rotation.y += deltaSeconds * 1.6;
      relic.gem.position.y = Math.sin(elapsedSeconds * 2 + relic.x) * 0.15;
    }
  }

  function checkRelics(): void {
    const player = deps.getPlayer();
    for (const relic of relics) {
      if (relic.got) continue;
      const distanceX = player.x - relic.x;
      const distanceY = player.y + 0.9 - relic.y;
      const distanceZ = player.z - relic.z;
      if (distanceX * distanceX + distanceY * distanceY + distanceZ * distanceZ >= 2.6 * 2.6) continue;
      relic.got = true;
      relic.group.visible = false;
      collected++;
      if (collected >= RELIC_COUNT) deps.showHint('All 5 relics found. Adventure complete!', 10000);
      else deps.showHint('Relic found: ' + collected + ' of ' + RELIC_COUNT, 3000);
    }
  }

  function objectiveText(): string {
    if (collected >= RELIC_COUNT) return 'All relics found!';
    const player = deps.getPlayer();
    let nearestDistance = Infinity;
    for (const relic of relics) {
      if (!relic.got) nearestDistance = Math.min(nearestDistance, Math.hypot(relic.x - player.x, relic.z - player.z));
    }
    return 'Relics ' + collected + '/' + RELIC_COUNT +
      (Number.isFinite(nearestDistance) ? '\nNearest: ' + Math.round(nearestDistance) + ' m' : '');
  }

  function setMode(): void {
    for (const relic of relics) relic.group.visible = deps.getMode() === 'adventure' && !relic.got;
  }

  return { RELIC_COUNT, relics, addRelic, clearRelics, createRelics, updateRelics,
    checkRelics, objectiveText, setMode };
}
