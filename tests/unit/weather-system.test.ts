import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createWeatherSystem, type WeatherState } from '../../src/game/rendering/weather-system';

function fixture() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x87ceeb, 30, 78);
  scene.background = new THREE.Color(0x87ceeb);
  const camera = new THREE.PerspectiveCamera();
  const sun = new THREE.Mesh(), moon = new THREE.Mesh();
  const state: WeatherState = {
    weather: 'clear', weatherT: 420, rainLevel: 0, rainTarget: 0,
    lightningT: 0, nextBolt: 8, tod: 0.22, isNight: false, isDay: true,
  };
  const glowMat = new THREE.PointsMaterial();
  let weatherUiUpdates = 0;
  let lightningOpacity = -1;
  const system = createWeatherSystem({
    scene, camera, sun, moon, dayUniform: { value: 1 }, glowMat, state,
    sound: { ctx: null, noise: null, sfxGain: null },
    getPlayer: () => ({ x: 0, y: 20, z: 0 }),
    getDimension: () => 'overworld', hasChunk: () => false, topY: () => 19,
    hasHealth: () => false, damagePlayer: () => undefined,
    getMobs: () => [], damageMob: () => undefined,
    updateWeatherUI: () => { weatherUiUpdates++; },
    setLightningOpacity: value => { lightningOpacity = value; },
    tone: () => undefined, hiss: () => undefined,
  });
  return { system, state, scene, sun, moon,
    getUpdates: () => weatherUiUpdates, getOpacity: () => lightningOpacity };
}
describe('weather and daylight', () => {
  it('sets rain and clears weather without needing browser audio', () => {
    const { system, state, getUpdates } = fixture();
    system.setWeather('rain');
    expect(state.weather).toBe('rain');
    expect(state.rainTarget).toBe(0.75);
    system.updateWeather(0.02);
    expect(state.rainLevel).toBeGreaterThan(0);
    expect(() => system.updateRainSound(0.02)).not.toThrow();
    system.setWeather('clear');
    expect(state.rainTarget).toBe(0);
    expect(getUpdates()).toBe(2);
  });
  it('updates night state and colored sky without crashing headless', () => {
    const { system, state, scene } = fixture();
    state.tod = 0.75;
    system.daylight(0);
    expect(state.isNight).toBe(true);
    expect(scene.background).toBeInstanceOf(THREE.Color);
    state.tod = 0.25;
    system.daylight(0);
    expect(state.isDay).toBe(true);
  });
  it('updates lightning overlay and rain particles with bounded work', () => {
    const { system, state, getOpacity } = fixture();
    state.lightningT = 1;
    system.updateWeather(0.1);
    expect(getOpacity()).toBeGreaterThan(0);
    expect(() => system.updateRain(0.1)).not.toThrow();
  });
});
