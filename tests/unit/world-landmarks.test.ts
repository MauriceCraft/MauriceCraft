import { describe, expect, it } from 'vitest';
import { createLandmarkFinder } from '../../src/game/world/world-landmarks';

describe('landmark-aware HUD', () => {
  it('labels classic saves, biome worlds, and dimensions without false volcano alerts', () => {
    let version = 1, dimension = 'overworld';
    const finder = createLandmarkFinder({
      getSeed: () => 112, getVersion: () => version, getDimension: () => dimension,
      getPlayer: () => ({ x: 0, z: 0 }), heightAt: () => 23,
      inStructureZone: () => false, seaLevel: 14, worldHeight: 48,
    });
    expect(finder.biomeLabel()).toContain('Classic');
    expect(finder.nearestLandmark()).toBe('');
    version = 3;
    expect(finder.biomeLabel()).not.toContain('Classic');
    dimension = 'nether';
    expect(finder.biomeLabel()).toBe('Nether');
    expect(finder.nearestLandmark()).toBe('');
  });
});
