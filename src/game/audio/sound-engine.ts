/** Procedurally generated game audio. No audio files or external sound assets. */
export interface PlayerAudioPosition { x: number; y: number; z: number; yaw: number }
interface SoundState {
  ctx: AudioContext | null;
  master: GainNode | null;
  sfxGain: GainNode | null;
  musicGain: GainNode | null;
  noise: AudioBuffer | null;
  sfx: boolean;
  music: boolean;
  nextMusic: number;
}
interface ToneOptions {
  f: number;
  f2?: number;
  d?: number;
  type?: OscillatorType;
  vol?: number;
  pan?: number;
  delay?: number;
  attack?: number;
  lp?: number;
  vib?: number;
  music?: boolean;
}
interface HissOptions {
  d?: number;
  vol?: number;
  type?: BiquadFilterType;
  f?: number;
  f2?: number;
  q?: number;
  pan?: number;
  delay?: number;
}

/** Lazily initialises Web Audio only after a player gesture permits playback. */
export function createAudioEngine(
  getPlayer: () => PlayerAudioPosition,
  getNight: () => boolean,
) {

  const Snd: SoundState = { ctx: null, master: null, sfxGain: null, musicGain: null, noise: null, sfx: true, music: true, nextMusic: 3 };
  try { const sv = JSON.parse(localStorage.getItem('blockcraft-sound') || 'null'); if (sv) { Snd.sfx = sv.sfx !== false; Snd.music = sv.music !== false; } } catch { /* storage unavailable */ }
  function saveSound() { try { localStorage.setItem('blockcraft-sound', JSON.stringify({ sfx: Snd.sfx, music: Snd.music })); } catch { /* ignore */ } }
  function applySound() { if (!Snd.ctx) return; Snd.sfxGain!.gain.value = Snd.sfx ? 1 : 0; Snd.musicGain!.gain.value = Snd.music ? 0.5 : 0; }
  function audioInit() {
    if (Snd.ctx) { if (Snd.ctx.state === 'suspended') Snd.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const c = new AC(); Snd.ctx = c;
      Snd.master = c.createGain(); Snd.master.gain.value = 0.7; Snd.master.connect(c.destination);
      Snd.sfxGain = c.createGain(); Snd.sfxGain.connect(Snd.master);
      Snd.musicGain = c.createGain(); Snd.musicGain.connect(Snd.master);
      const buf = c.createBuffer(1, c.sampleRate, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      Snd.noise = buf; applySound();
    } catch { Snd.ctx = null; }
  }
  function outNode(vol: number, pan?: number, music?: boolean): GainNode {
    const c = Snd.ctx!, g = c.createGain(); g.gain.value = vol;
    let last: AudioNode = g;
    if (pan && c.createStereoPanner) { const pn = c.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(pn); last = pn; }
    last.connect((music ? Snd.musicGain : Snd.sfxGain)!);
    return g;
  }
  // o: f (start Hz), f2 (end Hz), d (seconds), type, vol, pan, delay, attack, lp (lowpass Hz), vib (Hz), music
  function tone(o: ToneOptions): void {
    const c = Snd.ctx;
    if (!c || (!o.music && !Snd.sfx)) return;
    const t0 = c.currentTime + (o.delay || 0), d = o.d || 0.2, vol = o.vol || 0.2, a = o.attack || 0.01;
    const g = outNode(0.0001, o.pan, o.music), osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + d);
    let node: AudioNode = osc;
    if (o.lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; osc.connect(fl); node = fl; }
    if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.vib; lg.gain.value = o.f * 0.05; l.connect(lg); lg.connect(osc.frequency); l.start(t0); l.stop(t0 + d + 0.05); }
    node.connect(g);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    osc.start(t0); osc.stop(t0 + d + 0.05);
  }
  // o: d, vol, type (filter), f, f2, q, pan, delay
  function hiss(o: HissOptions): void {
    const c = Snd.ctx;
    if (!c || !Snd.sfx || !Snd.noise) return;
    const t0 = c.currentTime + (o.delay || 0), d = o.d || 0.15;
    const src = c.createBufferSource(); src.buffer = Snd.noise; src.loop = true;
    const fl = c.createBiquadFilter(); fl.type = o.type || 'lowpass'; fl.Q.value = o.q || 0.8;
    fl.frequency.setValueAtTime(o.f || 800, t0);
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(Math.max(30, o.f2), t0 + d);
    const g = outNode(0.0001, o.pan);
    src.connect(fl); fl.connect(g);
    g.gain.setValueAtTime(o.vol || 0.2, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    src.start(t0, Math.random() * 0.4); src.stop(t0 + d + 0.05);
  }
  function matOf(b: number): string {
    if (b === 3 || b === 8 || b === 9 || b === 10 || b === 11 || b === 14 || b === 15 || b === 16 || (b >= 27 && b <= 33)) return 'stone';
    if (b === 5 || b === 7 || b === 17 || b === 18) return 'wood';
    if (b === 6) return 'leaf';
    if (b === 4 || b === 12) return 'sand';
    return 'soft';
  }
  function sfx(name: string, v?: number, pan?: number, arg?: number): void {
    if (!Snd.ctx || !Snd.sfx) return;
    v = (v === undefined) ? 1 : v;
    if (v < 0.03) return;
    pan = pan || 0;
    const m = matOf(arg ?? -1);
    switch (name) {
      case 'break':
        if (m === 'stone') { hiss({ d: 0.2, vol: 0.35 * v, type: 'bandpass', f: 1400, f2: 400, q: 1, pan: pan }); tone({ f: 95, f2: 55, d: 0.12, type: 'square', vol: 0.1 * v, pan: pan }); }
        else if (m === 'wood') { tone({ f: 230, f2: 120, d: 0.1, type: 'square', vol: 0.12 * v, pan: pan }); hiss({ d: 0.1, vol: 0.2 * v, type: 'bandpass', f: 2000, pan: pan }); }
        else if (m === 'leaf') hiss({ d: 0.12, vol: 0.18 * v, type: 'highpass', f: 3000, pan: pan });
        else if (m === 'sand') hiss({ d: 0.16, vol: 0.22 * v, type: 'bandpass', f: 2500, pan: pan });
        else hiss({ d: 0.16, vol: 0.3 * v, type: 'lowpass', f: 700, f2: 300, pan: pan });
        break;
      case 'place': tone({ f: 150, f2: 90, d: 0.09, type: 'triangle', vol: 0.18 * v, pan: pan }); hiss({ d: 0.07, vol: 0.12 * v, type: 'lowpass', f: 900, pan: pan }); break;
      case 'step':
        if (m === 'stone') hiss({ d: 0.05, vol: 0.08 * v, type: 'bandpass', f: 1500, pan: pan });
        else if (m === 'wood') tone({ f: 170, f2: 110, d: 0.05, type: 'triangle', vol: 0.1 * v, pan: pan });
        else if (m === 'sand') hiss({ d: 0.07, vol: 0.06 * v, type: 'highpass', f: 2000, pan: pan });
        else hiss({ d: 0.07, vol: 0.09 * v, type: 'lowpass', f: 500, pan: pan });
        break;
      case 'land': hiss({ d: 0.16, vol: 0.28 * v, type: 'lowpass', f: 420, pan: pan }); break;
      case 'hurt': tone({ f: 260, f2: 110, d: 0.24, type: 'sawtooth', vol: 0.2 * v, lp: 900 }); hiss({ d: 0.12, vol: 0.15 * v, type: 'bandpass', f: 900 }); break;
      case 'eat': for (let i = 0; i < 3; i++) hiss({ d: 0.05, vol: 0.2 * v, type: 'bandpass', f: 1200, q: 2, delay: i * 0.1 }); break;
      case 'explode':
        hiss({ d: 1.2, vol: 0.85 * v, type: 'lowpass', f: 1300, f2: 60, pan: pan });
        tone({ f: 75, f2: 25, d: 1.0, type: 'sine', vol: 0.8 * v, pan: pan });
        hiss({ d: 0.3, vol: 0.3 * v, type: 'highpass', f: 2500, pan: pan });
        break;
      case 'throw': hiss({ d: 0.25, vol: 0.18 * v, type: 'bandpass', f: 400, f2: 2500, q: 1.5 }); break;
      case 'fuse': hiss({ d: 0.07, vol: 0.14 * v, type: 'highpass', f: 5000, pan: pan }); break;
      case 'pop': tone({ f: 520, f2: 880, d: 0.12, type: 'sine', vol: 0.2 * v }); break;
      case 'click': tone({ f: 800, f2: 600, d: 0.04, type: 'sine', vol: 0.1 }); break;
      case 'hit': hiss({ d: 0.08, vol: 0.28 * v, type: 'bandpass', f: 900, pan: pan }); tone({ f: 200, f2: 100, d: 0.06, type: 'square', vol: 0.1 * v, pan: pan }); break;
      case 'die': tone({ f: 220, f2: 50, d: 0.4, type: 'sawtooth', vol: 0.18 * v, lp: 700, pan: pan }); break;
      case 'arrow': hiss({ d: 0.2, vol: 0.16 * v, type: 'bandpass', f: 700, f2: 3000, q: 1.5, pan: pan }); break;
      case 'yes': tone({ f: 190, f2: 260, d: 0.18, type: 'sawtooth', vol: 0.16, lp: 900 }); tone({ f: 250, f2: 310, d: 0.22, type: 'sawtooth', vol: 0.16, lp: 900, delay: 0.17 }); break;
      case 'no': tone({ f: 200, f2: 130, d: 0.36, type: 'sawtooth', vol: 0.16, lp: 800 }); break;
      case 'cow': tone({ f: 130, f2: 92, d: 0.8, type: 'sawtooth', vol: 0.24 * v, lp: 520, vib: 5, pan: pan }); break;
      case 'pig': tone({ f: 320, f2: 200, d: 0.1, type: 'square', vol: 0.14 * v, lp: 1200, pan: pan }); tone({ f: 300, f2: 190, d: 0.12, type: 'square', vol: 0.14 * v, lp: 1200, delay: 0.14, pan: pan }); break;
      case 'sheep': tone({ f: 300, f2: 250, d: 0.6, type: 'sawtooth', vol: 0.18 * v, lp: 1300, vib: 14, pan: pan }); break;
      case 'chicken': for (let i = 0; i < 3; i++) tone({ f: 900, f2: 650, d: 0.07, type: 'square', vol: 0.1 * v, delay: i * 0.1, pan: pan }); break;
      case 'zombie': tone({ f: 95, f2: 60, d: 0.9, type: 'sawtooth', vol: 0.28 * v, lp: 380, vib: 3, pan: pan }); break;
      case 'creeper': hiss({ d: 1.4, vol: 0.28 * v, type: 'highpass', f: 3500, pan: pan }); break;
      case 'skeleton': for (let i = 0; i < 3; i++) hiss({ d: 0.05, vol: 0.22 * v, type: 'bandpass', f: 1800, q: 4, delay: i * 0.09, pan: pan }); break;
      case 'spider': hiss({ d: 0.5, vol: 0.16 * v, type: 'highpass', f: 4000, pan: pan }); tone({ f: 600, f2: 300, d: 0.25, type: 'square', vol: 0.06 * v, pan: pan }); break;
      case 'irongolem': tone({ f: 95, f2: 70, d: 0.7, type: 'sine', vol: 0.25 * v, pan: pan }); hiss({ d: 0.2, vol: 0.12 * v, type: 'bandpass', f: 700, q: 3, pan: pan }); break;
      case 'coppergolem': tone({ f: 900, f2: 1200, d: 0.08, type: 'square', vol: 0.08 * v, pan: pan }); tone({ f: 1200, f2: 800, d: 0.1, type: 'square', vol: 0.08 * v, delay: 0.1, pan: pan }); break;
      case 'diamondgolem': tone({ f: 70, f2: 55, d: 0.9, type: 'sine', vol: 0.3 * v, pan: pan }); tone({ f: 880, f2: 880, d: 0.6, type: 'triangle', vol: 0.05 * v, delay: 0.1, pan: pan }); break;
      case 'pillager': tone({ f: 150, f2: 115, d: 0.5, type: 'sawtooth', vol: 0.2 * v, lp: 650, vib: 4, pan: pan }); break;
      case 'vindicator': tone({ f: 105, f2: 80, d: 0.6, type: 'sawtooth', vol: 0.26 * v, lp: 500, vib: 6, pan: pan }); hiss({ d: 0.15, vol: 0.1 * v, type: 'bandpass', f: 900, pan: pan }); break;
      case 'villager': tone({ f: 170, f2: 210, d: 0.15, type: 'sawtooth', vol: 0.2 * v, lp: 800, pan: pan }); tone({ f: 210, f2: 150, d: 0.26, type: 'sawtooth', vol: 0.2 * v, lp: 800, delay: 0.15, pan: pan }); break;
    }
  }
  function sfxAt(name: string, x: number, y: number, z: number, arg?: number): void {
    if (!Snd.ctx) return;
    const player = getPlayer();
    const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz, (y - (player.y + 1)) * 0.5);
    const maxD = name === 'explode' ? 75 : 28, v = Math.pow(Math.max(0, 1 - d / maxD), 2);
    const pan = d > 0.5 ? (dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw)) / d : 0;
    sfx(name, v, pan, arg);
  }
  const MUS_DAY = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3], MUS_NIGHT = [110, 130.8, 146.8, 164.8, 196, 220, 261.6];
  function updateMusic(dt: number): void {
    if (!Snd.ctx || !Snd.music) return;
    Snd.nextMusic -= dt;
    if (Snd.nextMusic > 0) return;
    const night = getNight(), sc = night ? MUS_NIGHT : MUS_DAY;
    Snd.nextMusic = (night ? 14 : 9) + Math.random() * 10;
    let i = Math.floor(Math.random() * sc.length);
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      i = Math.max(0, Math.min(sc.length - 1, i + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2))));
      tone({ f: sc[i], d: night ? 2.4 : 1.7, type: 'triangle', vol: 0.12, attack: 0.04, delay: k * (night ? 0.95 : 0.55), lp: 2200, music: true });
    }
  }
  return { Snd, saveSound, applySound, audioInit, sfx, sfxAt, updateMusic, tone, hiss };
}
