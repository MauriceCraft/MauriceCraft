import { mulberry32, hash2 } from '../world/noise';

/** Draw every block and item icon into the packed texture atlas.
 * Keep tile IDs and seeded pixel patterns stable across game updates.
 */
export function makeAtlas(getToolTile: (tier: number, kind: number) => number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 16;
    const g = c.getContext('2d');
    if (!g) throw new Error('MauriceCraft needs a 2D canvas to draw its textures');
    const rnd = mulberry32(7);
    const GLYPH: Record<string, number[]> = { T: [7, 2, 2, 2, 2], N: [5, 7, 7, 5, 5] };
    const cl = (v: number): number => Math.max(0, Math.min(255, v | 0));
    const put = (t: number, x: number, y: number, r: number, gr: number, b: number): void => { g.fillStyle = 'rgb(' + cl(r) + ',' + cl(gr) + ',' + cl(b) + ')'; g.fillRect(t * 16 + x, y, 1, 1); };
    const noise = (a: number): number => (rnd() - 0.5) * a;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let n;
        n = noise(36); put(0, x, y, 92 + n, 158 + n, 56 + n * 0.6);
        const gs = y < 3 || (y === 3 && rnd() < 0.5);
        n = noise(30);
        if (gs) put(1, x, y, 92 + n, 158 + n, 56 + n * 0.6); else put(1, x, y, 134 + n, 96 + n * 0.8, 67 + n * 0.6);
        n = noise(30); put(2, x, y, 134 + n, 96 + n * 0.8, 67 + n * 0.6);
        n = noise(34); put(3, x, y, 124 + n, 124 + n, 126 + n);
        n = noise(18); put(4, x, y, 219 + n, 205 + n, 150 + n);
        const st = (x % 4 === 0 || x % 4 === 3) ? -14 : 0;
        n = noise(16) + st; put(5, x, y, 104 + n, 80 + n, 48 + n * 0.7);
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        const lb = d > 6.5 ? [96, 74, 44] : (Math.floor(d) % 2 === 0 ? [176, 140, 88] : [150, 116, 70]);
        n = noise(10); put(6, x, y, lb[0] + n, lb[1] + n, lb[2] + n);
        const dark = rnd() < 0.35; n = noise(24);
        put(7, x, y, (dark ? 30 : 52) + n, (dark ? 92 : 132) + n, (dark ? 26 : 40) + n * 0.5);
        const row = Math.floor(y / 4);
        const seam = (y % 4 === 3), vseam = ((x + row * 5) % 16) === 0;
        n = noise(12); const pb = (seam || vseam) ? [120, 90, 52] : [178, 140, 86];
        put(8, x, y, pb[0] + n + (row % 2) * 6, pb[1] + n + (row % 2) * 5, pb[2] + n);
        const mortar = (y % 4 === 3) || (((x + (row % 2) * 4) % 8) === 7);
        n = noise(18);
        if (mortar) put(9, x, y, 196 + n * 0.5, 190 + n * 0.5, 178 + n * 0.5); else put(9, x, y, 160 + n, 72 + n * 0.6, 56 + n * 0.5);
        const cell = hash2(x >> 2, y >> 2, 3);
        const edge = (x % 4 === 0 || y % 4 === 0) ? -22 : 0;
        n = noise(14) + (cell - 0.5) * 50 + edge; put(10, x, y, 118 + n, 118 + n, 120 + n);
        const sbMortar = (y % 8 === 7) || (((x + (Math.floor(y / 8) % 2) * 4) % 8) === 7);   // stone brick
        n = noise(14); if (sbMortar) put(11, x, y, 92 + n * 0.5, 92 + n * 0.5, 96 + n * 0.5); else put(11, x, y, 132 + n, 132 + n, 134 + n);
        const sline = (y === 3 || y === 12); n = noise(10);                          // sandstone side
        put(12, x, y, (sline ? 190 : 216) + n, (sline ? 175 : 203) + n, (sline ? 120 : 150) + n);
        n = noise(10); put(13, x, y, 222 + n, 209 + n, 156 + n);                     // sandstone top
        const gv = rnd(); const gt = gv < 0.33 ? 96 : (gv < 0.7 ? 128 : 152);        // gravel
        put(14, x, y, gt + noise(8), gt - 4 + noise(8), gt - 8 + noise(8));
        const hs = (x % 4 === 0) ? -34 : 0, hband = (y === 3 || y === 12);           // hay side
        n = noise(14) + hs; if (hband) put(15, x, y, 130 + n * 0.4, 88 + n * 0.4, 24); else put(15, x, y, 206 + n, 164 + n, 40 + n * 0.4);
        n = noise(18); put(16, x, y, 212 + n, 172 + n, 52 + n * 0.5);                // hay top
        let gc = [244, 208, 56]; n = noise(14);                                      // gold
        if (x === 0 || y === 0) gc = [255, 240, 150]; else if (x === 15 || y === 15) gc = [214, 168, 28]; else if ((x + y) % 5 === 0) gc = [255, 228, 90];
        put(17, x, y, gc[0] + n, gc[1] + n, gc[2] + n * 0.5);
        const cell2 = hash2(x >> 2, y >> 2, 3), edge2 = (x % 4 === 0 || y % 4 === 0) ? -22 : 0;   // mossy cobble
        n = noise(14) + (cell2 - 0.5) * 50 + edge2;
        if (hash2(x, y, 5) < 0.38) put(18, x, y, 62 + n * 0.5, 118 + n * 0.5, 52); else put(18, x, y, 118 + n, 118 + n, 120 + n);
        n = noise(14); const ring = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));              // tnt top
        if (ring < 1.6) put(19, x, y, 60, 56, 52); else put(19, x, y, 196 + n, 168 + n, 118 + n * 0.8);
        let tr = 205, tg = 50, tb = 42; n = noise(12);                                           // tnt side
        if (y >= 4 && y <= 10) { tr = 232; tg = 228; tb = 216; }
        if (y === 3 || y === 11) { tr = 150; tg = 30; tb = 26; }
        if (y >= 5 && y <= 9) {
          const xs = [2, 6, 10], gl = ['T', 'N', 'T'];
          for (let li = 0; li < 3; li++) { const lx = x - xs[li]; if (lx >= 0 && lx <= 2 && ((GLYPH[gl[li]][y - 5] >> (2 - lx)) & 1)) { tr = 30; tg = 28; tb = 28; n = 0; } }
        }
        put(20, x, y, tr + n, tg + n * 0.6, tb + n * 0.6);
      }
    }
    // Obsidian texture (tile 98): nearly black purple stone with violet cracks.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = (hash2(x, y, 98) - 0.5) * 24;
      let col = [31 + n, 22 + n, 48 + n];
      if ((x + y * 2) % 11 === 0 || (x * 3 + y) % 17 === 0) col = [83 + n, 49 + n, 119 + n];
      put(98, x, y, col[0], col[1], col[2]);
    }
    // item icons (tiles 21-31), drawn on a transparent background
    const R = function (t: number, x: number, y: number, w: number, h: number, col: string) { g.fillStyle = col; g.fillRect(t * 16 + x, y, w, h); };
    const blob = function (t: number, cx: number, cy: number, rx: number, ry: number, base: string, hi: string, sv: number) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) R(t, x, y, 1, 1, hash2(x, y, sv) < 0.22 ? hi : base);
      }
    };
    blob(21, 8, 8, 6.5, 5, '#b3383a', '#dd8a82', 21); R(21, 5, 6, 3, 1, '#f1d6cf');
    blob(22, 8, 8, 6.5, 5, '#e8979a', '#f8c8c6', 22);
    blob(23, 7, 8, 5.5, 5, '#c25a50', '#e49a8c', 23); R(23, 11, 7, 4, 2, '#f0ead8'); R(23, 14, 6, 2, 1, '#f0ead8'); R(23, 14, 9, 2, 1, '#f0ead8');
    blob(24, 7, 6, 5, 4, '#e6c08a', '#f6dfb0', 24);
    for (let i = 0; i < 5; i++) R(24, 9 + i, 9 + i, 1, 1, '#f2ecd8');
    R(24, 13, 14, 3, 1, '#f2ecd8'); R(24, 14, 13, 1, 3, '#f2ecd8');
    blob(25, 8, 8, 6.5, 5, '#8a5128', '#b57a44', 25); R(25, 4, 6, 8, 1, '#4a2a12'); R(25, 4, 9, 8, 1, '#4a2a12');
    for (let y = 3; y <= 12; y++) for (let x = 2; x <= 13; x++) {
      if ((x === 2 || x === 13) && (y === 3 || y === 12)) continue;
      R(26, x, y, 1, 1, hash2(x, y, 26) < 0.3 ? '#d9d9d4' : '#f1f1ec');
    }
    for (let i = 0; i < 12; i++) {
      R(27, 2 + i, 13 - i, 1, 1, '#dcdce4');
      if (i > 1 && i < 10) { R(27, 2 + i, 12 - i, 1, 1, '#f6f6fa'); R(27, 3 + i, 13 - i, 1, 1, '#c4c4d0'); }
    }
    for (let y = 3; y <= 12; y++) for (let x = 3; x <= 12; x++) {
      const edgeP = (x === 3 || x === 12 || y === 3 || y === 12);
      R(28, x, y, 1, 1, edgeP && (x + y) % 2 === 0 ? '#d9b27a' : (hash2(x, y, 28) < 0.25 ? '#a8703c' : '#946034'));
    }
    for (let y = 6; y <= 13; y++) {
      const half = Math.round(Math.min(6, (y - 5) * 1.1));
      for (let x = 8 - half; x <= 7 + half; x++) { const hv = hash2(x, y, 29); R(29, x, y, 1, 1, hv < 0.3 ? '#2e2e34' : (hv < 0.7 ? '#4a4a52' : '#74747e')); }
    }
    R(30, 6, 3, 4, 11, '#c9302b'); R(30, 6, 6, 4, 1, '#8f1d19'); R(30, 6, 11, 4, 1, '#8f1d19'); R(30, 6, 8, 4, 2, '#e8d8a8');
    R(30, 7, 1, 2, 2, '#7a5a30'); R(30, 6, 0, 4, 1, '#ffb236'); R(30, 7, 0, 2, 1, '#fff1a8');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      R(32, x, y, 1, 1, hash2(x, y, 32) < 0.3 ? '#6b4f2e' : '#8a6a3c');
      const fd = Math.hypot(x - 7.5, y - 7.5) / 8, fh = hash2(x, y, 33);
      R(33, x, y, 1, 1, fd < 0.35 ? '#fff7b0' : (fd < 0.7 ? (fh < 0.3 ? '#ffe070' : '#ffd24a') : (fh < 0.4 ? '#ff6a1a' : '#ff8a1f')));
      if (Math.abs(x - 7.5) + Math.abs(y - 7.5) <= 6.5) {
        const ev = hash2(x, y, 34);
        R(34, x, y, 1, 1, (x + y < 10) ? '#7af0a4' : (ev < 0.4 ? '#0e8a3e' : '#1fbf5a'));
      }
    }
    for (let i = 3; i <= 12; i++) { R(35, i, 15 - i, 2, 2, '#ecebe0'); R(35, i + 1, 16 - i, 1, 1, '#bdbcaf'); }
    R(35, 1, 11, 3, 3, '#ecebe0'); R(35, 12, 1, 3, 3, '#ecebe0');
    for (let x = 2; x <= 13; x++) { const yy = 8 + Math.round(3 * Math.sin(x * 0.7)); R(36, x, yy, 1, 1, '#eaeaea'); R(36, x, yy + 1, 1, 1, '#b9b9b9'); }
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const pn = hash2(x, y, 38) * 14 - 7;
      const gridLine = (x === 0 || y === 0 || x === 15 || y === 15 || x === 5 || x === 10 || y === 5 || y === 10);
      if (gridLine) R(38, x, y, 1, 1, '#5e4322'); else R(38, x, y, 1, 1, 'rgb(' + (182 + pn | 0) + ',' + (140 + pn | 0) + ',' + (84 + pn | 0) + ')');
      const trim = y < 3;
      R(39, x, y, 1, 1, trim ? '#6b4a26' : 'rgb(' + (178 + pn | 0) + ',' + (138 + pn | 0) + ',' + (84 + pn | 0) + ')');
    }
    R(39, 2, 5, 1, 7, '#6b4f2e'); R(39, 1, 4, 3, 2, '#8d939a');
    R(39, 9, 6, 5, 3, '#aeb4ba'); R(39, 9, 9, 5, 1, '#8d939a'); R(39, 13, 9, 1, 3, '#6b4f2e');
    for (let i = 3; i <= 12; i++) { R(40, i, 15 - i, 2, 1, '#8a6a3c'); R(40, i, 16 - i, 1, 1, '#6b4f2e'); }
    [['#4b2f1c', '#eeeae0'], ['#f2a6a6', '#d98080'], ['#f0f0ea', '#6f5d4c'], ['#f4f4f0', '#d02828'], ['#8a6a3c', '#c9a07a'],
     ['#2f8a9a', '#5f9a45'], ['#4caf3a', '#111111'], ['#d9d9cf', '#8e8e84'], ['#2a2326', '#ff2020']].forEach(function (cols, k) {
      const t = 41 + k;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const dx = (x - 7.5) / 5.2, dy = (y - 8) / 6.6, d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        R(t, x, y, 1, 1, d2 > 0.8 ? '#1d1d1d' : (hash2(x, y, 50 + k) < 0.3 ? cols[1] : cols[0]));
      }
      R(t, 5, 4, 2, 1, 'rgba(255,255,255,0.75)'); R(t, 5, 5, 1, 1, 'rgba(255,255,255,0.5)');
    });
    const TIER_COL = [['#b58d52', '#8a6a3c'], ['#a9a9a9', '#7a7a7a'], ['#35e08a', '#1a9a52'], ['#e4e4e8', '#9a9aa2'], ['#4fe3e8', '#1a9ca0']];
    for (let ti = 0; ti < 5; ti++) for (let ki = 0; ki < 4; ki++) {
      const t = getToolTile(ti, ki), hc = TIER_COL[ti][0], hd = TIER_COL[ti][1];
      const handle = function (x0: number, y0: number, x1: number, y1: number) {
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let i = 0; i <= n; i++) { const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n); R(t, x, y, 1, 1, '#8a6a3c'); R(t, x + 1, y, 1, 1, '#6b4f2e'); }
      };
      if (ki === 0) { handle(2, 14, 9, 5); R(t, 5, 2, 8, 2, hc); R(t, 4, 3, 1, 3, hd); R(t, 13, 3, 1, 3, hd); R(t, 5, 3, 8, 1, hd); }
      else if (ki === 1) { handle(2, 14, 9, 6); R(t, 7, 2, 5, 4, hc); R(t, 11, 3, 2, 5, hc); R(t, 7, 6, 6, 1, hd); }
      else if (ki === 2) { handle(2, 14, 10, 6); R(t, 9, 2, 4, 5, hc); R(t, 10, 1, 2, 1, hc); R(t, 9, 6, 4, 1, hd); }
      else { handle(2, 14, 5, 11); R(t, 3, 9, 5, 1, '#6b4f2e'); for (let i = 0; i < 8; i++) { R(t, 6 + i, 9 - i, 2, 1, hc); R(t, 8 + i, 9 - i, 1, 1, hd); } }
    }
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const bn = hash2(x, y, 62) * 14 - 7, red = 'rgb(' + ((196 + bn) | 0) + ',' + ((44 + bn) | 0) + ',' + ((44 + bn) | 0) + ')';
      R(62, x, y, 1, 1, (x === 0 || x === 15 || y === 0 || y === 15) ? '#7a1414' : red);
      R(66, x, y, 1, 1, y < 9 ? ((x === 0 || x === 15 || y === 0 || y === 8) ? '#cfcfd4' : '#f2f2f4') : ((x === 0 || x === 15 || y === 15) ? '#7a1414' : red));
      R(63, x, y, 1, 1, y < 8 ? (y === 7 ? '#7a1414' : red) : ((y === 8 || y === 12) ? '#6b4f2e' : 'rgb(' + ((170 + bn) | 0) + ',' + ((130 + bn) | 0) + ',' + ((80 + bn) | 0) + ')'));
    }
    [['#5a5a5e', '#2a2a2e'], ['#2f4a3a', '#9aa0a8']].forEach(function (c, i) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const ey = (y - 8.5) / 6.8, ex = (x - 7.5) / (y < 8.5 ? 4.6 : 5.6);
        if (ex * ex + ey * ey <= 1) R(64 + i, x, y, 1, 1, hash2(x, y, 64 + i) < 0.28 ? c[1] : c[0]);
      }
    });
    R(67, 1, 11, 14, 1, '#8a6a3c'); R(67, 1, 7, 14, 4, '#c42c2c'); R(67, 1, 6, 5, 2, '#f2f2f4'); R(67, 1, 7, 14, 1, '#8c1c1c');
    R(67, 1, 12, 2, 3, '#6b4f2e'); R(67, 13, 12, 2, 3, '#6b4f2e'); R(67, 1, 5, 2, 7, '#6b4f2e');
    const ORE_COL = [['#1c1c1f', '#3d3d42'], ['#d8793a', '#4fb08a'], ['#d9a98a', '#b5836a'], ['#4fe3e8', '#d2fdff']];
    for (let oi = 0; oi < 4; oi++) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const base = 124 + (hash2(x, y, 90 + oi) - 0.5) * 30;
      const spot = hash2(x >> 1, y >> 1, 700 + oi * 13) < 0.3 && hash2(x, y, 710 + oi) < 0.85;
      R(68 + oi, x, y, 1, 1, spot ? (hash2(x, y, 720 + oi) < 0.55 ? ORE_COL[oi][0] : ORE_COL[oi][1]) : 'rgb(' + (base | 0) + ',' + (base | 0) + ',' + ((base + 2) | 0) + ')');
    }
    [['#d4d7dc', '#f0f2f5', '#8d9096'], ['#d2793f', '#eea15e', '#9c5528'], ['#4fe3e8', '#b6fbfd', '#1b9fa4']].forEach(function (c, bi) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const edge = x === 0 || y === 0 || x === 15 || y === 15, hl = (x + y) % 8 === 0 || (x === 3 && y < 6);
        R(72 + bi, x, y, 1, 1, edge ? c[2] : (hl ? c[1] : c[0]));
      }
    });
    blob(75, 8, 8, 5.5, 4.5, '#1f1f22', '#46464b', 75); blob(76, 8, 8, 5.5, 4.5, '#c47a3c', '#e8a35c', 76); blob(77, 8, 8, 5.5, 4.5, '#d6a58a', '#b58368', 77);
    [[78, '#c8723a', '#ee9a5c', '#8f4f24'], [79, '#d8d8dc', '#f6f6fa', '#8d8d94']].forEach(function (c) {
      R(Number(c[0]), 3, 6, 11, 5, String(c[1])); R(Number(c[0]), 3, 6, 11, 1, String(c[2])); R(Number(c[0]), 2, 7, 1, 4, String(c[3])); R(Number(c[0]), 3, 10, 11, 1, String(c[3])); R(Number(c[0]), 13, 7, 1, 3, String(c[3]));
    });
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (Math.abs(x - 7.5) + Math.abs(y - 8) <= 6.5) R(80, x, y, 1, 1, (x + y < 11) ? '#d2fdff' : (x > 9 ? '#1a9ca0' : '#4fe3e8'));
    }
    [['#c8ccd2', '#7d8a78'], ['#d2793f', '#4fa38a'], ['#4be3d6', '#e8ffff']].forEach(function (c, i) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const ey = (y - 8.5) / 6.8, ex = (x - 7.5) / (y < 8.5 ? 4.6 : 5.6);
        if (ex * ex + ey * ey <= 1) R(89 + i, x, y, 1, 1, hash2(x, y, 89 + i) < 0.28 ? c[1] : c[0]);
      }
    });
    R(37, 7, 6, 2, 9, '#8a6a3c'); R(37, 7, 6, 1, 9, '#6b4f2e'); R(37, 6, 2, 4, 4, '#ffb020'); R(37, 7, 1, 2, 1, '#ffd24a'); R(37, 7, 3, 2, 2, '#fff7b0');
    R(31, 2, 9, 12, 3, '#9aa0a8'); R(31, 2, 9, 12, 1, '#cfd3d8'); R(31, 9, 5, 4, 4, '#3b3b42'); R(31, 10, 3, 2, 2, '#ff9a2e'); R(31, 10, 2, 1, 1, '#ffd36b');
    // Custom liquid textures: rippling blue water and glowing orange lava.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const wave = ((x + Math.floor(y / 3)) % 5 === 0) ? 24 : 0;
      put(96, x, y, 25 + wave, 112 + wave, 224 + Math.floor(wave * 0.5));
      const hot = ((x * 3 + y * 5) % 7 < 2) ? 55 : 0;
      put(97, x, y, 255, 76 + hot, 8 + Math.floor(hot * 0.15));
    }
    // New biome materials use unused atlas cells; existing pixel IDs stay intact.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const a = (hash2(x, y, 99) - 0.5) * 24;
      put(99, x, y, 226 + a, 236 + a, 249 + a * 0.3); // snow
      const p = (hash2(x, y, 100) - 0.5) * 36;
      put(100, x, y, 28 + p * 0.3, 90 + p, 52 + p * 0.5); // pine foliage
      const r = (hash2(x, y, 101) - 0.5) * 42;
      put(101, x, y, 185 + r, 91 + r * 0.7, 58 + r * 0.4); // red sand
      const ring = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const d = (hash2(x, y, 102) - 0.5) * 20;
      put(102, x, y, 98 + d + (Math.floor(ring) % 2 ? 12 : 0), 67 + d, 42 + d * 0.7);
      const stripe = x % 5 === 0 ? -20 : 0;
      put(103, x, y, 94 + d + stripe, 65 + d + stripe, 42 + d + stripe);
    }
    // Species palettes are generated deterministically in unused atlas slots.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = (hash2(x, y, 405) - 0.5) * 22;
      const bark = (x % 5 === 0 || x % 7 === 0) ? -21 : 0;
      put(104, x, y, 220 + n, 208 + n, 185 + n);
      put(105, x, y, 218 + n + bark, 215 + n + bark, 205 + n + bark);
      put(106, x, y, 143 + n, 179 + n, 69 + n * 0.4);
      put(107, x, y, 166 + n, 102 + n, 61 + n);
      put(108, x, y, 116 + n + bark, 87 + n, 68 + n);
      put(109, x, y, 91 + n * 0.6, 132 + n, 77 + n * 0.7);
      put(110, x, y, 111 + n, 90 + n, 65 + n);
      put(111, x, y, 104 + n + bark, 86 + n, 70 + n);
      put(112, x, y, 43 + n * 0.6, 126 + n, 62 + n * 0.5);
      put(113, x, y, 206 + n, 138 + n * 1.2, 43 + n * 0.4);
      put(114, x, y, 85 + n, 67 + n * 0.7, 51 + n * 0.5);
      const f = hash2(x >> 1, y >> 1, 406);
      if (f < 0.08) put(115, x, y, 236, 203, 81);
      else if (f < 0.16) put(115, x, y, 244, 154, 190);
      else put(115, x, y, 91 + n, 158 + n, 65 + n * 0.5);
      if (y < 4) put(116, x, y, 91 + n, 158 + n, 65 + n * 0.5);
      else put(116, x, y, 130 + n, 97 + n * 0.7, 68 + n * 0.6);
    }
    return c;
  }
