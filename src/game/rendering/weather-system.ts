import * as THREE from 'three';

export type WeatherMode = 'clear' | 'rain' | 'storm';
export interface WeatherState {
  weather: WeatherMode;
  weatherT: number;
  rainLevel: number;
  rainTarget: number;
  lightningT: number;
  nextBolt: number;
  tod: number;
  isNight: boolean;
  isDay: boolean;
}
interface RainParticle { x: number; y: number; z: number; v: number; minY: number }
interface LightningBolt { mesh: THREE.Line; life: number }
interface WeatherMob { x: number; y: number; z: number }
interface WeatherSound {
  ctx: AudioContext | null;
  noise: AudioBuffer | null;
  sfxGain: GainNode | null;
}
export interface WeatherDependencies {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.Mesh;
  moon: THREE.Mesh;
  dayUniform: { value: number };
  glowMat: THREE.PointsMaterial;
  state: WeatherState;
  sound: WeatherSound;
  getPlayer: () => { x: number; y: number; z: number };
  getDimension: () => string;
  hasChunk: (chunkX: number, chunkZ: number) => boolean;
  topY: (x: number, z: number) => number;
  hasHealth: () => boolean;
  damagePlayer: (damage: number) => void;
  getMobs: () => WeatherMob[];
  damageMob: (mob: WeatherMob, damage: number) => void;
  updateWeatherUI: () => void;
  setLightningOpacity: (opacity: number) => void;
  tone: (options: { f: number; f2?: number; d?: number; type?: OscillatorType; vol?: number; delay?: number }) => void;
  hiss: (options: { d?: number; vol?: number; type?: BiquadFilterType; f?: number; f2?: number; delay?: number }) => void;
}

/** Weather visuals, lightning, daylight, and rain audio, kept outside the game loop. */
export function createWeatherSystem(deps: WeatherDependencies) {
  const { scene, camera, sun, moon, dayUniform, glowMat, state, getPlayer,
    getDimension, topY, hasHealth, damagePlayer, getMobs, damageMob,
    updateWeatherUI, setLightningOpacity, tone, hiss } = deps;
  const Snd = deps.sound;
  const chunkAt = (chunkX: number, chunkZ: number): boolean => deps.hasChunk(chunkX, chunkZ);

  /* ---------- Weather: rain and thunderstorms ---------- */
  const RAIN_N = 700;
  const rainPos = new Float32Array(RAIN_N * 6), rainMeta: RainParticle[] = [];
  for (let i = 0; i < RAIN_N; i++) rainMeta.push({ x: 0, y: -1e9, z: 0, v: 24, minY: 0 });
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMesh = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xb4d0ee, transparent: true, opacity: 0.55, depthWrite: false }));
  rainMesh.frustumCulled = false; rainMesh.visible = false; scene.add(rainMesh);
  const bolts: LightningBolt[] = [];
  const WEATHER_LABEL = { clear: 'Clear', rain: 'Rain', storm: 'Storm' };
  function setWeather(w: WeatherMode): void {
    state.weather = w;
    state.rainTarget = w === 'clear' ? 0 : (w === 'rain' ? 0.75 : 1);
    state.weatherT = w === 'clear' ? 420 + Math.random() * 480 : (w === 'rain' ? 150 + Math.random() * 270 : 100 + Math.random() * 140);
    state.nextBolt = 3 + Math.random() * 6;
    updateWeatherUI();
  }
  function strike(): void {
    const player = getPlayer();
    const a = Math.random() * Math.PI * 2, d = Math.random() < 0.05 ? 1 + Math.random() * 4 : 12 + Math.random() * 55;   // now and then a strike lands right beside you
    const bx = Math.floor(player.x + Math.cos(a) * d), bz = Math.floor(player.z + Math.sin(a) * d);
    if (!chunkAt(bx >> 4, bz >> 4)) return;
    const gy = topY(bx, bz) + 1, pts = [];
    let px = bx + 0.5, pz = bz + 0.5;
    for (let y = gy + 45; y > gy; y -= 3) { pts.push(px, y, pz); px += (Math.random() - 0.5) * 3; pz += (Math.random() - 0.5) * 3; }
    pts.push(bx + 0.5, gy, bz + 0.5);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf2f6ff, fog: false }));
    line.frustumCulled = false; scene.add(line);
    bolts.push({ mesh: line, life: 0.28 });
    state.lightningT = 1;
    const dist = Math.hypot(bx + 0.5 - player.x, bz + 0.5 - player.z), del = Math.min(3.5, dist / 28);
    if (Snd.ctx) {
      const v = Math.max(0.15, 1 - dist / 90);
      hiss({ d: 2.2, vol: 0.6 * v, type: 'lowpass', f: 450, f2: 60, delay: del });
      tone({ f: 58, f2: 28, d: 1.8, type: 'sine', vol: 0.5 * v, delay: del });
      hiss({ d: 0.12, vol: 0.4 * v, type: 'highpass', f: 2500 });
    }
    if (dist < 3.5 && hasHealth() && player.y + 1 > gy - 3) damagePlayer(6);   // a roof overhead protects you
    getMobs().slice().forEach(function (m) { if (Math.hypot(m.x - (bx + 0.5), m.z - (bz + 0.5)) < 3.5) damageMob(m, 12); });
  }
  function updateWeather(dt: number): void {
    state.weatherT -= dt;
    if (state.weatherT <= 0) setWeather(state.weather === 'clear' ? (Math.random() < 0.72 ? 'rain' : 'storm') : 'clear');
    const diff = state.rainTarget - state.rainLevel;
    state.rainLevel += Math.sign(diff) * Math.min(Math.abs(diff), dt / 12);
    if (state.weather === 'storm') { state.nextBolt -= dt; if (state.nextBolt <= 0) { state.nextBolt = 5 + Math.random() * 12; strike(); } }
    if (state.lightningT > 0) state.lightningT = Math.max(0, state.lightningT - dt * 3);
    setLightningOpacity(state.lightningT * 0.5);
    for (let i = bolts.length - 1; i >= 0; i--) {
      bolts[i].life -= dt;
      if (bolts[i].life <= 0) {
        const lightningMesh = bolts[i].mesh;
        scene.remove(lightningMesh);
        lightningMesh.geometry.dispose();
        if (Array.isArray(lightningMesh.material)) {
          lightningMesh.material.forEach(material => material.dispose());
        } else {
          lightningMesh.material.dispose();
        }
        bolts.splice(i, 1);
      }
    }
  }
  // Raindrops fall around the camera and stop at the first surface above them, so roofs keep the rain off
  function columnTop(x: number, z: number): number {
    const bx = Math.floor(x), bz = Math.floor(z);
    return chunkAt(bx >> 4, bz >> 4) ? topY(bx, bz) + 1 : camera.position.y - 40;
  }
  function updateRain(dt: number): void {
    rainMesh.visible = state.rainLevel > 0.02;
    if (!rainMesh.visible) return;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const active = Math.floor(RAIN_N * state.rainLevel);
    for (let i = 0; i < RAIN_N; i++) {
      const d = rainMeta[i], o = i * 6;
      if (i >= active) { for (let k = 0; k < 6; k += 3) { rainPos[o + k] = cx; rainPos[o + k + 1] = cy - 200; rainPos[o + k + 2] = cz; } continue; }
      d.y -= d.v * dt;
      if (d.y < d.minY || Math.abs(d.x - cx) > 18 || Math.abs(d.z - cz) > 18) {
        d.x = cx + (Math.random() - 0.5) * 34; d.z = cz + (Math.random() - 0.5) * 34;
        d.y = cy + 4 + Math.random() * 14; d.v = 22 + Math.random() * 8;
        d.minY = columnTop(d.x, d.z);
      }
      const len = 0.6 + (d.v - 22) * 0.04;
      rainPos[o] = d.x; rainPos[o + 1] = d.y; rainPos[o + 2] = d.z;
      rainPos[o + 3] = d.x + 0.05; rainPos[o + 4] = d.y + len; rainPos[o + 5] = d.z;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  let rainGain: GainNode | null = null, rainFilter: BiquadFilterNode | null = null, rainSndT = 0, rainSheltered = false;
  function updateRainSound(dt: number): void {
    const player = getPlayer();
    if (!Snd.ctx || !Snd.noise) return;
    if (!rainGain) {
      const c = Snd.ctx, src = c.createBufferSource();
      src.buffer = Snd.noise; src.loop = true;
      rainFilter = c.createBiquadFilter(); rainFilter.type = 'lowpass'; rainFilter.frequency.value = 5000;
      rainGain = c.createGain(); rainGain.gain.value = 0;
      src.connect(rainFilter); rainFilter.connect(rainGain); rainGain.connect(Snd.sfxGain!);
      src.start();
    }
    rainSndT -= dt;
    if (rainSndT <= 0) { rainSndT = 0.3; rainSheltered = topY(Math.floor(player.x), Math.floor(player.z)) > player.y + 2; }
    const target = state.rainLevel * (rainSheltered ? 0.05 : 0.16);
    rainGain.gain.value += (target - rainGain.gain.value) * Math.min(1, dt * 2);
    rainFilter!.frequency.value = rainSheltered ? 900 : 5000;
  }

  const DAY = 1200;   // a full day lasts 20 minutes: 10 of daylight, 10 of night
  const cNight = new THREE.Color(0x0a1230), cDay = new THREE.Color(0x87ceeb), cDusk = new THREE.Color(0xf0905a), tmpC = new THREE.Color();
  const sunDir = new THREE.Vector3();
  const cGray = new THREE.Color(0x707a86), cFlash = new THREE.Color(0xdde6ff), tmpG = new THREE.Color();
  function daylight(dt: number): void {
    const dimension = getDimension();
    const fog = scene.fog as THREE.Fog;
    const background = scene.background as THREE.Color;
    state.tod = (state.tod + dt / DAY) % 1;
    const a = state.tod * Math.PI * 2;
    const s = Math.sin(a);
    state.isNight = s < -0.1; state.isDay = s > 0.05;
    const k = Math.max(0, Math.min(1, 0.5 + s * 1.2));
    if (dimension === 'nether') tmpC.set(0x581b18);
    else if (dimension === 'end') tmpC.set(0x160d2b);
    else tmpC.copy(cNight).lerp(cDay, k);
    const dusk = Math.max(0, 1 - Math.abs(s - 0.02) / 0.22) * 0.55;
    if (dimension === 'overworld') tmpC.lerp(cDusk, dusk);
    if (state.rainLevel > 0.01) { tmpG.copy(cNight).lerp(cGray, k); tmpC.lerp(tmpG, state.rainLevel * 0.8); }   // overcast sky
    if (state.lightningT > 0) tmpC.lerp(cFlash, state.lightningT * 0.55);
    fog.near = dimension === 'nether' ? 12 : (dimension === 'end' ? 24 : 30 - 14 * state.rainLevel);
    fog.far = dimension === 'nether' ? 48 : (dimension === 'end' ? 95 : 78 - 30 * state.rainLevel);
    background.copy(tmpC); fog.color.copy(tmpC);
    const lightL = dimension === 'nether' ? 0.62 : (dimension === 'end' ? 0.42 : Math.max(0.28, Math.min(1, 0.55 + s * 0.7)) * (1 - 0.3 * state.rainLevel) + state.lightningT * 0.5);
    dayUniform.value = lightL; glowMat.opacity = 0.2 + (1 - lightL) * 0.75;
    sunDir.set(Math.cos(a), Math.sin(a), 0.25).normalize();
    sun.position.copy(camera.position).addScaledVector(sunDir, 200);
    moon.position.copy(camera.position).addScaledVector(sunDir, -200);
    sun.lookAt(camera.position); moon.lookAt(camera.position);
    sun.visible = s > -0.2 && state.rainLevel < 0.6; moon.visible = s < 0.2 && state.rainLevel < 0.6;
  }
  return { WEATHER_LABEL, setWeather, updateWeather, updateRain,
    updateRainSound, daylight };
}
