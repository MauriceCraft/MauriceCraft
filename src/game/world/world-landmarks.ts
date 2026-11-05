import { biomeAt, BIOME_LABELS } from './biomes';
import { nearestVolcano } from './volcanoes';
import { createNaturalFeatures } from './natural-features';

interface Deps {
  getSeed: () => number; getVersion: () => number; getDimension: () => string;
  getPlayer: () => { x: number; z: number };
  heightAt: (x: number, z: number) => number;
  inStructureZone: (x: number, z: number) => boolean;
  seaLevel: number; worldHeight: number;
}
/** The same deterministic feature regions are queried for generation and HUD labels. */
export function createLandmarkFinder(deps: Deps) {
  const natural = createNaturalFeatures({
    getSeed: deps.getSeed, getGeneratorVersion: deps.getVersion,
    biomeAt: (x, z) => biomeAt(x, z, deps.getSeed()),
    heightAt: deps.heightAt, inStructureZone: deps.inStructureZone,
    seaLevel: deps.seaLevel, maxHeight: deps.worldHeight,
    waterBlock: 34, lavaBlock: 35,
  });
  function biomeLabel(): string {
    const dim = deps.getDimension();
    if (dim !== 'overworld') return dim === 'nether' ? 'Nether' : 'The End';
    if (deps.getVersion() < 2) return 'Classic terrain';
    const p = deps.getPlayer();
    return BIOME_LABELS[biomeAt(Math.floor(p.x), Math.floor(p.z), deps.getSeed())];
  }
  function nearestLandmark(): string {
    if (deps.getDimension() !== 'overworld' || deps.getVersion() < 2) return '';
    const { x, z } = deps.getPlayer();
    const seed = deps.getSeed();
    let name = '', closest = 241;
    if (deps.getVersion() >= 3) {
      const v = nearestVolcano(x, z, seed, deps.worldHeight, 240);
      if (v) { name = 'Volcano'; closest = v.distance; }
    }
    const lrx = Math.floor(x / 96), lrz = Math.floor(z / 96);
    for (let rz = lrz - 2; rz <= lrz + 2; rz++) for (let rx = lrx - 2; rx <= lrx + 2; rx++) {
      const lake = natural.lakeFor(rx, rz);
      if (!lake) continue;
      const distance = Math.round(Math.hypot(x - lake.x, z - lake.z));
      if (distance >= closest) continue;
      const desert = biomeAt(lake.x, lake.z, seed) === 'desert';
      name = lake.liquid === 'lava' ? 'Lava lake' : desert ? 'Oasis' : 'Lake';
      closest = distance;
    }
    const frx = Math.floor(x / 112), frz = Math.floor(z / 112);
    for (let rz = frz - 2; rz <= frz + 2; rz++) for (let rx = frx - 2; rx <= frx + 2; rx++) {
      const fall = natural.cascadeFor(rx, rz);
      if (!fall) continue;
      const distance = Math.round(Math.hypot(x - fall.x, z - fall.z));
      if (distance >= closest) continue;
      name = fall.liquid === 'lava' ? 'Lavafall' : 'Waterfall';
      closest = distance;
    }
    return name ? name + ' ' + closest + ' m' : '';
  }
  return { biomeLabel, nearestLandmark };
}
