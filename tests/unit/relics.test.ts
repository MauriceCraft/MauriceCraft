import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRelicSystem } from '../../src/game/adventure/relics';

function fixture() {
  const scene = new THREE.Scene();
  const player = { x: 0, y: 0, z: 0 };
  let mode = 'adventure';
  const hints: string[] = [];
  const relics = createRelicSystem({
    scene,
    getMode: () => mode,
    getPlayer: () => player,
    getOrGenerateChunk: () => undefined,
    topBlockY: () => 19,
    getBlock: () => 1,
    inStructureZone: () => false,
    grassBlock: 1,
    sandBlock: 4,
    showHint: message => { hints.push(message); },
  });
  return { scene, player, hints, relics, setMode: (next: string) => { mode = next; relics.setMode(); } };
}

describe('Adventure relics', () => {
  it('restores collected relics and keeps them hidden on resume', () => {
    const { relics, scene } = fixture();
    relics.addRelic(12, 19, 7, true);
    relics.addRelic(14, 19, 8, false);
    expect(relics.relics.map(relic => relic.got)).toEqual([true, false]);
    expect(relics.relics.map(relic => relic.group.visible)).toEqual([false, true]);
    relics.clearRelics();
    expect(scene.children).toHaveLength(0);
    expect(relics.relics).toHaveLength(0);
  });

  it('collects each relic once and updates the adventure goal', () => {
    const { relics, player, hints } = fixture();
    relics.addRelic(0.5, 1, 0.5, false);
    player.y = 0.1;
    relics.checkRelics();
    relics.checkRelics();
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('1 of 5');
    expect(relics.objectiveText()).toContain('Relics 1/5');
  });

  it('updates visibility when switching game modes', () => {
    const { relics, setMode } = fixture();
    relics.addRelic(1, 2, 3);
    setMode('creative');
    expect(relics.relics[0].group.visible).toBe(false);
    setMode('adventure');
    expect(relics.relics[0].group.visible).toBe(true);
  });
});
