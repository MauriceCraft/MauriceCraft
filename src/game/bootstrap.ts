// @ts-nocheck
// This legacy gameplay loop is being migrated to typed, focused modules.
// Keep IndexedDB store names/keys and world serialization compatible.
import * as THREE from 'three';
import { bg, bm, part, JOBS, JOB_NAMES, makeZombie, makeCow, makePig, makeSheep, makeChicken, makeCreeper, makeSkeleton, makeSpider, makePillager, makeVindicator, makeIronGolem, makeCopperGolem, makeDiamondGolem, makeVillager, makeEnderDragon } from './entities/mob-models';
import { ckey } from './world/chunk-key';
import { createChunkStreamer } from './world/chunk-streamer';
import { mulberry32, hash2, fbm, smooth } from './world/noise';
import { blockKind } from './world/block-kind';
import { createBlockCatalog } from './world/block-catalog';
import { createRecipeMatcher } from './crafting/recipes';
import { coord } from './commands/coordinates';
import { createItemResolver } from './commands/item-resolver';
import { findPortalFrame, portalContains } from './portals/frame';
import { restorePortals, snapshotPortals } from './portals/persistence';
import { makeAtlas } from './rendering/texture-atlas';
import { openWorldStorage } from './storage/world-storage';
import { createAudioEngine } from './audio/sound-engine';

(function () {
  'use strict';

  /* ---------- World constants ---------- */
  const H = 48, CS = 16, SEA = 14, R = 5;   // R = view distance in chunks
  const chunks = new Map();
  let _ck = null, _cc = null;
  function chunkAt(cx, cz) { const k = ckey(cx, cz); if (k === _ck) return _cc; _ck = k; _cc = chunks.get(k) || null; return _cc; }
  function resetChunkCache() { _ck = null; _cc = null; }
  // Unloaded space counts as solid, so nothing can walk into it
  function get(x, y, z) {
    if (y < 0) return 3;
    if (y >= H) return 0;
    const c = chunkAt(x >> 4, z >> 4);
    if (!c) return 3;
    return c.data[(y * 16 + (z & 15)) * 16 + (x & 15)];
  }
  function setBlock(x, y, z, b) {
    if (y < 0 || y >= H) return;
    const c = chunkAt(x >> 4, z >> 4);
    if (!c) return;
    c.data[(y * 16 + (z & 15)) * 16 + (x & 15)] = b; c.edited = true; c.dirty = true; c.torches = null;
  }
  function inBounds(x, y, z) { return y >= 0 && y < H; }

  // Persistent items, blocks, and mining rules live in a typed catalog.
  const {
    GRASS, DIRT, STONE, SAND, WOOD, LEAVES, PLANKS, BRICK,
    COBBLE, STONEBRICK, SANDSTONE, GRAVEL, HAY, GOLD, MOSSY, TNT,
    TORCH, CTABLE, BED, WATER, LAVA, OBSIDIAN, COAL_ORE, COPPER_ORE,
    IRON_ORE, DIAMOND_ORE, IRON_BLOCK, COPPER_BLOCK, DIAMOND_BLOCK, BEEF, PORK, MUTTON,
    CHICKEN, COOKED, WOOL, FEATHER, LEATHER, GUNPOWDER, DYNAMITE, FLINT,
    EMERALD, BONE, STRING, STICK, COAL, RAW_COPPER, RAW_IRON, COPPER_INGOT,
    IRON_INGOT, DIAMOND, ITEM_TILE, EGG_KINDS, FOOD, TILES, tileOf, ATLAS_N,
    isBed, BED_H, BED_DIR, solid, opq, NAMES, ALL_BLOCKS, BREAK_TIME,
    DROPS, TOOL_KINDS, TOOL_TIERS, toolId, toolTile, TOOLS, TOOL_IDS, TOOL_MAX,
    TOOL_LVL, TOOL_SPD, TOOL_DMG, NEEDS_PICK,
  } = createBlockCatalog();
  const hotbar = ALL_BLOCKS.slice(0, 9);
  const toolWear = {};

  /* ---------- Texture atlas ---------- */
  /* ---------- Renderer ---------- */
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 30, 78);
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 500);
  camera.rotation.order = 'YXZ';

  const atlasCanvas = makeAtlas(toolTile);
  const tex = new THREE.CanvasTexture(atlasCanvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });
  // Terrain shader: brightness = max(daylight, warm torch light), so torches really light up the dark
  const dayUniform = { value: 1 };
  mat.onBeforeCompile = function (shader) {
    shader.uniforms.uDay = dayUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLight;\nvarying float vLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = aLight;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDay;\nvarying float vLight;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vColor * max(vec3(uDay), vLight * vec3(1.0, 0.8, 0.52));');
  };
  const torchMat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });   // torches keep their brightness at night
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 64;
  (function () {
    const g = glowCanvas.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,205,120,1)'); gr.addColorStop(0.35, 'rgba(255,150,50,0.45)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  })();
  const glowMat = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(glowCanvas), size: 3.4, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff });

  function makeDisc(color, size) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color: color, fog: false, depthWrite: false }));
    scene.add(m); return m;
  }
  const sun = makeDisc(0xfff0a8, 34), moon = makeDisc(0xdfe7ff, 24);

  const sel = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)),
    new THREE.LineBasicMaterial({ color: 0x000000 })
  );
  sel.visible = false; scene.add(sel);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  /* ---------- Chunk meshing (with ambient occlusion) ---------- */
  const FACES = [
    { n: [1, 0, 0],  c: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], s: 0.8,  t: 1 },
    { n: [-1, 0, 0], c: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], s: 0.8,  t: 1 },
    { n: [0, 0, 1],  c: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], s: 0.66, t: 1 },
    { n: [0, 0, -1], c: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], s: 0.66, t: 1 },
    { n: [0, 1, 0],  c: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], s: 1.0,  t: 0 },
    { n: [0, -1, 0], c: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], s: 0.5,  t: 2 }
  ];
  const AO_LEVELS = [0.5, 0.68, 0.84, 1.0];
  const EPS = 0.0015;
  function disposeMesh(c) {
    if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
    if (c.mesh2) { scene.remove(c.mesh2); c.mesh2.geometry.dispose(); c.mesh2 = null; }
    if (c.glow) { scene.remove(c.glow); c.glow.geometry.dispose(); c.glow = null; }
    c.meshed = false;
  }
  // A torch is a thin stick with a small flame on top, drawn in its own always-bright mesh
  function addTorch(pos, uv, col, ind, gpos, x, y, z) {
    [[0.4375, 0, 0.5625, 0.6, 32], [0.40625, 0.6, 0.59375, 0.78, 33]].forEach(function (bx) {
      const lo = bx[0], y0 = bx[1], hi = bx[2], y1 = bx[3], tile = bx[4];
      const u0 = tile / ATLAS_N + EPS, u1 = (tile + 1) / ATLAS_N - EPS;
      FACES.forEach(function (f) {
        const vi = pos.length / 3;
        for (let i = 0; i < 4; i++) {
          const c = f.c[i];
          pos.push(x + (c[0] ? hi : lo), y + (c[1] ? y1 : y0), z + (c[2] ? hi : lo));
          uv.push((i === 1 || i === 2) ? u1 : u0, i < 2 ? EPS : 1 - EPS);
          const sh = tile === 33 ? 1 : 0.75 + f.s * 0.25; col.push(sh, sh, sh);
        }
        ind.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      });
    });
    gpos.push(x + 0.5, y + 0.8, z + 0.5);
  }
  // A bed is two low blocks (foot and head). The top texture is turned so the pillow sits at the head end.
  function addBed(pos, uv, col, ind, light, x, y, z, id, lv) {
    const k = id - 19, dir = k >> 1, head = k & 1, topTile = head ? 66 : 62, sideTile = 63;
    FACES.forEach(function (f) {
      if (f.t === 2) return;
      const tile = f.t === 0 ? topTile : sideTile;
      const u0 = tile / ATLAS_N + EPS, u1 = (tile + 1) / ATLAS_N - EPS, vi = pos.length / 3;
      for (let i = 0; i < 4; i++) {
        const c = f.c[i];
        pos.push(x + c[0], y + c[1] * BED_H, z + c[2]);
        let uu, vv;
        if (f.t === 0) {
          let s2, t2;
          if (dir === 0) { t2 = c[0]; s2 = c[2]; } else if (dir === 1) { t2 = c[2]; s2 = 1 - c[0]; } else if (dir === 2) { t2 = 1 - c[0]; s2 = 1 - c[2]; } else { t2 = 1 - c[2]; s2 = c[0]; }
          uu = u0 + s2 * (u1 - u0); vv = EPS + t2 * (1 - 2 * EPS);
        } else { uu = (i === 1 || i === 2) ? u1 : u0; vv = i < 2 ? EPS : 1 - EPS; }
        uv.push(uu, vv); col.push(f.s, f.s, f.s); light.push(lv);
      }
      ind.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    });
  }
  function buildTorchMeshes(chunk, tpos, tuv, tcol, tind, gpos) {
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3));
    tg.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
    tg.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3));
    tg.setIndex(tind); tg.computeBoundingSphere();
    chunk.mesh2 = new THREE.Mesh(tg, torchMat); scene.add(chunk.mesh2);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
    gg.computeBoundingSphere();
    chunk.glow = new THREE.Points(gg, glowMat); scene.add(chunk.glow);
  }

  // Torch light: flood-filled outwards from every torch (13 at the flame, one less per block), blocked by solid blocks
  const TORCH_LEVEL = 13, LIGHT_R = 12;
  function torchesOf(c) {
    if (c.torches) return c.torches;
    const out = [], d = c.data;
    for (let i = 0; i < d.length; i++) if (d[i] === TORCH) out.push([c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15)]);
    c.torches = out;
    return out;
  }
  function computeLight(cx, cz) {
    const src = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = chunks.get(ckey(cx + dx, cz + dz));
      if (c) { const t = torchesOf(c); for (let i = 0; i < t.length; i++) src.push(t[i]); }
    }
    if (!src.length) return null;
    const x0 = cx * 16 - LIGHT_R, z0 = cz * 16 - LIGHT_R, S = 16 + 2 * LIGHT_R;
    const L = new Uint8Array(S * S * H), qx = [], qy = [], qz = [];
    for (let i = 0; i < src.length; i++) {
      const t = src[i], lx = t[0] - x0, lz = t[2] - z0;
      if (lx < 0 || lz < 0 || lx >= S || lz >= S) continue;
      L[(t[1] * S + lz) * S + lx] = TORCH_LEVEL; qx.push(t[0]); qy.push(t[1]); qz.push(t[2]);
    }
    const DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, 1, -1, 0, 0], DZ = [0, 0, 0, 0, 1, -1];
    for (let head = 0; head < qx.length; head++) {
      const x = qx[head], y = qy[head], z = qz[head], lv = L[(y * S + (z - z0)) * S + (x - x0)];
      if (lv <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        const lx = nx - x0, lz = nz - z0;
        if (ny < 0 || ny >= H || lx < 0 || lz < 0 || lx >= S || lz >= S) continue;
        if (opq(get(nx, ny, nz))) continue;
        const ni = (ny * S + lz) * S + lx;
        if (L[ni] < lv - 1) { L[ni] = lv - 1; qx.push(nx); qy.push(ny); qz.push(nz); }
      }
    }
    return { L: L, x0: x0, z0: z0, S: S };
  }
  function buildChunk(cx, cz) {
    const chunk = chunkAt(cx, cz);
    if (!chunk) return;
    disposeMesh(chunk);
    chunk.meshed = true;
    const data = chunk.data;
    const pos = [], uv = [], col = [], ind = [];
    const tpos = [], tuv = [], tcol = [], tind = [], gpos = [], light = [];
    const LT = computeLight(cx, cz);
    const lightAt = LT ? function (x, y, z) {
      const lx = x - LT.x0, lz = z - LT.z0;
      if (lx < 0 || lz < 0 || lx >= LT.S || lz >= LT.S || y < 0 || y >= H) return 0;
      return LT.L[(y * LT.S + lz) * LT.S + lx];
    } : null;
    const lv4 = [0, 0, 0, 0];
    const x0 = cx * CS, z0 = cz * CS;
    const aoV = [0, 0, 0, 0];
    for (let y = 0; y < H; y++) {
      for (let z = z0; z < z0 + CS; z++) {
        for (let x = x0; x < x0 + CS; x++) {
          const b = data[(y * 16 + (z - z0)) * 16 + (x - x0)];
          if (!b) continue;
          if (b === TORCH) { addTorch(tpos, tuv, tcol, tind, gpos, x, y, z); continue; }
          if (isBed(b)) { addBed(pos, uv, col, ind, light, x, y, z, b, lightAt ? Math.pow(lightAt(x, y, z) / TORCH_LEVEL, 1.3) : 0); continue; }
          const tl = TILES[b];
          for (let fi = 0; fi < 6; fi++) {
            const f = FACES[fi];
            const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
            if (opq(get(nx, ny, nz))) continue;
            const ax = f.n[0] ? 0 : (f.n[1] ? 1 : 2);
            const t1 = (ax + 1) % 3, t2 = (ax + 2) % 3;
            for (let i = 0; i < 4; i++) {
              const c = f.c[i];
              const d1 = c[t1] * 2 - 1, d2 = c[t2] * 2 - 1;
              const p1 = [nx, ny, nz], p2 = [nx, ny, nz], p3 = [nx, ny, nz];
              p1[t1] += d1; p2[t2] += d2; p3[t1] += d1; p3[t2] += d2;
              const s1 = opq(get(p1[0], p1[1], p1[2])) ? 1 : 0;
              const s2 = opq(get(p2[0], p2[1], p2[2])) ? 1 : 0;
              const s3 = opq(get(p3[0], p3[1], p3[2])) ? 1 : 0;
              aoV[i] = (s1 && s2) ? 0 : 3 - (s1 + s2 + s3);
              if (lightAt) {
                const lf = lightAt(nx, ny, nz);
                lv4[i] = (lf + (s1 ? lf : lightAt(p1[0], p1[1], p1[2])) + (s2 ? lf : lightAt(p2[0], p2[1], p2[2])) + ((s3 || (s1 && s2)) ? lf : lightAt(p3[0], p3[1], p3[2]))) / 4;
              } else lv4[i] = 0;
            }
            const vi = pos.length / 3;
            const tile = tl[f.t];
            const u0 = tile / ATLAS_N + EPS, u1 = (tile + 1) / ATLAS_N - EPS;
            const uvs = [[u0, EPS], [u1, EPS], [u1, 1 - EPS], [u0, 1 - EPS]];
            for (let i = 0; i < 4; i++) {
              const c = f.c[i];
              pos.push(x + c[0], y + c[1], z + c[2]);
              uv.push(uvs[i][0], uvs[i][1]);
              const sh = f.s * AO_LEVELS[aoV[i]];
              col.push(sh, sh, sh);
              light.push(lv4[i] <= 0 ? 0 : Math.pow(lv4[i] / TORCH_LEVEL, 1.3));
            }
            if (aoV[0] + aoV[2] > aoV[1] + aoV[3]) {
              ind.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
            } else {
              ind.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
            }
          }
        }
      }
    }
    if (tind.length) buildTorchMeshes(chunk, tpos, tuv, tcol, tind, gpos);
    if (!ind.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aLight', new THREE.Float32BufferAttribute(light, 1));
    geo.setIndex(ind);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    chunk.mesh = mesh;
  }
  function refreshAround(x, z, wide) {
    const cx = x >> 4, cz = z >> 4, lx = x & 15, lz = z & 15;
    const dxs = wide ? [-1, 0, 1] : [0], dzs = wide ? [-1, 0, 1] : [0];
    if (!wide) {
      if (lx === 0) dxs.push(-1); if (lx === 15) dxs.push(1);
      if (lz === 0) dzs.push(-1); if (lz === 15) dzs.push(1);
    }
    for (const dx of dxs) for (const dz of dzs) {
      buildChunk(cx + dx, cz + dz);
    }
  }

  /* ---------- Endless world generation, one chunk at a time ---------- */
  let seed = 1;
  let dimension = 'overworld'; // overworld, nether, or end
  const portals = []; // portal frames are saved with the world and paired between Overworld and Nether
  const portalVisuals = [];
  let portalCooldown = 0;
  const savedChunks = new Map();   // edited chunks loaded from a saved world, keyed like chunks
  function heightAt(x, z) {
    const n = fbm(x / 40, z / 40, seed), n2 = fbm(x / 170, z / 170, seed + 300), m = fbm(x / 12, z / 12, seed + 50);
    const h = Math.floor(5 + (n * 0.72 + n2 * 0.28) * 34 + m * 4);
    return Math.max(3, Math.min(H - 12, h));
  }
  /* ---------- Structures: villages, temples, towers, dungeons ---------- */
  // The world is split into 80x80 regions; each region can hold one structure that fits entirely inside it,
  // so every chunk only has to ask its own region what to build.
  const REG = 80;
  const structCache = new Map();
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const STRUCT_NAMES = { village: 'Village', temple: 'Desert temple', tower: 'Ruined tower', dungeon: 'Old dungeon', cabin: 'Cabin', circle: 'Stone circle' };
  function structureFor(rx, rz) {
    const k = ckey(rx, rz);
    if (structCache.has(k)) return structCache.get(k);
    const st = makeStructure(rx, rz);
    structCache.set(k, st);
    return st;
  }
  function sampleGround(cx, cz, rad) {
    let mn = 999, mx = -999, sum = 0, n = 0;
    for (let a = 0; a <= 8; a++) {
      const x = a === 8 ? cx : Math.round(cx + Math.cos(a * Math.PI / 4) * rad);
      const z = a === 8 ? cz : Math.round(cz + Math.sin(a * Math.PI / 4) * rad);
      const h = heightAt(x, z);
      mn = Math.min(mn, h); mx = Math.max(mx, h); sum += h; n++;
    }
    return { spread: mx - mn, avg: Math.round(sum / n), min: mn };
  }
  function makeStructure(rx, rz) {
    const r = hash2(rx, rz, seed + 500), jx = hash2(rx, rz, seed + 501), jz = hash2(rx, rz, seed + 502);
    const ox = rx * REG, oz = rz * REG;
    let st = null;
    if (r < 0.22) {
      const cx = ox + 28 + Math.floor(jx * 25), cz = oz + 28 + Math.floor(jz * 25), f = sampleGround(cx, cz, 16);
      if (f.min > SEA + 2 && f.spread <= 9) st = { type: 'village', cx: cx, cz: cz, gy: f.avg, pad: 20, blend: 8, reach: 22 };
    } else if (r < 0.30) {
      const cx = ox + 22 + Math.floor(jx * 37), cz = oz + 22 + Math.floor(jz * 37), f = sampleGround(cx, cz, 10);
      if (f.avg <= 30 && f.spread <= 9) st = { type: 'temple', cx: cx, cz: cz, gy: Math.max(f.avg, 5), pad: 15, blend: 6, reach: 16 };
    } else if (r < 0.40) {
      const cx = ox + 14 + Math.floor(jx * 53), cz = oz + 14 + Math.floor(jz * 53), f = sampleGround(cx, cz, 6);
      if (f.min > SEA + 1 && f.spread <= 8) st = { type: 'tower', cx: cx, cz: cz, gy: f.avg, pad: 7, blend: 5, reach: 8 };
    } else if (r < 0.50) {
      const cx = ox + 8 + Math.floor(jx * 52), cz = oz + 8 + Math.floor(jz * 64), gy = heightAt(cx, cz);
      if (gy >= 14 && gy <= H - 14) st = { type: 'dungeon', cx: cx, cz: cz, gy: gy, pad: 0, blend: 0, reach: 20, zone: 4 };
    } else if (r < 0.60) {
      const cx = ox + 14 + Math.floor(jx * 53), cz = oz + 14 + Math.floor(jz * 53), f = sampleGround(cx, cz, 6);
      if (f.min > SEA + 1 && f.spread <= 6) st = { type: 'cabin', cx: cx, cz: cz, gy: f.avg, pad: 8, blend: 5, reach: 10 };
    } else if (r < 0.68) {
      const cx = ox + 14 + Math.floor(jx * 53), cz = oz + 14 + Math.floor(jz * 53), f = sampleGround(cx, cz, 6);
      if (f.min > SEA + 1 && f.spread <= 7) st = { type: 'circle', cx: cx, cz: cz, gy: f.avg, pad: 8, blend: 5, reach: 9 };
    }
    if (st) {
      st.rx = rx; st.rz = rz;
      if (st.zone === undefined) st.zone = st.pad + st.blend + 2;
      if (Math.hypot(st.cx, st.cz) < st.reach + 8) st = null;   // keep the spawn point clear
    }
    return st;
  }
  function structAt(x, z) { return structureFor(Math.floor(x / REG), Math.floor(z / REG)); }
  function inStructZone(x, z) { const st = structAt(x, z); return !!st && Math.hypot(x - st.cx, z - st.cz) <= st.zone; }
  // Terrain height, levelled and blended around structures so they sit on flat ground
  function groundH(x, z) {
    const h0 = heightAt(x, z), st = structAt(x, z);
    if (!st || !st.pad) return h0;
    const d = Math.hypot(x - st.cx, z - st.cz);
    if (d <= st.pad) return st.gy;
    if (d < st.pad + st.blend) { const t = smooth((d - st.pad) / st.blend); return Math.round(st.gy + (h0 - st.gy) * t); }
    return h0;
  }
  function forceSand(x, z) {
    const st = structAt(x, z);
    return !!st && st.type === 'temple' && Math.hypot(x - st.cx, z - st.cz) <= st.pad + st.blend * 0.5;
  }
  function nearestStructure() {
    const prx = Math.floor(player.x / REG), prz = Math.floor(player.z / REG);
    let best = null, bd = 1e9;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const st = structureFor(prx + dx, prz + dz);
      if (!st) continue;
      const d = Math.hypot(st.cx - player.x, st.cz - player.z);
      if (d < bd) { bd = d; best = st; }
    }
    return best ? STRUCT_NAMES[best.type] + ' ' + Math.round(bd) + ' m' : 'nothing close';
  }

  function eachXZ(x0, z0, a1, b1, a2, b2, fn) {
    for (let x = Math.max(a1, x0); x <= Math.min(a2, x0 + 15); x++) for (let z = Math.max(b1, z0); z <= Math.min(b2, z0 + 15); z++) fn(x, z);
  }
  function clearAbove(P, st, x0, z0, rad, h) {
    eachXZ(x0, z0, st.cx - rad, st.cz - rad, st.cx + rad, st.cz + rad, function (x, z) {
      if (Math.hypot(x - st.cx, z - st.cz) > rad) return;
      for (let y = st.gy + 1; y <= st.gy + h; y++) P(x, y, z, 0);
    });
  }
  // A small house: map(u, v) gives world x,z. u runs along the roof ridge, v from the front door to the back wall.
  function buildHouse(P, map, gy, w, d, style) {
    const wall = style === 1 ? COBBLE : PLANKS, roof = [PLANKS, COBBLE, BRICK][style % 3];
    const mu = Math.floor(w / 2), mv = Math.floor(d / 2);
    for (let u = 0; u < w; u++) {
      for (let v = 0; v < d; v++) {
        const m = map(u, v), x = m[0], z = m[1];
        P(x, gy, z, PLANKS);
        const edge = u === 0 || u === w - 1 || v === 0 || v === d - 1;
        const corner = (u === 0 || u === w - 1) && (v === 0 || v === d - 1);
        for (let y = 1; y <= 3; y++) {
          let b = 0;
          if (edge) {
            b = corner ? WOOD : wall;
            if (v === 0 && u === mu && y <= 2) b = 0;
            if (y === 2 && (u === 0 || u === w - 1) && v === mv) b = 0;
            if (y === 2 && v === d - 1 && u === mu) b = 0;
          }
          P(x, gy + y, z, b);
        }
        for (let L = 0; L <= Math.floor((d - 1) / 2); L++) if (v >= L && v <= d - 1 - L) P(x, gy + 4 + L, z, roof);
      }
    }
    const tm = map(1, 1); P(tm[0], gy + 1, tm[1], TORCH);
    if (w >= 5) { const tb = map(w - 2, 1); P(tb[0], gy + 1, tb[1], CTABLE); }
    {
      const bf = map(1, d - 2), bh = map(2, d - 2), ddx = bh[0] - bf[0], ddz = bh[1] - bf[1];
      const bdir = ddx > 0 ? 0 : (ddx < 0 ? 2 : (ddz > 0 ? 1 : 3));
      P(bf[0], gy + 1, bf[1], 19 + bdir * 2); P(bh[0], gy + 1, bh[1], 19 + bdir * 2 + 1);
    }
  }
  function buildFarm(P, map, gy, w, d) {
    for (let u = 0; u < w; u++) {
      for (let v = 0; v < d; v++) {
        const m = map(u, v), x = m[0], z = m[1];
        P(x, gy, z, DIRT);
        if (v % 2 === 1) P(x, gy + 1, z, LEAVES);
        if ((u === 0 || u === w - 1) && (v === 0 || v === d - 1)) { P(x, gy + 1, z, WOOD); P(x, gy + 2, z, WOOD); }
      }
    }
    const a = map(1, d), b = map(2, d);
    P(a[0], gy + 1, a[1], HAY); P(a[0], gy + 2, a[1], HAY); P(b[0], gy + 1, b[1], HAY);
  }
  function buildBellTower(P, map, gy) {
    for (let u = 0; u < 5; u++) {
      for (let v = 0; v < 5; v++) {
        const m = map(u, v), x = m[0], z = m[1];
        const edge = u === 0 || u === 4 || v === 0 || v === 4, corner = (u === 0 || u === 4) && (v === 0 || v === 4);
        P(x, gy, z, COBBLE);
        for (let y = 1; y <= 7; y++) {
          let b = 0;
          if (edge) {
            b = corner ? WOOD : STONEBRICK;
            if (v === 0 && u === 2 && y <= 2) b = 0;
            if (y === 5 && ((u === 0 || u === 4) && v === 2 || v === 4 && u === 2)) b = 0;
          }
          P(x, gy + y, z, b);
        }
        for (let L = 0; L <= 2; L++) if (u >= L && u <= 4 - L && v >= L && v <= 4 - L) P(x, gy + 8 + L, z, BRICK);
      }
    }
    const c = map(2, 2); P(c[0], gy + 11, c[1], GOLD);
  }
  function buildVillage(P, st, x0, z0) {
    const cx = st.cx, cz = st.cz, gy = st.gy;
    clearAbove(P, st, x0, z0, st.pad, 14);
    eachXZ(x0, z0, cx - 18, cz, cx + 18, cz, function (x, z) { if (Math.abs(x - cx) > 1) P(x, gy, z, GRAVEL); });
    eachXZ(x0, z0, cx, cz - 18, cx, cz + 18, function (x, z) { if (Math.abs(z - cz) > 1) P(x, gy, z, GRAVEL); });
    // well in the middle
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const x = cx + dx, z = cz + dz, ring = dx !== 0 || dz !== 0, corner = dx !== 0 && dz !== 0;
      P(x, gy, z, COBBLE);
      if (ring) P(x, gy + 1, z, corner ? WOOD : COBBLE);
      if (corner) { P(x, gy + 2, z, WOOD); P(x, gy + 3, z, WOOD); }
      P(x, gy + 4, z, PLANKS);
    }
    for (let k = 0; k <= 3; k++) P(cx, gy - k, cz, 0);
    P(cx, gy - 4, cz, COBBLE);
    P(cx, gy + 5, cz, TORCH);
    [[14, 1], [-14, -1], [1, 14], [-1, -14]].forEach(function (o) {
      P(cx + o[0], gy + 1, cz + o[1], WOOD); P(cx + o[0], gy + 2, cz + o[1], WOOD); P(cx + o[0], gy + 3, cz + o[1], TORCH);
    });
    // buildings along the four roads
    for (let a = 0; a < 4; a++) {
      for (let si = 0; si < 2; si++) {
        const sg = si === 0 ? -1 : 1, key = st.rx * 8 + a * 2 + si;
        if (hash2(key, st.rz, seed + 601) > 0.74) continue;
        const kind = hash2(key, st.rz, seed + 602), style = Math.floor(hash2(key, st.rz, seed + 603) * 3);
        const dd = DIRS[a], px = -dd[1], pz = dd[0], tA = 9;
        const map = function (u, v) { return [cx + dd[0] * (tA + u) + px * sg * (2 + v), cz + dd[1] * (tA + u) + pz * sg * (2 + v)]; };
        if (kind < 0.48) buildHouse(P, map, gy, 5, 5, style);
        else if (kind < 0.66) buildHouse(P, map, gy, 7, 5, style);
        else if (kind < 0.88) buildFarm(P, map, gy, 7, 6);
        else buildBellTower(P, map, gy);
      }
    }
  }
  function buildTemple(P, st, x0, z0) {
    const cx = st.cx, cz = st.cz, gy = st.gy;
    clearAbove(P, st, x0, z0, st.pad, 16);
    eachXZ(x0, z0, cx - 10, cz - 10, cx + 10, cz + 10, function (x, z) { for (let y = gy - 4; y <= gy; y++) P(x, y, z, SANDSTONE); });
    for (let L = 0; L < 10; L++) {
      const half = 10 - L, y = gy + 1 + L;
      eachXZ(x0, z0, cx - half, cz - half, cx + half, cz + half, function (x, z) {
        const rim = Math.abs(x - cx) === half || Math.abs(z - cz) === half;
        P(x, y, z, (L === 3 && rim && ((x + z) & 1) === 0) ? BRICK : SANDSTONE);
      });
    }
    eachXZ(x0, z0, cx - 3, cz - 3, cx + 3, cz + 3, function (x, z) { for (let y = gy + 1; y <= gy + 4; y++) P(x, y, z, 0); });
    eachXZ(x0, z0, cx - 1, cz - 10, cx + 1, cz - 3, function (x, z) { for (let y = gy + 1; y <= gy + 2; y++) P(x, y, z, 0); });
    P(cx, gy + 1, cz, BRICK); P(cx, gy + 2, cz, GOLD);
    [[-2, -2], [2, -2], [-2, 2], [2, 2]].forEach(function (o) { for (let y = gy + 1; y <= gy + 4; y++) P(cx + o[0], y, cz + o[1], SANDSTONE); });
  }
  function buildRuinTower(P, st, x0, z0) {
    const gy = st.gy, bx = st.cx - 3, bz = st.cz - 3;
    clearAbove(P, st, x0, z0, 6, 16);
    for (let u = 0; u < 7; u++) {
      for (let v = 0; v < 7; v++) {
        const x = bx + u, z = bz + v;
        const edge = u === 0 || u === 6 || v === 0 || v === 6, corner = (u === 0 || u === 6) && (v === 0 || v === 6);
        P(x, gy, z, COBBLE);
        if (edge) {
          const top = (corner ? 13 : 13 - Math.floor(hash2(x, z, seed + 710) * 7));
          for (let y = 1; y <= top; y++) {
            let b = hash2(x, z + y * 31, seed + 711) < 0.35 ? MOSSY : STONEBRICK;
            if (v === 0 && u === 3 && y <= 2) b = 0;
            if ((y === 6 || y === 10) && !corner && ((u === 3 && (v === 0 || v === 6)) || (v === 3 && (u === 0 || u === 6)))) b = 0;
            if (b) P(x, gy + y, z, b);
          }
        } else {
          for (const fy of [5, 9]) if (hash2(x, z + fy, seed + 712) < 0.7) P(x, gy + fy, z, PLANKS);
        }
      }
    }
  }
  function buildCabin(P, st, x0, z0) {
    const gy = st.gy;
    clearAbove(P, st, x0, z0, 8, 10);
    buildHouse(P, function (u, v) { return [st.cx - 3 + u, st.cz - 2 + v]; }, gy, 7, 5, Math.floor(hash2(st.rx, st.rz, seed + 720) * 3));
    P(st.cx + 5, gy + 1, st.cz - 2, HAY); P(st.cx + 5, gy + 2, st.cz - 2, HAY); P(st.cx + 5, gy + 1, st.cz - 1, HAY);
    P(st.cx - 5, gy + 1, st.cz - 3, WOOD); P(st.cx - 5, gy + 2, st.cz - 3, WOOD);
  }
  function buildCircle(P, st, x0, z0) {
    const gy = st.gy, cx = st.cx, cz = st.cz;
    clearAbove(P, st, x0, z0, 8, 8);
    eachXZ(x0, z0, cx - 7, cz - 7, cx + 7, cz + 7, function (x, z) {
      if (Math.hypot(x - cx, z - cz) <= 6.5 && hash2(x, z, seed + 730) < 0.55) P(x, gy, z, GRAVEL);
    });
    for (let k = 0; k < 8; k++) {
      const px = Math.round(cx + Math.cos(k * Math.PI / 4) * 5), pz = Math.round(cz + Math.sin(k * Math.PI / 4) * 5);
      let ph = 3 + Math.floor(hash2(px, pz, seed + 731) * 3);
      if (hash2(px, pz, seed + 732) < 0.25) ph = 1;
      for (let y = 1; y <= ph; y++) P(px, gy + y, pz, hash2(px, pz + y, seed + 733) < 0.4 ? MOSSY : STONEBRICK);
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) P(cx + dx, gy + 1, cz + dz, STONEBRICK);
    P(cx, gy + 2, cz, GOLD);
  }
  // Underground room with a stairway down from the surface
  function buildDungeon(P, st) {
    const gy = st.gy, x0 = st.cx, z0 = st.cz;
    const mix = function (x, y, z) { return hash2(x, y * 7 + z, seed + 740) < 0.45 ? MOSSY : COBBLE; };
    for (let x = x0 + 9; x <= x0 + 17; x++) for (let z = z0 - 4; z <= z0 + 4; z++) for (let y = gy - 10; y <= gy - 5; y++) P(x, y, z, mix(x, y, z));
    for (let i = 0; i <= 9; i++) {
      const x = x0 + i, fy = gy - i - 1;
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dz) === 2) { for (let y = fy + 1; y <= fy + 3; y++) P(x, y, z0 + dz, mix(x, y, z0 + dz)); }
        else {
          P(x, fy, z0 + dz, mix(x, fy, z0 + dz));
          for (let y = fy + 1; y <= fy + 3; y++) P(x, y, z0 + dz, 0);
          if (i >= 2) P(x, fy + 4, z0 + dz, mix(x, fy + 4, z0 + dz));
        }
      }
    }
    for (let dz = -2; dz <= 2; dz++) P(x0, gy + 4, z0 + dz, MOSSY);
    for (const dz of [-2, 2]) for (let y = gy + 1; y <= gy + 3; y++) P(x0, y, z0 + dz, MOSSY);
    for (let x = x0 + 10; x <= x0 + 16; x++) for (let z = z0 - 3; z <= z0 + 3; z++) for (let y = gy - 9; y <= gy - 6; y++) P(x, y, z, 0);
    for (let dz = -1; dz <= 1; dz++) for (let y = gy - 9; y <= gy - 7; y++) P(x0 + 9, y, z0 + dz, 0);
    P(x0 + 13, gy - 9, z0, STONEBRICK); P(x0 + 13, gy - 8, z0, GOLD);
    P(x0 + 11, gy - 6, z0 - 2, TORCH); P(x0 + 11, gy - 6, z0 + 2, TORCH);
    [[11, -2], [11, 2], [15, -2], [15, 2]].forEach(function (o) { for (let y = gy - 9; y <= gy - 7; y++) P(x0 + o[0], y, z0 + o[1], STONEBRICK); });
  }
  function buildStructure(st, put, x0, z0) {
    const P = function (x, y, z, b) { put(x, y, z, b, false); };
    switch (st.type) {
      case 'village': buildVillage(P, st, x0, z0); break;
      case 'temple': buildTemple(P, st, x0, z0); break;
      case 'tower': buildRuinTower(P, st, x0, z0); break;
      case 'dungeon': buildDungeon(P, st); break;
      case 'cabin': buildCabin(P, st, x0, z0); break;
      case 'circle': buildCircle(P, st, x0, z0); break;
    }
  }

  function genChunk(cx, cz) {
    const sv = dimension === 'overworld' ? savedChunks.get(ckey(cx, cz)) : null;
    if (sv) {
      const sc = { cx: cx, cz: cz, data: new Uint8Array(sv), mesh: null, meshed: false, edited: true, dirty: false };
      chunks.set(ckey(cx, cz), sc); resetChunkCache();
      return sc;
    }
    const data = new Uint8Array(16 * H * 16);
    const x0 = cx * 16, z0 = cz * 16;
    // Separate Nether and End terrain generators. They reuse the game's block atlas,
    // but create distinct landscapes and keep the normal Overworld generator unchanged.
    if (dimension === 'nether' || dimension === 'end') {
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const wx = x0 + lx, wz = z0 + lz;
        const dist = Math.hypot(wx, wz);
        if (dimension === 'nether') {
          const floor = 8 + Math.floor(fbm(wx / 19, wz / 19, seed + 810) * 7);
          for (let y = 0; y <= floor; y++) {
            let b = y < 3 ? STONEBRICK : (y < floor - 1 ? BRICK : (y === floor ? BRICK : DIRT));
            if (y === floor && hash2(wx, wz, seed + 811) > 0.94) b = GOLD;
            data[(y * 16 + lz) * 16 + lx] = b;
          }
          // Hanging netherrack-like ceiling makes the dimension feel enclosed.
          const ceil = 39 + Math.floor(fbm(wx / 23, wz / 23, seed + 812) * 5);
          for (let y = ceil; y < H; y++) data[(y * 16 + lz) * 16 + lx] = (y === ceil ? BRICK : STONEBRICK);
          if (hash2(wx, wz, seed + 813) > 0.985) {
            for (let y = floor + 1; y < Math.min(ceil, floor + 5); y++) data[(y * 16 + lz) * 16 + lx] = 0;
          }
        } else {
          // The End is a floating central island surrounded by the void.
          const edge = 29 + fbm(wx / 12, wz / 12, seed + 820) * 7;
          if (dist < edge) {
            const top = 19 + Math.floor(fbm(wx / 10, wz / 10, seed + 821) * 3);
            for (let y = top - 5; y <= top; y++) {
              if (y >= 0) data[(y * 16 + lz) * 16 + lx] = y === top ? SANDSTONE : STONEBRICK;
            }
          }
          // Small distant floating islands
          const island = Math.hypot(wx - 48, wz + 24);
          if (island < 7 + fbm(wx / 5, wz / 5, seed + 822) * 2) {
            for (let y = 15; y <= 18; y++) data[(y * 16 + lz) * 16 + lx] = y === 18 ? SANDSTONE : STONEBRICK;
          }
        }
      }
      // Procedurally generate Nether structures inside this chunk so they stay
      // deterministic and do not pop in differently when neighbouring chunks load.
      if (dimension === 'nether') {
        const putNether = function (x, y, z, b) {
          if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16 || y < 0 || y >= H) return;
          data[(y * 16 + (z - z0)) * 16 + (x - x0)] = b;
        };
        const structureRoll = hash2(cx, cz, seed + 860);
        const sx = x0 + 3 + Math.floor(hash2(cx, cz, seed + 861) * 6);
        const sz = z0 + 3 + Math.floor(hash2(cx, cz, seed + 862) * 6);
        const baseY = 13 + Math.floor(fbm(sx / 19, sz / 19, seed + 810) * 7);
        if (structureRoll > 0.90) {
          // Nether fortress: a raised brick keep with towers, battlements and a bridge.
          for (let dx = 0; dx < 10; dx++) for (let dz = 0; dz < 10; dz++) {
            const edge = dx === 0 || dx === 9 || dz === 0 || dz === 9;
            putNether(sx + dx, baseY, sz + dz, BRICK);
            if (edge) for (let dy = 1; dy <= 4; dy++) {
              if (dy === 2 && (dx === 0 || dx === 9 || dz === 0 || dz === 9) && ((dx + dz) % 3 === 0)) continue;
              putNether(sx + dx, baseY + dy, sz + dz, BRICK);
            }
            if (dx % 3 === 0 && dz % 3 === 0) putNether(sx + dx, baseY + 5, sz + dz, STONEBRICK);
          }
          // Raised walkway and chunky support pillars.
          for (let dx = -3; dx <= 2; dx++) {
            for (let dz = 4; dz <= 5; dz++) putNether(sx + dx, baseY + 2, sz + dz, BRICK);
            for (let dy = -3; dy <= 1; dy++) putNether(sx + dx, baseY + dy, sz + 4, STONEBRICK);
          }
          putNether(sx + 4, baseY + 1, sz + 4, TORCH);
        } else if (structureRoll > 0.84) {
          // Bastion-like ruin: dark stonebrick courtyard, gold treasure pile and broken walls.
          for (let dx = 0; dx < 10; dx++) for (let dz = 0; dz < 9; dz++) {
            putNether(sx + dx, baseY, sz + dz, STONEBRICK);
            if ((dx === 0 || dx === 9 || dz === 0 || dz === 8) && hash2(sx + dx, sz + dz, seed + 863) > 0.16) {
              const wallH = 2 + Math.floor(hash2(dx, dz, seed + 864) * 3);
              for (let dy = 1; dy <= wallH; dy++) putNether(sx + dx, baseY + dy, sz + dz, STONEBRICK);
            }
          }
          for (let dx = 3; dx <= 6; dx++) for (let dz = 3; dz <= 5; dz++) putNether(sx + dx, baseY + 1, sz + dz, GOLD);
          for (let dy = 1; dy <= 4; dy++) {
            putNether(sx + 2, baseY + dy, sz + 2, BRICK);
            putNether(sx + 7, baseY + dy, sz + 6, BRICK);
          }
        }
      }
      const c = { cx: cx, cz: cz, data: data, mesh: null, meshed: false, edited: false, dirty: false };
      chunks.set(ckey(cx, cz), c); resetChunkCache();
      return c;
    }
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const h = groundH(x0 + lx, z0 + lz), beach = h <= SEA + 1 || forceSand(x0 + lx, z0 + lz);
        for (let y = 0; y <= h; y++) {
          let b;
          if (y === h) b = beach ? SAND : GRASS;
          else if (y >= h - 3) b = beach ? SAND : DIRT;
          else b = STONE;
          data[(y * 16 + lz) * 16 + lx] = b;
        }
      }
    }
    // Fill low coastal areas with walk-through water up to sea level.
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const wx = x0 + lx, wz = z0 + lz, h = groundH(wx, wz);
      if (h < SEA && !inStructZone(wx, wz)) {
        for (let wy = h + 1; wy <= SEA; wy++) data[(wy * 16 + lz) * 16 + lx] = WATER;
      }
      // Small underground lava pockets, deterministic for each world seed.
      if (h > 7 && hash2(wx, wz, seed + 940) > 0.992) {
        const ly = 3 + Math.floor(hash2(wx, wz, seed + 941) * 3);
        const li = (ly * 16 + lz) * 16 + lx;
        if (data[li] === STONE) data[li] = LAVA;
      }
    }
    // Ore veins hide inside the stone: [ore, attempts per chunk, min y, max y, max vein size]
    const oreRng = mulberry32((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ Math.imul(seed, 83492791)) >>> 0);
    [[COAL_ORE, 16, 4, 42, 8], [COPPER_ORE, 9, 3, 32, 6], [IRON_ORE, 9, 2, 30, 5], [DIAMOND_ORE, 2, 1, 12, 2]].forEach(function (o) {
      for (let a = 0; a < o[1]; a++) {
        let vx = Math.floor(oreRng() * 16), vz = Math.floor(oreRng() * 16), vy = o[2] + Math.floor(oreRng() * (o[3] - o[2] + 1));
        const size = 1 + Math.floor(oreRng() * o[4]);
        for (let k = 0; k < size; k++) {
          if (vx >= 0 && vx < 16 && vz >= 0 && vz < 16 && vy >= 1 && vy < H) { const i = (vy * 16 + vz) * 16 + vx; if (data[i] === STONE) data[i] = o[0]; }
          vx += Math.floor(oreRng() * 3) - 1; vy += Math.floor(oreRng() * 3) - 1; vz += Math.floor(oreRng() * 3) - 1;
        }
      }
    });
    const put = function (x, y, z, b, onlyAir) {
      if (x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16 || y < 0 || y >= H) return;
      const i = (y * 16 + (z - z0)) * 16 + (x - x0);
      if (!onlyAir || data[i] === 0) data[i] = b;
    };
    // Trees come from a fixed grid, so every chunk agrees on them without talking to its neighbours
    const c0 = Math.floor((x0 - 3) / 7), c1 = Math.floor((x0 + 18) / 7);
    const d0 = Math.floor((z0 - 3) / 7), d1 = Math.floor((z0 + 18) / 7);
    for (let gz = d0; gz <= d1; gz++) {
      for (let gx = c0; gx <= c1; gx++) {
        if (hash2(gx, gz, seed + 7) > 0.55) continue;
        const tx = gx * 7 + 3 + Math.floor(hash2(gx, gz, seed + 8) * 3);
        const tz = gz * 7 + 3 + Math.floor(hash2(gx, gz, seed + 9) * 3);
        if (inStructZone(tx, tz)) continue;
        const gy = heightAt(tx, tz);
        if (gy <= SEA + 1) continue;
        const th = 4 + Math.floor(hash2(gx, gz, seed + 10) * 3);
        for (let k = 1; k <= th; k++) put(tx, gy + k, tz, WOOD, false);
        for (let dy = th - 2; dy <= th + 1; dy++) {
          const r = dy >= th ? 1 : 2;
          for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && (r === 2 || dy === th + 1) && hash2(tx + dx, tz + dz + dy, seed) < 0.5) continue;
            put(tx + dx, gy + dy, tz + dz, LEAVES, true);
          }
        }
      }
    }
    const rs = structureFor(Math.floor(x0 / REG), Math.floor(z0 / REG));
    if (rs && Math.abs(rs.cx - (x0 + 8)) <= rs.reach + 8 && Math.abs(rs.cz - (z0 + 8)) <= rs.reach + 8) buildStructure(rs, put, x0, z0);
    const c = { cx: cx, cz: cz, data: data, mesh: null, meshed: false, edited: false, dirty: false };
    chunks.set(ckey(cx, cz), c); resetChunkCache();
    return c;
  }
  function getOrGen(cx, cz) { return chunkAt(cx, cz) || genChunk(cx, cz); }
  function topY(x, z) { for (let y = H - 1; y >= 0; y--) if (solid(get(x, y, z))) return y; return 0; }

  function resetWorld(newSeed, ox, oz) {
    chunks.forEach(function (c) { disposeMesh(c); });
    chunks.clear(); resetChunkCache();
    seed = newSeed; structCache.clear();
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) genChunk(ox + dx, oz + dz);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) buildChunk(ox + dx, oz + dz);
  }

  const streamChunks = createChunkStreamer({
    chunks, viewDistance: R,
    getPlayer: () => player,
    getOrGen, genChunk, buildChunk, disposeMesh, resetChunkCache,
  });

  /* ---------- Game state ---------- */
  let mode = 'creative';
  let difficulty = 'normal';
  let spawnPoint = null, sleepT = 0, slept = false, omen = false;
  let hunger = 20, sat = 5, exhaust = 0, starveT = 0, shownHunger = -1;
  let weather = 'clear', weatherT = 420, rainLevel = 0, rainTarget = 0, lightningT = 0, nextBolt = 8;   // rain and thunderstorms   // Survival hunger: 20 = full   // bed respawn point, sleeping timer, raid omen
  // Difficulty only matters in Survival and Adventure (the modes with health and monsters)
  const DIFF = {
    peaceful: { label: 'Peaceful', cap: 0, every: 99, dmg: 0, speed: 1, aggro: 32, fuse: 1.5, shoot: 1, regenAfter: 1, regenEvery: 1, raid: 0, patrol: [1e9, 1e9] },
    easy: { label: 'Easy', cap: 4, every: 3.4, dmg: 0.6, speed: 0.9, aggro: 24, fuse: 1.9, shoot: 1.35, regenAfter: 4, regenEvery: 2.5, raid: 0.6, patrol: [150, 240] },
    normal: { label: 'Normal', cap: 8, every: 2.2, dmg: 1, speed: 1, aggro: 32, fuse: 1.5, shoot: 1, regenAfter: 6, regenEvery: 3, raid: 1, patrol: [90, 160] },
    hard: { label: 'Hard', cap: 12, every: 1.6, dmg: 1.5, speed: 1.15, aggro: 42, fuse: 1.1, shoot: 0.75, regenAfter: 9, regenEvery: 4.5, raid: 1.5, patrol: [60, 110] }
  };
  const MAXHP = 20;
  let hp = MAXHP, sinceHurt = 99, regenT = 0, dead = false;
  const inv = {};
  let specSpeed = 1;
  let isNight = false, isDay = true;

  const player = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false, fly: false, fallStart: null };
  function respawn() {
    if (spawnPoint) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) getOrGen((spawnPoint.x >> 4) + dx, (spawnPoint.z >> 4) + dz);
      if (isBed(get(spawnPoint.x, spawnPoint.y, spawnPoint.z))) {
        let by = spawnPoint.y + 0.57;
        for (let k = 0; k < 4 && collides(spawnPoint.x + 0.5, by, spawnPoint.z + 0.5); k++) by += 1;
        player.x = spawnPoint.x + 0.5; player.z = spawnPoint.z + 0.5; player.y = by;
        player.vx = player.vy = player.vz = 0; player.yaw = 0; player.pitch = -0.1; player.fallStart = null;
        return;
      }
      spawnPoint = null;   // the bed is gone
    }
    const x = 0, z = 0;
    player.x = x + 0.5; player.z = z + 0.5; player.y = topY(x, z) + 1.01;
    player.vx = player.vy = player.vz = 0; player.yaw = 0; player.pitch = -0.1; player.fallStart = null;
  }
  const PR = 0.3, PH = 1.8, EYE = 1.62;
  function collides(px, py, pz, r, h) {
    if (r === undefined) { r = PR; h = PH; }
    const x0 = Math.floor(px - r), x1 = Math.floor(px + r);
    const y0 = Math.floor(py), y1 = Math.floor(py + h - 0.0001);
    const z0 = Math.floor(pz - r), z1 = Math.floor(pz + r);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const bb = get(x, y, z);
      if (solid(bb)) { if (bb >= 19 && bb <= 26) { if (py < y + BED_H && py + h > y) return true; } else return true; }
    }
    return false;
  }
  // Move an entity (player or mob) along one axis with collision
  function moveEnt(e, axis, d) {
    if (!d) return;
    const steps = Math.max(1, Math.ceil(Math.abs(d) / 0.25));
    const sd = d / steps;
    for (let i = 0; i < steps; i++) {
      const nx = e.x + (axis === 0 ? sd : 0), ny = e.y + (axis === 1 ? sd : 0), nz = e.z + (axis === 2 ? sd : 0);
      if (collides(nx, ny, nz, e.r || PR, e.h || PH)) {
        let lo = 0, hi = 1;   // slide right up to the obstacle instead of stopping a step short
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) / 2;
          if (collides(e.x + (axis === 0 ? sd * mid : 0), e.y + (axis === 1 ? sd * mid : 0), e.z + (axis === 2 ? sd * mid : 0), e.r || PR, e.h || PH)) hi = mid; else lo = mid;
        }
        if (lo > 0) { if (axis === 0) e.x += sd * lo; else if (axis === 1) e.y += sd * lo; else e.z += sd * lo; }
        if (axis === 1) { if (sd < 0) e.onGround = true; e.vy = 0; }
        else { e.hit = true; if (axis === 0) e.vx = 0; else e.vz = 0; }
        return;
      }
      e.x = nx; e.y = ny; e.z = nz;
    }
  }

  /* ---------- Sound ---------- */
  const { Snd, saveSound, applySound, audioInit, sfx, sfxAt, updateMusic, tone, hiss } =
    createAudioEngine(() => player, () => isNight);

  /* ---------- Mobs: hostile monsters, villagers and farm animals ---------- */
  let enderDragonDefeated = false;
  const mobs = [];
  const rnd3 = n => 1 + Math.floor(Math.random() * n);
  const KINDS = {
    zombie: { hostile: true, r: 0.3, h: 1.8, hp: 20, speed: 2.7, melee: { d: 1.15, dmg: 3, cd: 1.1 }, make: makeZombie, drops: function () { return [[GUNPOWDER, Math.random() < 0.5 ? 1 : 0]]; } },
    enderdragon: { hostile: true, r: 2.8, h: 5.5, hp: 300, speed: 5.0, make: makeEnderDragon, drops: function () { return []; } },
    creeper: { hostile: true, r: 0.3, h: 1.85, hp: 20, speed: 2.4, make: makeCreeper, drops: function () { return [[GUNPOWDER, rnd3(2)]]; } },
    skeleton: { hostile: true, r: 0.3, h: 1.95, hp: 20, speed: 2.2, make: makeSkeleton, drops: function () { return [[BONE, Math.floor(Math.random() * 3)]]; } },
    spider: { hostile: true, r: 0.5, h: 0.8, hp: 16, speed: 3.2, melee: { d: 1.5, dmg: 2, cd: 0.9 }, make: makeSpider, drops: function () { return [[STRING, Math.floor(Math.random() * 3)]]; } },
    pillager: { hostile: true, illager: true, r: 0.3, h: 1.95, hp: 24, speed: 2.5, make: makePillager, drops: function () { return [[EMERALD, Math.random() < 0.5 ? 1 : 0], [GUNPOWDER, Math.random() < 0.3 ? 1 : 0]]; } },
    vindicator: { hostile: true, illager: true, r: 0.3, h: 1.95, hp: 24, speed: 3.0, melee: { d: 1.5, dmg: 6, cd: 1.0 }, make: makeVindicator, drops: function () { return [[EMERALD, Math.random() < 0.6 ? 1 : 0]]; } },
    irongolem: { golem: true, follow: false, hostile: false, r: 0.45, h: 2.7, hp: 100, speed: 2.2, range: 16, melee: { d: 2.4, dmg: 18, cd: 1.1, lift: 9 }, make: makeIronGolem, drops: function () { return [[IRON_INGOT, 3 + Math.floor(Math.random() * 3)]]; } },
    coppergolem: { golem: true, follow: true, hostile: false, r: 0.28, h: 1.45, hp: 40, speed: 3.4, range: 12, melee: { d: 1.3, dmg: 6, cd: 0.7, lift: 3 }, make: makeCopperGolem, drops: function () { return [[COPPER_INGOT, rnd3(2)]]; } },
    diamondgolem: { golem: true, follow: true, hostile: false, r: 0.55, h: 3.4, hp: 200, speed: 2.8, range: 20, melee: { d: 2.8, dmg: 30, cd: 1.0, lift: 11 }, make: makeDiamondGolem, drops: function () { return [[DIAMOND, 2 + Math.floor(Math.random() * 3)]]; } },
    villager: { hostile: false, r: 0.3, h: 1.95, hp: 20, speed: 0.9, make: makeVillager, drops: function () { return []; } },
    cow: { hostile: false, r: 0.45, h: 1.5, hp: 10, speed: 1.0, make: makeCow, drops: function () { return [[BEEF, rnd3(3)], [LEATHER, Math.random() < 0.5 ? 1 : 0]]; } },
    pig: { hostile: false, r: 0.4, h: 0.95, hp: 10, speed: 1.1, make: makePig, drops: function () { return [[PORK, rnd3(3)]]; } },
    sheep: { hostile: false, r: 0.45, h: 1.4, hp: 8, speed: 1.0, make: makeSheep, drops: function () { return [[MUTTON, rnd3(2)], [WOOL, rnd3(2)]]; } },
    chicken: { hostile: false, r: 0.2, h: 0.8, hp: 4, speed: 1.4, make: makeChicken, drops: function () { return [[CHICKEN, 1], [FEATHER, Math.floor(Math.random() * 3)]]; } }
  };
  const ANIMALS = ['cow', 'pig', 'sheep', 'chicken'];
  function addMob(kind, x, y, z, opts) {
    const K = KINDS[kind];
    const m = { kind: kind, hostile: K.hostile, r: K.r, h: K.h, hp: K.hp, x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, onGround: false, hit: false,
      atk: 0.8, burn: -1, phase: Math.random() * 6, ai: Math.random() * 3, walk: false, dx: 0, dz: 1, panic: 0, face: Math.random() * 6.28,
      jumpCd: 0, persist: false, golem: !!K.golem, fuse: -1, shoot: 1.5 + Math.random(), snd: 3 + Math.random() * 8, job: opts && opts.job, village: null, hx: 0, hz: 0,
      group: K.make(opts || {}) };
    m.group.position.set(x, y, z);
    scene.add(m.group); mobs.push(m);
    return m;
  }
  function removeMobAt(i) { scene.remove(mobs[i].group); mobs.splice(i, 1); }
  function clearMobs() {
    mobs.forEach(function (m) { if (m.village) m.village.vSpawned = false; });   // villages repopulate afterwards
    while (mobs.length) removeMobAt(mobs.length - 1);
    while (blasts.length) removeBlastAt(blasts.length - 1);
    while (fx.length) removeFxAt(fx.length - 1);
    while (arrows.length) { scene.remove(arrows.pop().mesh); }
    pendingBlasts.length = 0; pendingHits.length = 0;
    endRaid(null);
    shake = 0;
  }
  function nearTorch(x, y, z, rad) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    for (let dy = -3; dy <= 4; dy++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) if (get(bx + dx, by + dy, bz + dz) === TORCH) return true;
    return false;
  }
  function trySpawnMob() {
    const a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 12;
    const x = Math.floor(player.x + Math.cos(a) * d), z = Math.floor(player.z + Math.sin(a) * d);
    if (!chunkAt(x >> 4, z >> 4)) return;
    const y = topY(x, z), b = get(x, y, z);
    if (b === LEAVES || b === WOOD) return;
    const r = Math.random(), kind = r < 0.42 ? 'zombie' : (r < 0.62 ? 'creeper' : (r < 0.82 ? 'skeleton' : 'spider')), K = KINDS[kind];
    if (collides(x + 0.5, y + 1.01, z + 0.5, K.r, K.h)) return;
    if (nearTorch(x + 0.5, y + 1, z + 0.5, 8)) return;    // torches keep monsters from spawning nearby
    addMob(kind, x + 0.5, y + 1.01, z + 0.5);
  }
  function trySpawnAnimals() {
    const a = Math.random() * Math.PI * 2, d = 16 + Math.random() * 26;
    const bx = player.x + Math.cos(a) * d, bz = player.z + Math.sin(a) * d;
    const kind = ANIMALS[Math.floor(Math.random() * ANIMALS.length)], K = KINDS[kind];
    const n = kind === 'chicken' ? 2 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(bx + (Math.random() - 0.5) * 5), z = Math.floor(bz + (Math.random() - 0.5) * 5);
      if (!chunkAt(x >> 4, z >> 4)) continue;
      const y = topY(x, z);
      if (get(x, y, z) !== GRASS) continue;
      if (collides(x + 0.5, y + 1.01, z + 0.5, K.r, K.h)) continue;
      addMob(kind, x + 0.5, y + 1.01, z + 0.5);
    }
  }
  let spawnT = 2, animalT = 0.5, villT = 0.2, patrolT = 70;
  const pendingBlasts = [], pendingHits = [], arrows = [];
  function hasLOS(m, tgt) {
    const tx0 = tgt ? tgt.x : player.x, ty0 = (tgt ? tgt.y : player.y) + 1.2, tz0 = tgt ? tgt.z : player.z;
    const ox = m.x, oy = m.y + 1.5, oz = m.z, dx = tx0 - ox, dy = ty0 - oy, dz = tz0 - oz, d = Math.hypot(dx, dy, dz);
    const n = Math.ceil(d / 0.6);
    for (let i = 1; i < n; i++) { const t = i / n; if (solid(get(Math.floor(ox + dx * t), Math.floor(oy + dy * t), Math.floor(oz + dz * t)))) return false; }
    return true;
  }
  function shootArrow(m, dmg, tgt) {
    const tx0 = tgt ? tgt.x : player.x, ty0 = (tgt ? tgt.y : player.y) + 1.2, tz0 = tgt ? tgt.z : player.z;
    const ox = m.x, oy = m.y + 1.5, oz = m.z, dx = tx0 - ox, dy = ty0 - oy, dz = tz0 - oz;
    const d = Math.hypot(dx, dy, dz) || 1, sp = 20;
    const vx = dx / d * sp, vz = dz / d * sp, vy = dy / d * sp + 0.3 * d;
    const g = new THREE.Group();
    part(g, 0.05, 0.05, 0.6, 0x8a6a3c, 0, 0, 0); part(g, 0.08, 0.08, 0.08, 0xcfcfcf, 0, 0, 0.32);
    g.position.set(ox, oy, oz); scene.add(g); g.lookAt(ox + vx, oy + vy, oz + vz);
    arrows.push({ x: ox, y: oy, z: oz, vx: vx, vy: vy, vz: vz, mesh: g, life: 6, stuck: false, dmg: dmg || 3 });
    sfxAt('arrow', ox, oy, oz);
  }
  function updateArrows(dt) {
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      a.life -= dt;
      if (a.life <= 0) { scene.remove(a.mesh); arrows.splice(i, 1); continue; }
      if (a.stuck) continue;
      a.vy -= 12 * dt;
      const steps = Math.max(1, Math.ceil(Math.hypot(a.vx, a.vy, a.vz) * dt / 0.3));
      let gone = false;
      for (let s2 = 0; s2 < steps; s2++) {
        const nx = a.x + a.vx * dt / steps, ny = a.y + a.vy * dt / steps, nz = a.z + a.vz * dt / steps;
        if (collides(nx, ny - 0.05, nz, 0.05, 0.1)) { a.stuck = true; a.life = Math.min(a.life, 3); break; }
        a.x = nx; a.y = ny; a.z = nz;
        if (hasHealth() && Math.abs(a.x - player.x) < 0.45 && Math.abs(a.z - player.z) < 0.45 && a.y > player.y && a.y < player.y + 1.8) {
          damagePlayer(a.dmg || 3, true); sfx('hit'); scene.remove(a.mesh); arrows.splice(i, 1); gone = true; break;
        }
        for (let q = 0; q < mobs.length; q++) {   // arrows hit villagers too
          const o = mobs[q];
          if ((o.kind === 'villager' || o.golem) && Math.abs(a.x - o.x) < o.r + 0.15 && Math.abs(a.z - o.z) < o.r + 0.15 && a.y > o.y && a.y < o.y + o.h) {
            sfxAt('hit', o.x, o.y + 1, o.z); scene.remove(a.mesh); arrows.splice(i, 1); gone = true;
            damageMob(o, a.dmg || 3);
            break;
          }
        }
        if (gone) break;
      }
      if (gone) continue;
      a.mesh.position.set(a.x, a.y, a.z);
      if (!a.stuck) a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
    }
  }
  function spawnVillagers(st) {
    st.vSpawned = true;
    const n = 3 + Math.floor(hash2(st.rx, st.rz, seed + 900) * 3), off = Math.floor(hash2(st.rx, st.rz, seed + 901) * JOBS.length);
    for (let i = 0; i < n; i++) {
      const job = JOBS[(off + i) % JOBS.length];
      for (let tries = 0; tries < 16; tries++) {
        const rr = 3 + Math.random() * 9, a = Math.random() * Math.PI * 2;
        const x = st.cx + Math.cos(a) * rr, z = st.cz + Math.sin(a) * rr, y = st.gy + 1.01;
        if (!chunkAt(Math.floor(x) >> 4, Math.floor(z) >> 4)) continue;
        if (collides(x, y, z, 0.3, 1.95) || !solid(get(Math.floor(x), st.gy, Math.floor(z)))) continue;
        const m = addMob('villager', x, y, z, { job: job });
        m.village = st; m.hx = st.cx; m.hz = st.cz;
        break;
      }
    }
    for (let gi = 0; gi < (n >= 5 ? 2 : 1); gi++) {   // every village has an iron golem guard
      for (let tries = 0; tries < 16; tries++) {
        const rr = 4 + Math.random() * 8, a = Math.random() * Math.PI * 2;
        const x = st.cx + Math.cos(a) * rr, z = st.cz + Math.sin(a) * rr, y = st.gy + 1.01;
        if (!chunkAt(Math.floor(x) >> 4, Math.floor(z) >> 4)) continue;
        if (collides(x, y, z, 0.45, 2.7) || !solid(get(Math.floor(x), st.gy, Math.floor(z)))) continue;
        const gm = addMob('irongolem', x, y, z, null);
        gm.village = st; gm.hx = st.cx; gm.hz = st.cz;
        break;
      }
    }
  }
  function manageVillagers() {
    const prx = Math.floor(player.x / REG), prz = Math.floor(player.z / REG);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const st = structureFor(prx + dx, prz + dz);
      if (!st || st.type !== 'village') continue;
      if (Math.hypot(st.cx - player.x, st.cz - player.z) < 70 && !st.vSpawned) spawnVillagers(st);
    }
  }
  // Pillager patrols wander in from afar. Killing the banner-carrying leader brings a Bad Omen:
  // the next village you enter is raided in three waves.
  function trySpawnPatrol() {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 12;
      const bx = Math.floor(player.x + Math.cos(a) * d), bz = Math.floor(player.z + Math.sin(a) * d);
      if (!chunkAt(bx >> 4, bz >> 4)) continue;
      const n = 2 + Math.floor(Math.random() * 3);
      let made = 0;
      for (let i = 0; i < n; i++) {
        const x = bx + Math.floor((Math.random() - 0.5) * 6), z = bz + Math.floor((Math.random() - 0.5) * 6);
        if (!chunkAt(x >> 4, z >> 4)) continue;
        const y = topY(x, z), b = get(x, y, z);
        if (b === LEAVES || b === WOOD || b === 0) continue;
        const kind = (i > 0 && Math.random() < 0.25) ? 'vindicator' : 'pillager', K = KINDS[kind];
        if (collides(x + 0.5, y + 1.01, z + 0.5, K.r, K.h)) continue;
        const lead = made === 0 && kind === 'pillager';
        const m = addMob(kind, x + 0.5, y + 1.01, z + 0.5, { leader: lead });
        m.leader = lead; made++;
      }
      if (made) { showHint('A pillager patrol is nearby!', 3500); sfx('pillager'); return; }
    }
  }
  const raid = { active: false, st: null, wave: 0, cd: 0 };
  const RAID_WAVES = [[3, 0], [4, 1], [5, 2]];   // [pillagers, vindicators] on Normal
  const raidEl = document.getElementById('raid');
  function endRaid(msg) {
    const was = raid.active;
    raid.active = false; raid.st = null; raid.wave = 0;
    mobs.forEach(function (m) { m.raid = false; });
    raidEl.style.display = 'none';
    if (msg && was) showHint(msg, 4000);
  }
  function spawnRaiders(n, kind) {
    const st = raid.st, K = KINDS[kind];
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 14; tries++) {
        const a = Math.random() * Math.PI * 2, rr = 26 + Math.random() * 8;
        const x = Math.floor(st.cx + Math.cos(a) * rr), z = Math.floor(st.cz + Math.sin(a) * rr);
        if (!chunkAt(x >> 4, z >> 4)) continue;
        const y = topY(x, z), b = get(x, y, z);
        if (b === LEAVES || b === WOOD || b === 0) continue;
        if (collides(x + 0.5, y + 1.01, z + 0.5, K.r, K.h)) continue;
        const m = addMob(kind, x + 0.5, y + 1.01, z + 0.5, null); m.raid = true;
        break;
      }
    }
  }
  function updateRaid(dt, D) {
    if (!raid.active) {
      raidEl.style.display = 'none';
      if (omen && hasHealth() && D.cap > 0 && !dead) {
        const prx = Math.floor(player.x / REG), prz = Math.floor(player.z / REG);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const st = structureFor(prx + dx, prz + dz);
          if (st && st.type === 'village' && Math.hypot(st.cx - player.x, st.cz - player.z) < 30) {
            raid.active = true; raid.st = st; raid.wave = 0; raid.cd = 5; omen = false;
            showHint('A raid is coming to the village! Defend it.', 4500); sfx('pillager');
            return;
          }
        }
      }
      return;
    }
    if (dead || !hasHealth() || D.cap === 0 || Math.hypot(raid.st.cx - player.x, raid.st.cz - player.z) > 110) { endRaid('The raid has ended.'); return; }
    let alive = 0;
    for (let i = 0; i < mobs.length; i++) if (mobs[i].raid) alive++;
    raidEl.style.display = 'block';
    if (alive === 0) {
      raidEl.textContent = raid.wave >= RAID_WAVES.length ? 'Raid \u00b7 victory!' : 'Raid \u00b7 next wave incoming';
      raid.cd -= dt;
      if (raid.cd <= 0) {
        if (raid.wave >= RAID_WAVES.length) {
          endRaid(null);
          if (mode === 'survival') giveItem(EMERALD, 8);
          showHint('Raid defeated! The villagers reward you with emeralds.', 5000); sfx('yes');
        } else {
          const w = RAID_WAVES[raid.wave];
          raid.wave++;
          spawnRaiders(Math.max(1, Math.round(w[0] * D.raid)), 'pillager');
          const v = Math.round(w[1] * D.raid);
          if (v > 0) spawnRaiders(v, 'vindicator');
          raid.cd = 4; sfx('pillager');
        }
      }
    } else raidEl.textContent = 'Raid \u00b7 wave ' + raid.wave + ' of ' + RAID_WAVES.length + ' \u00b7 ' + alive + ' raider' + (alive === 1 ? '' : 's') + ' left';
  }
  function updateMobs(dt) {
    const D = DIFF[difficulty];
    if (dimension === 'end') {
      if (!enderDragonDefeated && !mobs.some(function (m) { return m.kind === 'enderdragon'; })) {
        addMob('enderdragon', player.x + 8, Math.max(28, player.y + 8), player.z + 1, { boss: true });
        showHint('ENDER DRAGON! Hit it with your sword or shoot it with arrows!', 5500);
      }
      spawnT = Math.max(spawnT, 2); animalT = Math.max(animalT, 2); villT = Math.max(villT, 2);
    }
    spawnT -= dt; animalT -= dt; villT -= dt;
    if (dimension !== 'end' && hasHealth() && spawnT <= 0) {
      spawnT = D.every;
      if (D.cap > 0 && (isNight || weather === 'storm') && mobs.filter(function (m) { return m.hostile && !KINDS[m.kind].illager; }).length < D.cap) trySpawnMob();
    }
    if (dimension !== 'end' && animalT <= 0) {
      animalT = 2.5;
      if (!isNight && mobs.filter(function (m) { return !m.hostile && m.kind !== 'villager'; }).length < 12) trySpawnAnimals();
    }
    if (dimension !== 'end' && villT <= 0) { villT = 1.5; manageVillagers(); }
    patrolT -= dt;
    if (dimension !== 'end' && patrolT <= 0) {
      patrolT = D.patrol[0] + Math.random() * (D.patrol[1] - D.patrol[0]);
      if (hasHealth() && D.cap > 0 && mobs.filter(function (m) { return KINDS[m.kind].illager && !m.raid; }).length < 6) trySpawnPatrol();
    }
    if (dimension !== 'end') updateRaid(dt, D);
    for (let i = mobs.length - 1; i >= 0; i--) {
      const m = mobs[i], K = KINDS[m.kind];
      const dx = player.x - m.x, dz = player.z - m.z;
      const dist = Math.hypot(dx, dz) || 0.0001;
      if (m.kind === 'enderdragon') {
        m.phase += dt * 2.4;
        const targetX = player.x + Math.sin(m.phase * 0.55) * 10;
        const targetZ = player.z + Math.cos(m.phase * 0.55) * 10;
        const targetY = 27 + Math.sin(m.phase * 1.3) * 4;
        const ex = targetX - m.x, ez = targetZ - m.z, ey = targetY - m.y;
        const ed = Math.hypot(ex, ez) || 1;
        m.x += ex / ed * Math.min(ed, K.speed * dt);
        m.z += ez / ed * Math.min(ed, K.speed * dt);
        m.y += Math.max(-1, Math.min(1, ey)) * dt * 2.2;
        m.group.position.set(m.x, m.y + Math.sin(m.phase * 2) * 0.35, m.z);
        m.group.rotation.y = Math.atan2(ex, ez);
        if (m.group.userData.wings) m.group.userData.wings.forEach(function (w) { w.rotation.z = Math.sin(m.phase * 5) * 0.55 * w.userData.flapSide; });
        m.atk -= dt;
        if (dist < 5.5 && Math.abs(player.y - m.y) < 7 && m.atk <= 0) {
          m.atk = 1.4; damagePlayer(5, true); player.vx += dx / dist * 7; player.vz += dz / dist * 7; player.vy = 5;
          showHint('The Ender Dragon knocked you back!', 1400);
        }
        continue;
      }
      if (m.y < -30) { removeMobAt(i); continue; }
      if (m.hostile && D.cap === 0 && hasHealth()) { removeMobAt(i); continue; }   // Peaceful: no monsters at all
      if (m.kind === 'villager' || m.village) { if (dist > 140) { if (m.village) m.village.vSpawned = false; removeMobAt(i); continue; } }
      else if (dist > (m.persist ? 120 : (K.illager ? 130 : (m.hostile ? 70 : 95)))) { removeMobAt(i); continue; }
      m.snd -= dt;
      if (m.snd <= 0) {
        m.snd = 6 + Math.random() * 10;
        if (m.kind !== 'creeper' && dist < (m.hostile ? 18 : 26)) sfxAt(m.kind, m.x, m.y + 1, m.z);
      }
      let tx = 0, tz = 0, ax = dx, az = dz, ad = dist, huntV = null;   // a*, huntV: who this monster is going after
      if (m.hostile) {
        if (isDay && rainLevel < 0.5 && !m.persist && !K.illager) {   // rain keeps monsters from burning in daylight
          if (m.burn < 0) m.burn = 1 + Math.random() * 5; m.burn -= dt; if (m.burn <= 0) { removeMobAt(i); continue; } }
        else m.burn = -1;
        const ill = !!K.illager;
        if (m.kind === 'zombie' || ill) {   // zombies and illagers go for the nearest villager when it is closer than you
          for (let q = 0; q < mobs.length; q++) {
            const o = mobs[q];
            if (o.kind !== 'villager' && !o.golem) continue;
            const vd = Math.hypot(o.x - m.x, o.z - m.z);
            if (vd < ad && vd < 40) { ad = vd; ax = o.x - m.x; az = o.z - m.z; huntV = o; }
          }
        }
        const sees = ad < (ill ? (m.raid ? 70 : D.aggro + 12) : D.aggro);
        if (ill && !sees) {   // patrols and raiders march towards the player or the village
          const hx = (m.raid && raid.st) ? raid.st.cx : player.x, hz = (m.raid && raid.st) ? raid.st.cz : player.z, hd = Math.hypot(hx - m.x, hz - m.z) || 1;
          tx = (hx - m.x) / hd * 1.5; tz = (hz - m.z) / hd * 1.5;
        }
        m.jumpCd -= dt;
        if (m.kind === 'creeper') {
          if (m.fuse >= 0) {
            m.fuse -= dt;
            const sw = 1 + (D.fuse - m.fuse) * 0.2 + (Math.floor(m.fuse * 8) % 2 ? 0.05 : 0);
            m.group.scale.setScalar(sw);
            if (m.fuse <= 0) { pendingBlasts.push({ x: m.x, y: m.y + 0.8, z: m.z, r: 3.4, p: 24 * D.dmg }); removeMobAt(i); continue; }
            if (dist > 5) { m.fuse = -1; m.group.scale.setScalar(1); }
          } else if (sees) {
            if (dist < 3.2) { m.fuse = D.fuse; sfxAt('creeper', m.x, m.y + 1, m.z); }
            else if (dist > 0.9) { tx = dx / dist * K.speed * D.speed; tz = dz / dist * K.speed * D.speed; }
          }
        } else if (m.kind === 'skeleton') {
          if (sees && dist > 11) { tx = dx / dist * K.speed * D.speed; tz = dz / dist * K.speed * D.speed; }
          else if (sees && dist < 6) { tx = -dx / dist * K.speed * D.speed; tz = -dz / dist * K.speed * D.speed; }
          m.shoot -= dt;
          if (dist < 22 && m.shoot <= 0 && hasLOS(m)) { m.shoot = (2 + Math.random() * 0.8) * D.shoot; shootArrow(m); }
        } else if (m.kind === 'pillager') {
          if (sees && ad > 13) { tx = ax / ad * K.speed * D.speed; tz = az / ad * K.speed * D.speed; }
          else if (sees && ad < 8) { tx = -ax / ad * K.speed * D.speed; tz = -az / ad * K.speed * D.speed; }
          m.shoot -= dt;
          if (ad < 26 && m.shoot <= 0 && hasLOS(m, huntV)) { m.shoot = (2.4 + Math.random() * 0.8) * D.shoot; shootArrow(m, 4, huntV); }
        } else {
          if (sees && ad > 0.9) { tx = ax / ad * K.speed * D.speed; tz = az / ad * K.speed * D.speed; }
          if (m.kind === 'spider' && sees && dist < 4.5 && m.onGround && m.jumpCd <= 0) { m.jumpCd = 1.2; m.vy = 7; m.vx = dx / dist * 5; m.vz = dz / dist * 5; }
        }
      } else if (K.golem) {
        // Golems fight any monster nearby. Copper and diamond golems tag along with you; iron golems guard their post.
        let tgt = null, td = K.range;
        for (let q = 0; q < mobs.length; q++) {
          const o = mobs[q];
          if (!o.hostile) continue;
          const d2 = Math.hypot(o.x - m.x, o.z - m.z);
          if (d2 < td) { td = d2; tgt = o; }
        }
        m.atk -= dt; m.ai -= dt;
        if (tgt) {
          const ex = tgt.x - m.x, ez = tgt.z - m.z;
          if (td > K.melee.d * 0.7) { tx = ex / td * K.speed; tz = ez / td * K.speed; }
          if (td < K.melee.d && Math.abs(tgt.y - m.y) < 3 && m.atk <= 0) {
            m.atk = K.melee.cd;
            tgt.vx += ex / (td || 1) * 6; tgt.vz += ez / (td || 1) * 6; tgt.vy = K.melee.lift;
            pendingHits.push({ m: tgt, d: K.melee.dmg });
            sfxAt('hit', tgt.x, tgt.y + 1, tgt.z);
          }
        } else if (K.follow) {
          // snap back to you when it falls far behind or gets stuck on a cliff
          m.stuckT = (dist > 6 && Math.hypot(m.vx, m.vz) < 0.5) ? (m.stuckT || 0) + dt : 0;
          if (dist > 40 || m.stuckT > 2.5) { m.stuckT = 0; m.x = player.x + (Math.random() - 0.5) * 3; m.z = player.z + (Math.random() - 0.5) * 3; m.y = player.y + 0.2; m.vx = m.vy = m.vz = 0; }
          else if (dist > 5) { tx = dx / dist * K.speed; tz = dz / dist * K.speed; }
        } else {
          const hd = Math.hypot(m.hx - m.x, m.hz - m.z) || 0.01;
          if (hd > 18) { tx = (m.hx - m.x) / hd * 1.5; tz = (m.hz - m.z) / hd * 1.5; }
          else {
            if (m.ai <= 0) { m.ai = 3 + Math.random() * 5; m.walk = Math.random() < 0.4; const a = Math.random() * Math.PI * 2; m.dx = Math.cos(a); m.dz = Math.sin(a); }
            if (m.walk) { tx = m.dx; tz = m.dz; }
          }
        }
      } else if (m.kind === 'villager') {
        m.panic -= dt; m.ai -= dt;
        let fx = 0, fz = 0, scared = false;
        for (let q = 0; q < mobs.length; q++) {
          const o = mobs[q];
          if (!o.hostile) continue;
          const ox = m.x - o.x, oz = m.z - o.z, od = Math.hypot(ox, oz);
          if (od < 9 && od > 0.01) { fx += ox / od; fz += oz / od; scared = true; }
        }
        const hd = Math.hypot(m.hx - m.x, m.hz - m.z) || 0.01;
        if (scared) { const fl = Math.hypot(fx, fz) || 1; tx = fx / fl * 3.2; tz = fz / fl * 3.2; }
        else if (m.panic > 0) { tx = -dx / dist * 3.4; tz = -dz / dist * 3.4; }
        else if (hd > 18) { tx = (m.hx - m.x) / hd * 1.2; tz = (m.hz - m.z) / hd * 1.2; }
        else {
          if (m.ai <= 0) { m.ai = 2 + Math.random() * 4; m.walk = Math.random() < (isNight ? 0.2 : 0.45); const a = Math.random() * Math.PI * 2; m.dx = Math.cos(a); m.dz = Math.sin(a); }
          if (m.walk) { tx = m.dx * K.speed; tz = m.dz * K.speed; }
        }
      } else {
        m.panic -= dt; m.ai -= dt;
        if (m.panic > 0) { tx = -dx / dist * 3.6; tz = -dz / dist * 3.6; }
        else {
          if (m.ai <= 0) { m.ai = 2 + Math.random() * 4; m.walk = Math.random() < 0.55; const a = Math.random() * Math.PI * 2; m.dx = Math.cos(a); m.dz = Math.sin(a); }
          if (m.walk) { tx = m.dx * K.speed; tz = m.dz * K.speed; }
        }
      }
      const k = Math.min(1, 8 * dt);
      if (m.kind === 'spider' && !m.onGround) { /* keep the pounce going */ }
      else { m.vx += (tx - m.vx) * k; m.vz += (tz - m.vz) * k; }
      m.vy = Math.max(-50, m.vy - 28 * dt);
      m.onGround = false; m.hit = false;
      moveEnt(m, 0, m.vx * dt); moveEnt(m, 2, m.vz * dt); moveEnt(m, 1, m.vy * dt);
      if (m.hit && m.onGround && (!m.hostile || dist > 1)) m.vy = m.hostile ? 8.2 : 7.8;
      if (m.hostile) {
        const ml = K.melee;
        m.atk -= dt;
        if (ml && huntV && m.atk <= 0 && Math.hypot(huntV.x - m.x, huntV.z - m.z) < ml.d && Math.abs(huntV.y - m.y) < 1.6) {
          m.atk = ml.cd;
          huntV.vx += ax / ad * 6; huntV.vz += az / ad * 6; huntV.vy = 4;
          pendingHits.push({ m: huntV, d: ml.dmg });
          sfxAt('hit', huntV.x, huntV.y + 1, huntV.z);
        } else if (ml && dist < ml.d && Math.abs(player.y - m.y) < 1.6 && m.atk <= 0) {
          m.atk = ml.cd;
          damagePlayer(ml.dmg, true);
          player.vx += dx / dist * 6; player.vz += dz / dist * 6; if (player.onGround) player.vy = 4;
        }
        m.face = Math.atan2(ax, az);
      } else if (Math.hypot(m.vx, m.vz) > 0.25) m.face = Math.atan2(m.vx, m.vz);
      else if (m.kind === 'villager' && dist < 4) m.face = Math.atan2(dx, dz);
      m.group.position.set(m.x, m.y, m.z);
      m.group.rotation.y = m.face;
      const sp = Math.hypot(m.vx, m.vz);
      m.phase += dt * sp * 3.2;
      const sw = Math.sin(m.phase) * Math.min(0.8, sp * 0.5 + 0.05), legs = m.group.userData.legs;
      for (let j = 0; j < legs.length; j++) legs[j].rotation.x = (legs.length === 4 ? (j === 0 || j === 3) : (j === 0)) ? sw : -sw;
    }
    while (pendingHits.length) { const ph = pendingHits.pop(); if (mobs.indexOf(ph.m) >= 0) damageMob(ph.m, ph.d); }
    while (pendingBlasts.length) { const pb = pendingBlasts.pop(); explode(pb.x, pb.y, pb.z, pb.r, pb.p); }
  }

  const rayDir = new THREE.Vector3();
  function raycastMobs(maxD) {
    const o = camera.position;
    camera.getWorldDirection(rayDir);
    let best = null;
    for (const m of mobs) {
      const min = [m.x - m.r, m.y, m.z - m.r], max = [m.x + m.r, m.y + m.h, m.z + m.r];
      const org = [o.x, o.y, o.z], dir = [rayDir.x, rayDir.y, rayDir.z];
      let t0 = 0, t1 = maxD, ok = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(dir[a]) < 1e-8) { if (org[a] < min[a] || org[a] > max[a]) { ok = false; break; } }
        else {
          let ta = (min[a] - org[a]) / dir[a], tb = (max[a] - org[a]) / dir[a];
          if (ta > tb) { const sw = ta; ta = tb; tb = sw; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) { ok = false; break; }
        }
      }
      if (ok && (!best || t0 < best.t)) best = { mob: m, t: t0 };
    }
    return best;
  }
  function giveItem(id, n) { inv[id] = (inv[id] || 0) + n; updateHotbar(false); }
  function killMob(m) {
    const i = mobs.indexOf(m);
    if (i >= 0) removeMobAt(i);
    if (m.kind === 'enderdragon') {
      enderDragonDefeated = true;
      showHint('THE ENDER DRAGON IS DEFEATED! You conquered the End!', 8000);
      sfxAt('explode', m.x, m.y, m.z);
      if (mode === 'survival') giveItem(DIAMOND, 5);
      return;
    }
    sfxAt('die', m.x, m.y + 0.5, m.z);
    if (m.leader && hasHealth() && !omen && DIFF[difficulty].cap > 0) { omen = true; showHint('You feel an ominous presence... Enter a village and a raid will follow.', 5500); }
    if (mode === 'survival') {
      const got = [];
      KINDS[m.kind].drops().forEach(function (d) { if (d[1] > 0) { giveItem(d[0], d[1]); got.push('+' + d[1] + ' ' + NAMES[d[0]]); } });
      if (got.length) flashName(got.join('   '));
    }
  }
  function damageMob(m, dmg) {
    m.hp -= dmg;
    if (!m.hostile) m.panic = 3.5;
    if (m.hp <= 0) { killMob(m); return true; }
    return false;
  }
  function attackMob(m) {
    if (m.golem) { flashName('That golem is on your side'); return; }
    const dx = m.x - player.x, dz = m.z - player.z, d = Math.hypot(dx, dz) || 1;
    m.vx += dx / d * 9; m.vz += dz / d * 9; m.vy = 5;
    sfxAt('hit', m.x, m.y + 0.8, m.z);
    damageMob(m, attackDamage());
  }

  /* ---------- TNT, dynamite and explosions ---------- */
  const blasts = [], fx = [];
  let shake = 0;
  function blockGeo(b) {
    const pos = [], uv = [], col = [], ind = [], tl = TILES[b];
    FACES.forEach(function (f) {
      const vi = pos.length / 3, tile = tl[f.t];
      const u0 = tile / ATLAS_N + EPS, u1 = (tile + 1) / ATLAS_N - EPS;
      const uvs = [[u0, EPS], [u1, EPS], [u1, 1 - EPS], [u0, 1 - EPS]];
      for (let i = 0; i < 4; i++) { const c = f.c[i]; pos.push(c[0] - 0.5, c[1] - 0.5, c[2] - 0.5); uv.push(uvs[i][0], uvs[i][1]); col.push(f.s, f.s, f.s); }
      ind.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(ind);
    return geo;
  }
  let tntGeo = null;
  function spawnTnt(x, y, z, fuse, vx, vy, vz) {   // x,z = centre, y = bottom
    if (!tntGeo) tntGeo = blockGeo(TNT);
    const m2 = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });
    const mesh = new THREE.Mesh(tntGeo, m2); mesh.position.set(x, y + 0.5, z); scene.add(mesh);
    blasts.push({ type: 'tnt', x: x, y: y, z: z, vx: vx || 0, vy: vy || 0, vz: vz || 0, r: 0.49, h: 0.98, fuse: fuse, mesh: mesh, mat: m2, onGround: false, hit: false });
  }
  function addDynamite(x, y, z, vx, vy, vz) {   // x,y,z = centre
    const g = new THREE.Group();
    part(g, 0.1, 0.1, 0.42, 0xc9302b, 0, 0, 0); part(g, 0.11, 0.11, 0.08, 0xe8d8a8, 0, 0, 0.04);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xffb236 });
    const tip = new THREE.Mesh(bg(0.05, 0.05, 0.1), tipMat); tip.position.z = 0.25; g.add(tip);
    g.position.set(x, y, z); scene.add(g);
    g.lookAt(x + vx, y + vy, z + vz);
    blasts.push({ type: 'dyn', x: x, y: y - 0.08, z: z, vx: vx, vy: vy, vz: vz, r: 0.08, h: 0.16, fuse: 3, mesh: g, tipMat: tipMat, stuck: false, host: null, ox: 0, oy: 0, oz: 0 });
  }
  function removeBlastAt(i) {
    const b = blasts[i];
    scene.remove(b.mesh);
    if (b.mat) b.mat.dispose();
    if (b.tipMat) b.tipMat.dispose();
    blasts.splice(i, 1);
  }
  function removeFxAt(i) {
    const f = fx[i];
    scene.remove(f.mesh);
    if (f.kind === 'flash') f.mesh.material.dispose();
    fx.splice(i, 1);
  }
  const rebuildSet = new Set();
  function queueRebuild(x, z, wide) {
    const cx = x >> 4, cz = z >> 4, lx = x & 15, lz = z & 15, dxs = [0], dzs = [0];
    if (wide) { dxs.push(-1, 1); dzs.push(-1, 1); }
    if (lx === 0) dxs.push(-1);
    if (lx === 15) dxs.push(1);
    if (lz === 0) dzs.push(-1);
    if (lz === 15) dzs.push(1);
    dxs.forEach(function (dx) { dzs.forEach(function (dz) { rebuildSet.add((cx + dx) + ',' + (cz + dz)); }); });
  }
  function flushRebuilds() {
    rebuildSet.forEach(function (k) { const q = k.split(','); buildChunk(+q[0], +q[1]); });
    rebuildSet.clear();
  }
  const fxFlashGeo = new THREE.SphereGeometry(1, 14, 10);
  const fxDebrisGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  const FX_COLS = [0xffa21f, 0xff5a1a, 0x666666, 0x2b2b2b, 0xffd35c];
  function spawnBlastFx(x, y, z, rad) {
    const fm = new THREE.Mesh(fxFlashGeo, new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
    fm.position.set(x, y, z); fm.scale.setScalar(0.5); scene.add(fm);
    fx.push({ kind: 'flash', mesh: fm, life: 0.35, t: 0, rad: rad });
    const n = Math.round(10 + rad * 5);
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(fxDebrisGeo, bm(FX_COLS[i % FX_COLS.length]));
      p.position.set(x, y, z); scene.add(p);
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2, sp = 4 + Math.random() * 7;
      fx.push({ kind: 'debris', mesh: p, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 4, vz: Math.sin(a) * Math.cos(e) * sp, life: 0.7 + Math.random() * 0.6, t: 0 });
    }
  }
  function updateFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.t += dt;
      if (f.t >= f.life) { removeFxAt(i); continue; }
      if (f.kind === 'flash') { const u = f.t / f.life; f.mesh.scale.setScalar(0.5 + u * f.rad * 1.3); f.mesh.material.opacity = 0.85 * (1 - u); }
      else { f.vy -= 22 * dt; f.mesh.position.x += f.vx * dt; f.mesh.position.y += f.vy * dt; f.mesh.position.z += f.vz * dt; f.mesh.scale.setScalar(Math.max(0.1, 1 - f.t / f.life)); }
    }
  }
  function explode(x, y, z, rad, power) {
    const R0 = Math.ceil(rad), bx0 = Math.floor(x), by0 = Math.floor(y), bz0 = Math.floor(z);
    for (let dx = -R0; dx <= R0; dx++) for (let dy = -R0; dy <= R0; dy++) for (let dz = -R0; dz <= R0; dz++) {
      const bx = bx0 + dx, by = by0 + dy, bz = bz0 + dz;
      if (by <= 0 || by >= H) continue;
      const b = get(bx, by, bz);
      if (!b || b === 3 && !chunkAt(bx >> 4, bz >> 4)) continue;
      const d = Math.hypot(bx + 0.5 - x, by + 0.5 - y, bz + 0.5 - z);
      if (d > rad) continue;
      if (b === TNT) {
        setBlock(bx, by, bz, 0); queueRebuild(bx, bz);
        const dd = d || 1;
        spawnTnt(bx + 0.5, by, bz + 0.5, 0.35 + Math.random() * 0.7, (bx + 0.5 - x) / dd * 4, 3 + Math.random() * 3, (bz + 0.5 - z) / dd * 4);
        continue;
      }
      const tough = (BREAK_TIME[b] || 1) >= 2 ? 0.75 : 1;
      if (d / rad > tough * (0.7 + Math.random() * 0.3)) continue;
      setBlock(bx, by, bz, 0); queueRebuild(bx, bz, b === TORCH);
    }
    flushRebuilds();
    const reach = rad * 2;
    mobs.slice().forEach(function (m) {
      const d = Math.hypot(m.x - x, m.y + m.h / 2 - y, m.z - z);
      if (d >= reach) return;
      const f = 1 - d / reach, dd = d || 1;
      m.vx += (m.x - x) / dd * f * 14; m.vz += (m.z - z) / dd * f * 14; m.vy = 3 + f * 8;
      damageMob(m, Math.round(f * power));
    });
    const pd = Math.hypot(player.x - x, player.y + 0.9 - y, player.z - z);
    if (pd < reach) {
      const f = 1 - pd / reach, dd = pd || 1;
      player.vx += (player.x - x) / dd * f * 14; player.vz += (player.z - z) / dd * f * 14; player.vy += 3 + f * 8;
      damagePlayer(Math.round(f * power));
    }
    blasts.forEach(function (b) {
      const d = Math.hypot(b.x - x, b.y - y, b.z - z);
      if (d >= reach) return;
      const f = 1 - d / reach, dd = d || 1;
      b.vx += (b.x - x) / dd * f * 8; b.vz += (b.z - z) / dd * f * 8; b.vy += 2 + f * 5; b.stuck = false; b.host = null;
    });
    shake = Math.max(shake, Math.max(0, 1 - pd / 24));
    spawnBlastFx(x, y, z, rad);
    sfxAt('explode', x, y, z);
  }
  function updateBlasts(dt) {
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i];
      b.fuse -= dt;
      b.snd = (b.snd || 0) - dt;
      if (b.snd <= 0) { b.snd = b.fuse < 1 ? 0.12 : 0.25; sfxAt('fuse', b.x, b.y, b.z); }
      if (b.type === 'tnt') {
        b.vy = Math.max(-40, b.vy - 28 * dt);
        const fr = 1 - Math.min(1, 3 * dt); b.vx *= fr; b.vz *= fr;
        b.onGround = false; b.hit = false;
        moveEnt(b, 0, b.vx * dt); moveEnt(b, 2, b.vz * dt); moveEnt(b, 1, b.vy * dt);
        const on = Math.floor(b.fuse * (b.fuse < 1 ? 10 : 5)) % 2 === 0;
        b.mat.color.setScalar(on ? 1 : 2.8);
        b.mesh.scale.setScalar(1 + (b.fuse < 0.6 ? (0.6 - b.fuse) * 0.3 : 0));
        b.mesh.position.set(b.x, b.y + 0.49, b.z);
        if (b.fuse <= 0) { const cx = b.x, cy = b.y + 0.49, cz = b.z; removeBlastAt(i); explode(cx, cy, cz, 4.2, 30); }
      } else {
        if (b.host) {
          if (mobs.indexOf(b.host) >= 0) { b.x = b.host.x + b.ox; b.y = b.host.y + b.oy; b.z = b.host.z + b.oz; }
          else { b.host = null; b.stuck = false; }
        }
        if (!b.stuck) {
          b.vy -= 18 * dt;
          const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy, b.vz) * dt / 0.15));
          for (let s2 = 0; s2 < steps; s2++) {
            const nx = b.x + b.vx * dt / steps, ny = b.y + b.vy * dt / steps, nz = b.z + b.vz * dt / steps;
            if (collides(nx, ny, nz, b.r, b.h)) { b.stuck = true; b.vx = b.vy = b.vz = 0; break; }
            b.x = nx; b.y = ny; b.z = nz;
            for (const m of mobs) {
              if (Math.abs(b.x - m.x) < m.r + 0.1 && Math.abs(b.z - m.z) < m.r + 0.1 && b.y + 0.08 > m.y && b.y + 0.08 < m.y + m.h) {
                b.stuck = true; b.host = m; b.ox = b.x - m.x; b.oy = b.y - m.y; b.oz = b.z - m.z; b.vx = b.vy = b.vz = 0; break;
              }
            }
            if (b.stuck) break;
          }
          if (!b.stuck) b.mesh.lookAt(b.x + b.vx, b.y + b.vy + 0.08, b.z + b.vz);
        }
        b.mesh.position.set(b.x, b.y + 0.08, b.z);
        b.tipMat.color.setHex(Math.floor(b.fuse * (b.fuse < 1 ? 12 : 6)) % 2 === 0 ? 0xfff1a8 : 0xff6a1a);
        if (b.fuse <= 0) { const cx = b.x, cy = b.y + 0.08, cz = b.z; removeBlastAt(i); explode(cx, cy, cz, 2.8, 16); }
      }
    }
  }

  /* ---------- Relics (Adventure goal) ---------- */
  const RELIC_COUNT = 5;
  const relics = [];
  let collected = 0;
  const relicGeo = new THREE.OctahedronGeometry(0.38);
  const relicMat = new THREE.MeshBasicMaterial({ color: 0xffd34d });
  const beamGeo = new THREE.CylinderGeometry(0.07, 0.07, 40, 8);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.4, fog: false, depthWrite: false });
  function clearRelics() { while (relics.length) { scene.remove(relics.pop().group); } collected = 0; }
  function addRelic(x, y, z, got) {
    const g = new THREE.Group();
    const gem = new THREE.Mesh(relicGeo, relicMat); g.add(gem);
    const beam = new THREE.Mesh(beamGeo, beamMat); beam.position.y = 20; g.add(beam);
    const r = { x: x, y: y, z: z, group: g, gem: gem, got: !!got };
    g.position.set(x, y, z);
    g.visible = (mode === 'adventure') && !r.got;
    scene.add(g); relics.push(r);
    if (r.got) collected++;
  }
  function createRelics() {
    clearRelics();
    let minGap = 30;
    for (let attempt = 0; attempt < 600 && relics.length < RELIC_COUNT; attempt++) {
      if (attempt === 300) minGap = 14;
      const ang = Math.random() * Math.PI * 2, dist = 28 + Math.random() * 75;
      const x = Math.floor(Math.cos(ang) * dist), z = Math.floor(Math.sin(ang) * dist);
      getOrGen(x >> 4, z >> 4);
      const y = topY(x, z), b = get(x, y, z);
      if (b !== GRASS && b !== SAND) continue;
      if (inStructZone(x, z)) continue;
      if (relics.some(function (r) { return Math.hypot(r.x - x, r.z - z) < minGap; })) continue;
      addRelic(x + 0.5, y + 2.0, z + 0.5, false);
    }
  }
  function updateRelics(dt, t) {
    for (const r of relics) {
      if (r.got) continue;
      r.gem.rotation.y += dt * 1.6;
      r.gem.position.y = Math.sin(t * 2 + r.x) * 0.15;
    }
  }
  function checkRelics() {
    for (const r of relics) {
      if (r.got) continue;
      const dx = player.x - r.x, dy = player.y + 0.9 - r.y, dz = player.z - r.z;
      if (dx * dx + dy * dy + dz * dz < 2.6 * 2.6) {
        r.got = true; r.group.visible = false; collected++;
        if (collected >= RELIC_COUNT) showHint('All ' + RELIC_COUNT + ' relics found. Adventure complete!', 10000);
        else showHint('Relic found: ' + collected + ' of ' + RELIC_COUNT, 3000);
      }
    }
  }
  function objectiveText() {
    if (collected >= RELIC_COUNT) return 'All relics found!';
    let best = Infinity;
    for (const r of relics) if (!r.got) best = Math.min(best, Math.hypot(r.x - player.x, r.z - player.z));
    return 'Relics ' + collected + '/' + RELIC_COUNT + (isFinite(best) ? '\nNearest: ' + Math.round(best) + ' m' : '');
  }

  /* ---------- Input state ---------- */
  const keys = {};
  const touchMove = { x: 0, z: 0 };
  let touchJump = false;
  let selected = 0;
  let playing = false, locked = false, fallback = false, ready = false;
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  let invOpen = false, tradeOpen = false, craftOpen = false, cmdOpen = false;
  let lastSpace = 0;
  let mining = false, placing = false, pulseMine = false, pulsePlace = false;
  let mineCd = 0, placeCd = 0, attackCd = 0;
  let drag = null;
  const mine = { x: -1, y: -1, z: -1, t: 0 };

  const canInteract = () => mode === 'creative' || mode === 'survival';
  const hasHealth = () => mode === 'survival' || mode === 'adventure';

  /* ---------- Hotbar & hearts ---------- */
  const hotbarEl = document.getElementById('hotbar');
  const nameEl = document.getElementById('blockname');
  const heartsEl = document.getElementById('hearts'), foodEl = document.getElementById('food');
  const flashEl = document.getElementById('flash');
  const mineBar = document.getElementById('mineBar');
  const slotEls = [];
  hotbar.forEach(function (b, i) {
    const s = document.createElement('button');
    s.type = 'button'; s.className = 'slot'; s.setAttribute('aria-label', NAMES[b] + ', slot ' + (i + 1));
    const c = document.createElement('canvas'); c.width = 36; c.height = 36;
    const cx = c.getContext('2d'); cx.imageSmoothingEnabled = false;
    cx.drawImage(atlasCanvas, tileOf(b) * 16, 0, 16, 16, 0, 0, 36, 36);
    const n = document.createElement('span'); n.className = 'num'; n.textContent = String(i + 1);
    const ct = document.createElement('span'); ct.className = 'cnt';
    s.appendChild(c); s.appendChild(n); s.appendChild(ct);
    const du = document.createElement('i'); du.className = 'dur'; s.appendChild(du); s._dur = du;
    s._cnt = ct; s._ctx = cx;
    s.addEventListener('click', function () { if (!canInteract()) return; selected = i; updateHotbar(true); });
    hotbarEl.appendChild(s); slotEls.push(s);
  });
  let nameTimer = 0;
  function updateHotbar(showName) {
    slotEls.forEach(function (s, i) {
      const b = hotbar[i];
      s._ctx.clearRect(0, 0, 36, 36);
      s._ctx.drawImage(atlasCanvas, tileOf(b) * 16, 0, 16, 16, 0, 0, 36, 36);
      s.setAttribute('aria-label', NAMES[b] + ', slot ' + (i + 1));
      s.classList.toggle('on', i === selected);
      const surv = mode === 'survival';
      s._cnt.textContent = surv ? (inv[b] || '') : '';
      const T = TOOLS[b];
      if (surv && T && toolWear[b] > 0) {
        const pr = 1 - toolWear[b] / TOOL_MAX[T.tier];
        s._dur.style.display = 'block'; s._dur.style.width = 'calc((100% - 6px) * ' + pr + ')';
        s._dur.style.background = pr > 0.5 ? '#43c34a' : (pr > 0.2 ? '#e3c42f' : '#d9372b');
      } else s._dur.style.display = 'none';
      s.classList.toggle('empty', surv && !(inv[b] > 0));
    });
    if (showName) {
      nameEl.textContent = NAMES[hotbar[selected]]; nameEl.style.opacity = 1;
      clearTimeout(nameTimer); nameTimer = setTimeout(function () { nameEl.style.opacity = 0; }, 1400);
    }
  }
  function flashName(text) {
    nameEl.textContent = text; nameEl.style.opacity = 1;
    clearTimeout(nameTimer); nameTimer = setTimeout(function () { nameEl.style.opacity = 0; }, 1600);
  }
  // Hunger drains slowly with activity (a lot when sprinting). Eat to refill it; at zero you starve.
  function exert(n) {
    if (mode !== 'survival' || difficulty === 'peaceful') return;
    exhaust += n;
    while (exhaust >= 4) {
      exhaust -= 4;
      if (sat > 0) sat = Math.max(0, sat - 1); else hunger = Math.max(0, hunger - 1);
    }
  }
  function updateFood() {
    shownHunger = hunger;
    let html = '';
    for (let i = 0; i < 10; i++) {
      const v = hunger - i * 2;
      html += '<span class="food ' + (v >= 2 ? 'full' : (v >= 1 ? 'half' : 'empty')) + '">\uD83C\uDF57</span>';
    }
    foodEl.innerHTML = html;
    foodEl.setAttribute('aria-label', 'Hunger ' + hunger + ' of 20');
  }
  function updateHearts() {
    let html = '';
    for (let i = 0; i < 10; i++) {
      const v = hp - i * 2;
      html += '<span class="heart ' + (v >= 2 ? 'full' : (v >= 1 ? 'half' : 'empty')) + '">\u2665</span>';
    }
    heartsEl.innerHTML = html;
    heartsEl.setAttribute('aria-label', 'Health ' + hp + ' of ' + MAXHP);
  }
  function damagePlayer(n, scaled) {
    if (scaled) n = Math.round(n * DIFF[difficulty].dmg);   // monster hits scale with difficulty
    if (!hasHealth() || dead || n <= 0) return;
    if (sleepT > 0) { sleepT = 0; fadeEl.style.opacity = 0; }
    hp = Math.max(0, hp - n); sinceHurt = 0; regenT = 0; sfx('hurt');
    flashEl.style.opacity = 0.9;
    setTimeout(function () { flashEl.style.opacity = 0; }, 140);
    updateHearts();
    if (hp <= 0) die();
  }

  /* ---------- Inventory ---------- */
  const invEl = document.getElementById('inv');
  const invGrid = document.getElementById('invGrid');
  const invTitle = document.getElementById('invTitle');
  const invHelp = document.getElementById('invHelp');
  const invMsg = document.getElementById('invMsg');
  const craftEl = document.getElementById('craft');
  const invHot = document.getElementById('invHotbar');
  // Crafting recipes. Shaped ones use a pattern (they work mirrored); shapeless ones just need the right items.
  const RECIPES = [
    { out: PLANKS, n: 4, shapeless: [WOOD] },
    { out: CTABLE, n: 1, shape: ['pp', 'pp'], key: { p: PLANKS } },
    { out: STICK, n: 4, shape: ['p', 'p'], key: { p: PLANKS } },
    { out: TORCH, n: 4, shape: ['w', 's'], key: { w: WOOD, s: STICK } },
    { out: STONE, n: 1, shapeless: [COBBLE] },
    { out: STONEBRICK, n: 4, shape: ['ss', 'ss'], key: { s: STONE } },
    { out: SANDSTONE, n: 2, shape: ['xx', 'xx'], key: { x: SAND } },
    { out: BRICK, n: 2, shapeless: [DIRT, DIRT, DIRT, SAND] },
    { out: COOKED, n: 1, shapeless: [BEEF] },
    { out: COOKED, n: 1, shapeless: [PORK] },
    { out: COOKED, n: 1, shapeless: [MUTTON] },
    { out: COOKED, n: 1, shapeless: [CHICKEN] },
    { out: FLINT, n: 1, shapeless: [GRAVEL, COBBLE] },
    { out: DYNAMITE, n: 3, shape: ['g', 'g', 's'], key: { g: GUNPOWDER, s: STRING } },
    { out: DYNAMITE, n: 2, shape: ['g', 'g', 'w'], key: { g: GUNPOWDER, w: WOOL } },
    { out: TNT, n: 1, shape: ['gsg', 'sgs', 'gsg'], key: { g: GUNPOWDER, s: SAND } },
    { out: 120, n: 1, shapeless: [GOLD, LEATHER] },
    { out: 121, n: 1, shapeless: [GOLD, PORK] },
    { out: 122, n: 1, shapeless: [GOLD, WOOL] },
    { out: 123, n: 1, shapeless: [GOLD, FEATHER] },
    { out: 124, n: 1, shapeless: [GOLD, EMERALD] },
    { out: 125, n: 1, shapeless: [GOLD, BEEF] },
    { out: 126, n: 1, shapeless: [GOLD, GUNPOWDER, GUNPOWDER] },
    { out: 127, n: 1, shapeless: [GOLD, BONE] },
    { out: 128, n: 1, shapeless: [GOLD, STRING] },
    { out: 129, n: 1, shapeless: [GOLD, EMERALD, BONE] },
    { out: 142, n: 1, shapeless: [GOLD, EMERALD, LEATHER] },
    { out: BED, n: 1, shape: ['www', 'ppp'], key: { w: WOOL, p: PLANKS } }
  ];
  TOOL_TIERS.forEach(function (tn, ti) {
    const mat = [PLANKS, COBBLE, EMERALD, IRON_INGOT, DIAMOND][ti];
    [['mmm', '.s.', '.s.'], ['mm', 'ms', '.s'], ['m', 's', 's'], ['m', 'm', 's']].forEach(function (shape, ki) {
      RECIPES.push({ out: toolId(ti, ki), n: 1, shape: shape, key: { m: mat, s: STICK } });
    });
  });
  [[IRON_BLOCK, IRON_INGOT], [COPPER_BLOCK, COPPER_INGOT], [DIAMOND_BLOCK, DIAMOND]].forEach(function (pr) {
    RECIPES.push({ out: pr[0], n: 1, shape: ['iii', 'iii', 'iii'], key: { i: pr[1] } });
    RECIPES.push({ out: pr[1], n: 9, shapeless: [pr[0]] });
  });
  RECIPES.push(
    { out: IRON_INGOT, n: 1, shapeless: [RAW_IRON, COAL] },       // "smelting": raw ore plus coal for fuel
    { out: COPPER_INGOT, n: 1, shapeless: [RAW_COPPER, COAL] },
    { out: TORCH, n: 4, shape: ['c', 's'], key: { c: COAL, s: STICK } },
    { out: 153, n: 1, shapeless: [GOLD, IRON_INGOT] },
    { out: 154, n: 1, shapeless: [GOLD, COPPER_INGOT] },
    { out: 155, n: 1, shapeless: [GOLD, DIAMOND] }
  );
  function iconCanvas(b, size) {
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(atlasCanvas, tileOf(b) * 16, 0, 16, 16, 0, 0, size, size);
    return c;
  }
  /* ---------- Crafting grid (2x2 anywhere, 3x3 at a crafting table) ---------- */
  const craftUi = document.getElementById('craftui'), craftTitle = document.getElementById('craftTitle'), craftHelp = document.getElementById('craftHelp');
  const craftMsg = document.getElementById('craftMsg'), cgrid = document.getElementById('cgrid'), cres = document.getElementById('cres');
  const craftBtn = document.getElementById('craftBtn'), craftItems = document.getElementById('craftItems'), craftBook = document.getElementById('craftBook');
  const craftState = { size: 2, grid: [0, 0, 0, 0, 0, 0, 0, 0, 0], sel: 0 };
  const { recipePattern, recipeCounts, matchRecipe } = createRecipeMatcher(RECIPES);
  function gridCounts(size) {
    const c = {};
    for (let i = 0; i < size * size; i++) { const v = craftState.grid[i]; if (v) c[v] = (c[v] || 0) + 1; }
    return c;
  }
  function hasAll(counts) { for (const k in counts) if ((inv[k] || 0) < counts[k]) return false; return true; }
  function doCraft() {
    const m = matchRecipe(craftState.grid, craftState.size), counts = gridCounts(craftState.size);
    if (!m) return;
    if (!hasAll(counts)) { craftMsg.textContent = 'You are missing some of those items.'; sfx('no'); return; }
    for (const k in counts) inv[k] -= counts[k];
    inv[m.out] = (inv[m.out] || 0) + m.n;
    craftMsg.textContent = 'Crafted ' + m.n + ' ' + NAMES[m.out].toLowerCase() + '.';
    sfx('pop'); updateHotbar(false); renderCraft();
  }
  function placeCraftItem(id) {
    const size = craftState.size, used = gridCounts(size)[id] || 0;
    if (used >= (inv[id] || 0)) { craftMsg.textContent = 'You have no more ' + NAMES[id].toLowerCase() + '.'; return; }
    craftState.grid[craftState.sel] = id;
    for (let k = 1; k <= size * size; k++) { const j = (craftState.sel + k) % (size * size); if (!craftState.grid[j]) { craftState.sel = j; break; } }
    craftMsg.textContent = '';
    renderCraft();
  }
  function fillRecipe(r) {
    const size = craftState.size, g = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (r.shapeless) {
      if (r.shapeless.length > size * size) { craftMsg.textContent = 'That needs a crafting table (3\u00d73 grid).'; return; }
      r.shapeless.forEach(function (id, i) { g[i] = id; });
    } else {
      const pat = recipePattern(r);
      if (pat.length > size || pat[0].length > size) { craftMsg.textContent = 'That needs a crafting table (3\u00d73 grid).'; return; }
      pat.forEach(function (row, ri) { row.forEach(function (id, ci) { g[ri * size + ci] = id; }); });
    }
    craftState.grid = g; craftMsg.textContent = ''; renderCraft();
  }
  function renderCraft() {
    const size = craftState.size, g = craftState.grid;
    craftTitle.textContent = size === 3 ? 'Crafting Table' : 'Crafting';
    craftHelp.textContent = 'Pick a square, then click an item below to put it there. Click a filled square again to empty it, or press Fill on a recipe.';
    cgrid.style.gridTemplateColumns = 'repeat(' + size + ', 58px)';
    cgrid.innerHTML = '';
    for (let i = 0; i < size * size; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ccell' + (craftState.sel === i ? ' on' : '');
      b.setAttribute('aria-label', 'Grid square ' + (i + 1) + (g[i] ? ', ' + NAMES[g[i]] : ', empty'));
      if (g[i]) b.appendChild(iconCanvas(g[i], 40));
      b.addEventListener('click', function () { if (craftState.sel === i && g[i]) craftState.grid[i] = 0; else craftState.sel = i; renderCraft(); });
      cgrid.appendChild(b);
    }
    const m = matchRecipe(g, size), ok = !!m && hasAll(gridCounts(size));
    cres.innerHTML = '';
    if (m) { cres.appendChild(iconCanvas(m.out, 40)); const t = document.createElement('span'); t.textContent = m.n + ' \u00d7 ' + NAMES[m.out]; cres.appendChild(t); }
    else cres.appendChild(document.createTextNode('No recipe'));
    craftBtn.disabled = !ok;
    craftItems.innerHTML = '';
    let nItems = 0;
    ALL_BLOCKS.forEach(function (b) {
      const n = inv[b] || 0;
      if (n <= 0) return;
      nItems++;
      const t = document.createElement('button'); t.type = 'button'; t.className = 'itile';
      t.setAttribute('aria-label', NAMES[b] + ', ' + n + ' owned');
      t.appendChild(iconCanvas(b, 40));
      const l = document.createElement('span'); l.className = 'iname'; l.textContent = NAMES[b]; t.appendChild(l);
      const c = document.createElement('span'); c.className = 'icount'; c.textContent = String(n); t.appendChild(c);
      t.addEventListener('click', function () { placeCraftItem(b); });
      craftItems.appendChild(t);
    });
    if (!nItems) { const e = document.createElement('p'); e.textContent = 'Your backpack is empty. Mine blocks and collect items first.'; craftItems.appendChild(e); }
    craftBook.innerHTML = '';
    RECIPES.forEach(function (r) {
      const counts = recipeCounts(r), have = hasAll(counts);
      const row = document.createElement('div'); row.className = 'recipe'; if (!have) row.style.opacity = '0.6';
      const left = document.createElement('span'); left.style.display = 'inline-flex'; left.style.alignItems = 'center'; left.style.gap = '6px'; left.style.flexWrap = 'wrap';
      const ic = iconCanvas(r.out, 24); ic.style.width = '24px'; ic.style.height = '24px'; ic.style.imageRendering = 'pixelated'; left.appendChild(ic);
      left.appendChild(document.createTextNode(r.n + ' \u00d7 ' + NAMES[r.out] + ' \u2190 ' + Object.keys(counts).map(function (k) { return counts[k] + ' ' + NAMES[k].toLowerCase(); }).join(', ')));
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.textContent = 'Fill';
      btn.addEventListener('click', function () { fillRecipe(r); });
      row.appendChild(left); row.appendChild(btn); craftBook.appendChild(row);
    });
  }
  function openCraft(size) {
    if (mode !== 'survival') { showHint('Creative mode already has every item. Open the inventory with I.', 2400); return; }
    craftState.size = size; craftState.grid = [0, 0, 0, 0, 0, 0, 0, 0, 0]; craftState.sel = 0;
    craftOpen = true; invOpen = true; playing = false; mining = placing = false; drag = null;
    for (const k in keys) keys[k] = false;
    touchMove.x = 0; touchMove.z = 0; touchJump = false; stick = null; lookT = null;
    invEl.classList.add('hidden'); tradeEl.classList.add('hidden');
    craftMsg.textContent = '';
    renderCraft();
    craftUi.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    sfx('click');
  }
  craftBtn.addEventListener('click', doCraft);
  document.getElementById('craftClear').addEventListener('click', function () { craftState.grid = [0, 0, 0, 0, 0, 0, 0, 0, 0]; craftState.sel = 0; craftMsg.textContent = ''; renderCraft(); });
  document.getElementById('craftClose').addEventListener('click', function () { closeInventory(true); });
  window.addEventListener('keydown', function (e) { if (e.code === 'KeyC' && !e.repeat && playing && !invOpen) openCraft(2); });
  function assignSlot(b) {
    if (mode === 'survival' && !(inv[b] > 0)) { invMsg.textContent = 'You have no ' + NAMES[b].toLowerCase() + ' yet. Mine some first.'; return; }
    const j = hotbar.indexOf(b);
    if (j >= 0 && j !== selected) hotbar[j] = hotbar[selected];
    hotbar[selected] = b;
    invMsg.textContent = NAMES[b] + ' is now in slot ' + (selected + 1) + '.';
    updateHotbar(false); renderInventory();
  }
  function renderInventory() {
    const surv = mode === 'survival';
    invTitle.textContent = surv ? 'Backpack' : 'Creative inventory';
    invHelp.textContent = (surv ? 'Everything you have collected.' : 'Every block and item, free to use.') + ' Choose a hotbar slot below (or press 1\u20139), then click a block to put it there.';
    invGrid.innerHTML = '';
    ALL_BLOCKS.forEach(function (b) {
      const t = document.createElement('button'); t.type = 'button';
      t.className = 'itile' + (surv && !(inv[b] > 0) ? ' empty' : '') + (hotbar[selected] === b ? ' cur' : '');
      t.setAttribute('aria-label', NAMES[b] + (surv ? ', ' + (inv[b] || 0) + ' owned' : ''));
      t.appendChild(iconCanvas(b, 40));
      const l = document.createElement('span'); l.className = 'iname'; l.textContent = NAMES[b]; t.appendChild(l);
      if (surv) { const c = document.createElement('span'); c.className = 'icount'; c.textContent = String(inv[b] || 0); t.appendChild(c); }
      t.addEventListener('click', function () { assignSlot(b); });
      invGrid.appendChild(t);
    });
    craftEl.innerHTML = '';
    if (surv) {
      const h = document.createElement('div'); h.className = 'invsub'; h.textContent = 'Crafting'; craftEl.appendChild(h);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = 'Open crafting grid (C)';
      b.style.marginBottom = '14px';
      b.addEventListener('click', function () { openCraft(2); });
      craftEl.appendChild(b);
    }
    invHot.innerHTML = '';
    hotbar.forEach(function (b, i) {
      const s = document.createElement('button'); s.type = 'button';
      s.className = 'slot' + (i === selected ? ' on' : '') + (surv && !(inv[b] > 0) ? ' empty' : '');
      s.setAttribute('aria-label', NAMES[b] + ', slot ' + (i + 1));
      s.appendChild(iconCanvas(b, 36));
      const n = document.createElement('span'); n.className = 'num'; n.textContent = String(i + 1); s.appendChild(n);
      if (surv && inv[b]) { const c = document.createElement('span'); c.className = 'cnt'; c.textContent = String(inv[b]); s.appendChild(c); }
      s.addEventListener('click', function () { selected = i; updateHotbar(false); renderInventory(); });
      invHot.appendChild(s);
    });
  }
  function openInventory() {
    if (!canInteract()) { showHint('There is no inventory in ' + LABEL[mode] + ' mode.', 1800); return; }
    invOpen = true; playing = false; mining = placing = false; drag = null;
    for (const k in keys) keys[k] = false;
    touchMove.x = 0; touchMove.z = 0; touchJump = false; stick = null; lookT = null;
    invMsg.textContent = '';
    renderInventory();
    invEl.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function closeInventory(resume) {
    invOpen = false; invEl.classList.add('hidden'); tradeEl.classList.add('hidden'); tradeOpen = false; craftUi.classList.add('hidden'); craftOpen = false; cmdBar.classList.add('hidden'); cmdOpen = false;
    if (resume) { playing = true; if (!isTouch && !fallback) requestLock(); }
    else pause();
  }
  // Villager trading (Survival only)
  const tradeEl = document.getElementById('trade'), tradeTitle = document.getElementById('tradeTitle'), tradeSub = document.getElementById('tradeSub');
  const tradeList = document.getElementById('tradeList'), tradeMsg = document.getElementById('tradeMsg');
  let tradeMob = null;
  const TRADES = {
    farmer: [{ give: [HAY, 3], get: [EMERALD, 1] }, { give: [WOOL, 2], get: [EMERALD, 1] }, { give: [BONE, 4], get: [EMERALD, 1] }, { give: [EMERALD, 1], get: [COOKED, 4] }, { give: [EMERALD, 2], get: [BED, 1] }],
    butcher: [{ give: [BEEF, 4], get: [EMERALD, 1] }, { give: [PORK, 4], get: [EMERALD, 1] }, { give: [CHICKEN, 5], get: [EMERALD, 1] }, { give: [EMERALD, 1], get: [LEATHER, 3] }],
    mason: [{ give: [COBBLE, 8], get: [EMERALD, 1] }, { give: [EMERALD, 1], get: [STONEBRICK, 8] }, { give: [EMERALD, 1], get: [SANDSTONE, 8] }, { give: [EMERALD, 2], get: [BRICK, 8] }, { give: [COPPER_INGOT, 4], get: [EMERALD, 1] }],
    blacksmith: [{ give: [GUNPOWDER, 3], get: [EMERALD, 1] }, { give: [EMERALD, 1], get: [TORCH, 8] }, { give: [EMERALD, 1], get: [FLINT, 1] }, { give: [EMERALD, 2], get: [DYNAMITE, 2] }, { give: [EMERALD, 3], get: [TNT, 1] }, { give: [EMERALD, 2], get: [134, 1] }, { give: [EMERALD, 2], get: [137, 1] }, { give: [IRON_INGOT, 3], get: [EMERALD, 1] }, { give: [COAL, 10], get: [EMERALD, 1] }, { give: [EMERALD, 3], get: [143, 1] }],
    cleric: [{ give: [GOLD, 1], get: [EMERALD, 3] }, { give: [EMERALD, 8], get: [GOLD, 1] }, { give: [EMERALD, 1], heal: true }, { give: [DIAMOND, 1], get: [EMERALD, 6] }]
  };
  function tradeCell(pair) {
    const w = document.createElement('span'); w.style.display = 'inline-flex'; w.style.alignItems = 'center'; w.style.gap = '4px';
    if (pair) { const ic = iconCanvas(pair[0], 28); ic.style.width = '28px'; ic.style.height = '28px'; ic.style.imageRendering = 'pixelated'; w.appendChild(ic); w.appendChild(document.createTextNode(pair[1] + ' ' + NAMES[pair[0]])); }
    return w;
  }
  function renderTrade() {
    const job = tradeMob.job;
    tradeTitle.textContent = JOB_NAMES[job];
    tradeSub.textContent = 'Emeralds are the currency. Sell things to earn them.';
    tradeList.innerHTML = '';
    TRADES[job].forEach(function (t) {
      const ok = (inv[t.give[0]] || 0) >= t.give[1];
      const row = document.createElement('div'); row.className = 'recipe';
      const left = document.createElement('span'); left.style.display = 'inline-flex'; left.style.alignItems = 'center'; left.style.gap = '8px'; left.style.flexWrap = 'wrap';
      left.appendChild(tradeCell(t.give)); left.appendChild(document.createTextNode('\u2192'));
      if (t.heal) left.appendChild(document.createTextNode('Full health')); else left.appendChild(tradeCell(t.get));
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.textContent = 'Trade'; btn.disabled = !ok;
      btn.addEventListener('click', function () { doTrade(t); });
      row.appendChild(left); row.appendChild(btn); tradeList.appendChild(row);
    });
  }
  function doTrade(t) {
    if ((inv[t.give[0]] || 0) < t.give[1]) { tradeMsg.textContent = 'You do not have enough.'; sfx('no'); return; }
    if (t.heal) { if (hp >= MAXHP) { tradeMsg.textContent = 'You are already at full health.'; sfx('no'); return; } hp = MAXHP; updateHearts(); }
    inv[t.give[0]] -= t.give[1];
    if (!t.heal) inv[t.get[0]] = (inv[t.get[0]] || 0) + t.get[1];
    updateHotbar(false); renderTrade();
    tradeMsg.textContent = t.heal ? 'You feel much better.' : 'Trade complete.';
    sfx('yes');
  }
  function openTrade(m) {
    if (mode !== 'survival') { sfxAt('villager', m.x, m.y + 1, m.z); showHint('The villager nods at you. Trading works in Survival mode.', 2400); return; }
    invOpen = true; tradeOpen = true; tradeMob = m; playing = false; mining = placing = false; drag = null;
    for (const k in keys) keys[k] = false;
    touchMove.x = 0; touchMove.z = 0; touchJump = false; stick = null; lookT = null;
    tradeMsg.textContent = '';
    renderTrade();
    tradeEl.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    sfxAt('villager', m.x, m.y + 1, m.z);
  }
  document.getElementById('tradeClose').addEventListener('click', function () { closeInventory(true); });
  document.getElementById('invClose').addEventListener('click', function () { closeInventory(true); });
  window.addEventListener('keydown', function (e) {
    if (e.code === 'KeyI' || e.code === 'Tab') {
      if (e.repeat) { if (invOpen || playing) e.preventDefault(); return; }
      if (invOpen) { e.preventDefault(); closeInventory(true); }
      else if (playing) { e.preventDefault(); openInventory(); }
    } else if (invOpen) {
      if (e.code === 'Escape') closeInventory(false);
      else if ((e.code === 'KeyE' || e.code === 'KeyC') && (tradeOpen || craftOpen)) closeInventory(true);
      else if (e.code.indexOf('Digit') === 0 && !tradeOpen && !craftOpen) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 9) { selected = n - 1; updateHotbar(false); renderInventory(); }
      }
    }
  });

  /* ---------- Keyboard / mouse / touch ---------- */
  window.addEventListener('keydown', function (e) {
    if (!playing) return;
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
    if (e.code.indexOf('Digit') === 0 && canInteract()) {
      const n = parseInt(e.code.slice(5), 10);
      if (n >= 1 && n <= 9) { selected = n - 1; updateHotbar(true); }
    }
    if (e.code === 'Space' && !e.repeat) { doubleTapFly(); }
    if (e.code === 'KeyF' && !e.repeat) toggleFly();
    if (e.code === 'KeyE' && !e.repeat) pulsePlace = true;
    if (e.code === 'KeyQ' && !e.repeat) pulseMine = true;
    if (e.code === 'KeyP' && fallback) pause();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { for (const k in keys) keys[k] = false; mining = placing = false; });
  window.addEventListener('wheel', function (e) {
    if (!playing) return;
    if (mode === 'spectator') {
      specSpeed = Math.max(0.25, Math.min(6, specSpeed * (e.deltaY > 0 ? 0.8 : 1.25)));
      showHint('Fly speed x' + specSpeed.toFixed(2), 1200);
    } else if (canInteract()) {
      selected = (selected + (e.deltaY > 0 ? 1 : 8)) % 9; updateHotbar(true);
    }
  }, { passive: true });
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // Double-tap jump to start or stop flying in Creative
  function doubleTapFly() {
    const t = performance.now();
    if (mode === 'creative' && t - lastSpace < 320) { toggleFly(); lastSpace = 0; }
    else lastSpace = t;
  }
  function toggleFly() { if (mode !== 'creative') return; player.fly = !player.fly; player.vy = 0; }
  function look(dx, dy, k) {
    player.yaw -= dx * k; player.pitch -= dy * k;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
  }

  canvas.addEventListener('mousedown', function (e) {
    if (!playing) return;
    const placeBtn = e.button === 2 || (e.button === 0 && (e.ctrlKey || e.metaKey || e.altKey));
    if (!locked) drag = { place: placeBtn, moved: 0, t0: performance.now() };
    if (placeBtn) { placing = true; placeCd = 0; } else if (e.button === 0) { mining = true; mineCd = 0; }
  });
  window.addEventListener('mouseup', function () {
    if (drag && drag.moved < 6 && performance.now() - drag.t0 <= 160) {
      if (drag.place) pulsePlace = true; else pulseMine = true;
    }
    drag = null; mining = false; placing = false;
  });
  window.addEventListener('mousemove', function (e) {
    if (!playing) return;
    if (locked) look(e.movementX, e.movementY, 0.0023);
    else if (drag) { drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY); if (drag.moved >= 6) look(e.movementX, e.movementY, 0.0028); }
  });

  const touchUI = document.getElementById('touchui');
  let stick = null, lookT = null;
  canvas.addEventListener('touchstart', function (e) {
    if (!playing) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth * 0.4 && !stick) stick = { id: t.identifier, sx: t.clientX, sy: t.clientY };
      else if (!lookT) lookT = { id: t.identifier, lx: t.clientX, ly: t.clientY, t0: performance.now(), moved: 0 };
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    if (!playing) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (stick && t.identifier === stick.id) {
        touchMove.x = Math.max(-1, Math.min(1, (t.clientX - stick.sx) / 50));
        touchMove.z = Math.max(-1, Math.min(1, (t.clientY - stick.sy) / 50));
      } else if (lookT && t.identifier === lookT.id) {
        look(t.clientX - lookT.lx, t.clientY - lookT.ly, 0.0055);
        lookT.moved += Math.abs(t.clientX - lookT.lx) + Math.abs(t.clientY - lookT.ly);
        lookT.lx = t.clientX; lookT.ly = t.clientY;
      }
    }
  }, { passive: false });
  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (stick && t.identifier === stick.id) { stick = null; touchMove.x = 0; touchMove.z = 0; }
      else if (lookT && t.identifier === lookT.id) {
        if (performance.now() - lookT.t0 < 260 && lookT.moved < 10) pulseMine = true;
        lookT = null;
      }
    }
  }
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);
  const bJump = document.getElementById('btnJump'), bPlace = document.getElementById('btnPlace'), bFly = document.getElementById('btnFly'), bInv = document.getElementById('btnInv');
  bJump.addEventListener('touchstart', function (e) { e.preventDefault(); touchJump = true; doubleTapFly(); }, { passive: false });
  bJump.addEventListener('touchend', function () { touchJump = false; });
  bPlace.addEventListener('touchstart', function (e) { e.preventDefault(); pulsePlace = true; }, { passive: false });
  bFly.addEventListener('touchstart', function (e) { e.preventDefault(); toggleFly(); }, { passive: false });
  bPlace.addEventListener('click', function () { if (!isTouch) pulsePlace = true; });
  bFly.addEventListener('click', function () { if (!isTouch) toggleFly(); });
  bInv.addEventListener('touchstart', function (e) { e.preventDefault(); if (playing) openInventory(); }, { passive: false });
  bInv.addEventListener('click', function () { if (!isTouch && playing) openInventory(); });
  document.getElementById('btnCmd').addEventListener('touchstart', function (e) { e.preventDefault(); if (playing) openCmd('/'); }, { passive: false });

  /* ---------- Block interaction ---------- */
  const dirV = new THREE.Vector3();
  let blockHit = null, target = null;
  function raycast(maxD) {
    const o = camera.position;
    camera.getWorldDirection(dirV);
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    if (solid(get(x, y, z))) return null;
    const sx = dirV.x > 0 ? 1 : -1, sy = dirV.y > 0 ? 1 : -1, sz = dirV.z > 0 ? 1 : -1;
    const tdx = dirV.x !== 0 ? Math.abs(1 / dirV.x) : Infinity;
    const tdy = dirV.y !== 0 ? Math.abs(1 / dirV.y) : Infinity;
    const tdz = dirV.z !== 0 ? Math.abs(1 / dirV.z) : Infinity;
    let tmx = dirV.x !== 0 ? (dirV.x > 0 ? x + 1 - o.x : o.x - x) * tdx : Infinity;
    let tmy = dirV.y !== 0 ? (dirV.y > 0 ? y + 1 - o.y : o.y - y) * tdy : Infinity;
    let tmz = dirV.z !== 0 ? (dirV.z > 0 ? z + 1 - o.z : o.z - z) * tdz : Infinity;
    let fx = 0, fy = 0, fz = 0, t = 0;
    while (t <= maxD) {
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; fx = -sx; fy = 0; fz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; fx = 0; fy = -sy; fz = 0; }
      else { z += sz; t = tmz; tmz += tdz; fx = 0; fy = 0; fz = -sz; }
      if (t > maxD) break;
      if (y < 0) return null;
      if (y >= H) { if (sy > 0) return null; continue; }
      if (get(x, y, z)) return { x: x, y: y, z: z, nx: fx, ny: fy, nz: fz, t: t };
    }
    return null;
  }
  function resetMine() { mine.t = 0; mine.x = mine.y = mine.z = -1; mineBar.style.display = 'none'; }
  function doBreak(t) {
    const b = get(t.x, t.y, t.z);
    if (mode === 'survival') {
      exert(0.02);
      if (canCollect(b)) { const drop = isBed(b) ? BED : (DROPS[b] || b); inv[drop] = (inv[drop] || 0) + 1; updateHotbar(false); }
      else flashName('You need a ' + (NEEDS_PICK[b] > 0 ? 'stronger ' : '') + 'pickaxe to collect this');
      const ht = heldTool();
      if (ht) wearTool(ht.id, ht.kind === 'sword' ? 2 : 1);
    }
    if (mode === 'survival' && b === GRAVEL && Math.random() < 0.3) { giveItem(GUNPOWDER, 1); flashName('+1 Gunpowder'); }
    setBlock(t.x, t.y, t.z, 0);
    if (isBed(b)) {   // take the other half of the bed with it
      const k = b - 19, dv = BED_DIR[k >> 1], head = k & 1, sg = head ? -1 : 1;
      const px = t.x + dv[0] * sg, pz = t.z + dv[1] * sg, pid = 19 + (k >> 1) * 2 + (1 - head);
      if (get(px, t.y, pz) === pid) { setBlock(px, t.y, pz, 0); refreshAround(px, pz); }
    }
    sfx('break', 1, 0, b);
    let torchGone = b === TORCH;
    if (get(t.x, t.y + 1, t.z) === TORCH) { setBlock(t.x, t.y + 1, t.z, 0); torchGone = true; if (mode === 'survival') giveItem(TORCH, 1); }
    refreshAround(t.x, t.z, torchGone);
  }
  // The tool in the selected hotbar slot (in Survival you must own it)
  function heldTool() {
    const it = hotbar[selected], T = TOOLS[it];
    if (!T || mode === 'adventure' || mode === 'spectator') return null;
    if (mode === 'survival' && !(inv[it] > 0)) return null;
    return { id: it, kind: T.kind, tier: T.tier };
  }
  function toolSpeed(b) {
    const t = heldTool();
    if (!t) return 1;
    if (t.kind === blockKind(b)) return TOOL_SPD[t.tier];
    if (t.kind === 'sword' && (b === 6 || b === 13)) return 2;
    return 1;
  }
  function canCollect(b) {
    if (!(b in NEEDS_PICK)) return true;
    const t = heldTool();
    return !!t && t.kind === 'pickaxe' && TOOL_LVL[t.tier] >= NEEDS_PICK[b];
  }
  function wearTool(id, n) {
    if (mode !== 'survival') return;
    toolWear[id] = (toolWear[id] || 0) + n;
    if (toolWear[id] >= TOOL_MAX[TOOLS[id].tier]) {
      toolWear[id] = 0; inv[id] = Math.max(0, (inv[id] || 0) - 1);
      flashName('Your ' + NAMES[id].toLowerCase() + ' broke!'); sfx('die');
    }
    updateHotbar(false);
  }
  function attackDamage() {
    if (mode === 'creative') return 20;
    exert(0.08);
    const t = heldTool();
    if (!t) return 3;
    wearTool(t.id, 1);
    return TOOL_DMG[t.kind][t.tier];
  }
  function spendItem(id) {
    if (mode !== 'survival') return true;
    if (!(inv[id] > 0)) { showHint('You have no ' + NAMES[id].toLowerCase() + '.', 1500); return false; }
    inv[id]--; updateHotbar(false);
    return true;
  }
  function eatItem(id) {
    if (mode !== 'survival') { flashName('Food only matters in Survival'); return 0.4; }
    if (hunger >= 20) { showHint('You are not hungry.', 1200); return 0.4; }
    if (!spendItem(id)) return 0.4;
    hunger = Math.min(20, hunger + FOOD[id]); sat = Math.min(hunger, sat + FOOD[id] * 0.6); updateFood(); sfx('eat');
    return 0.8;
  }
  function throwDynamite() {
    if (!spendItem(DYNAMITE)) return 0.4;
    sfx('throw');
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    addDynamite(camera.position.x + d.x * 0.6, camera.position.y + d.y * 0.6 - 0.1, camera.position.z + d.z * 0.6,
      d.x * 14 + player.vx * 0.3, d.y * 14 + 2.5, d.z * 14 + player.vz * 0.3);
    return 0.5;
  }
  function lightPortalAt(px, py, pz) {
    if (dimension === 'end') return false;
    // Both the final obsidian placement and flint-and-steel use this one
    // validator, so the two controls cannot disagree about valid frames.
    ensureAround(px, pz);
    const portal = findPortalFrame(get, { x: px, y: py, z: pz }, dimension, OBSIDIAN, H);
    if (!portal) return false;
    const already = portals.some(p => p.dimension === portal.dimension && p.axis === portal.axis &&
      p.x === portal.x && p.y === portal.y && p.z === portal.z);
    if (!already) {
      portals.push(portal);
      showPortalVisual(portal);
      rebuildRegion(Math.floor(portal.x - 4), Math.floor(portal.z - 4), Math.ceil(portal.x + 4), Math.ceil(portal.z + 4));
      saveWorld();
    }
    showHint('Nether portal activated! Walk through the purple opening.', 3500);
    sfx('click');
    return true;
  }
  function activatePortalAtTarget() {
    return !!target && get(target.x, target.y, target.z) === OBSIDIAN &&
      lightPortalAt(target.x, target.y, target.z);
  }
  function lightTnt() {
    if (mode === 'survival' && !(inv[FLINT] > 0)) { showHint('You have no flint & steel.', 1500); return 0.3; }
    if (activatePortalAtTarget()) return 0.3;
    if (!target || get(target.x, target.y, target.z) !== TNT) {
      flashName('Aim flint & steel at a complete obsidian frame or TNT'); return 0.3;
    }
    setBlock(target.x, target.y, target.z, 0); queueRebuild(target.x, target.z); flushRebuilds();
    spawnTnt(target.x + 0.5, target.y, target.z + 0.5, 3, 0, 0, 0);
    return 0.4;
  }
  function useEgg(id) {
    const kind = EGG_KINDS[id], K = KINDS[kind];
    if (K.hostile && hasHealth() && DIFF[difficulty].cap === 0) { flashName('Monsters cannot spawn on Peaceful'); return 0.4; }
    if (!target) { flashName('Aim at a block to spawn a ' + kind); return 0.3; }
    const x = target.x + target.nx + 0.5, z = target.z + target.nz + 0.5;
    let y = target.y + target.ny + 0.01, ok = false;
    for (let k = 0; k < 3 && !ok; k++) { if (!collides(x, y + k, z, K.r, K.h)) { y += k; ok = true; } }
    if (!ok) { flashName('Not enough room there'); return 0.3; }
    if (!spendItem(id)) return 0.4;
    const m = addMob(kind, x, y, z, kind === 'villager' ? { job: JOBS[Math.floor(Math.random() * JOBS.length)] } : null);
    m.persist = true; m.hx = x; m.hz = z;   // egg creatures stay put (no daylight burn-off, villagers adopt this spot as home)
    sfx('pop'); sfxAt(kind, x, y + 1, z);
    return 0.4;
  }
  const fadeEl = document.getElementById('fade');
  function useBed(t) {
    spawnPoint = { x: t.x, y: t.y, z: t.z };
    if (!isNight && weather !== 'storm') { showHint('Respawn point set. You can only sleep at night or in a storm.', 2800); sfx('click'); return; }
    if (hasHealth()) for (let i = 0; i < mobs.length; i++) if (mobs[i].hostile && Math.hypot(mobs[i].x - t.x, mobs[i].z - t.z) < 14) { showHint('You cannot sleep with monsters nearby.', 2600); sfx('no'); return; }
    sleepT = 3.2; slept = false;
    showHint('Respawn point set. Sleeping\u2026', 2000);
  }
  // Right click / E: place a block, or use the item in the selected slot. Returns the cooldown to wait.
  function useSelected() {
    const it = hotbar[selected];
    if (it < 100) { doPlace(); return 0.22; }
    if (FOOD[it] !== undefined) return eatItem(it);
    if (it === DYNAMITE) return throwDynamite();
    if (it === FLINT) return lightTnt();
    if (TOOLS[it]) { flashName(NAMES[it] + ' (left click to use)'); return 0.3; }
    if (EGG_KINDS[it]) return useEgg(it);
    flashName(NAMES[it] + ' is a crafting item');
    return 0.4;
  }
  // Build a golem: four blocks of iron, copper or diamond in a T (three across, one below the middle) with a hay bale on top.
  const GOLEM_OF = { 31: 'irongolem', 32: 'coppergolem', 33: 'diamondgolem' };
  const GOLEM_INGOT = { irongolem: IRON_INGOT, coppergolem: COPPER_INGOT, diamondgolem: DIAMOND };
  function spawnGolem(kind, x, y, z) {
    const m = addMob(kind, x, y, z, null);
    m.persist = true; m.hx = x; m.hz = z;
    sfx('pop'); sfxAt('hit', x, y + 1, z);
    return m;
  }
  function tryBuildGolem(px, py, pz) {
    for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 3; dy++) for (let dz = -2; dz <= 2; dz++) {
      const hx = px + dx, hy = py + dy, hz = pz + dz;
      if (get(hx, hy, hz) !== HAY) continue;
      const m = get(hx, hy - 1, hz), kind = GOLEM_OF[m];
      if (!kind || get(hx, hy - 2, hz) !== m) continue;
      const axes = [[1, 0], [0, 1]];
      for (let a = 0; a < 2; a++) {
        const ax = axes[a];
        if (get(hx + ax[0], hy - 1, hz + ax[1]) === m && get(hx - ax[0], hy - 1, hz - ax[1]) === m) {
          [[hx, hy, hz], [hx, hy - 1, hz], [hx, hy - 2, hz], [hx + ax[0], hy - 1, hz + ax[1]], [hx - ax[0], hy - 1, hz - ax[1]]].forEach(function (c) {
            setBlock(c[0], c[1], c[2], 0); queueRebuild(c[0], c[2]);
          });
          flushRebuilds();
          spawnGolem(kind, hx + 0.5, hy - 2 + 0.01, hz + 0.5);
          flashName('You built a golem!');
          return true;
        }
      }
    }
    return false;
  }
  function healGolem(m) {
    const ing = GOLEM_INGOT[m.kind], K = KINDS[m.kind];
    if (hotbar[selected] !== ing || m.hp >= K.hp) return false;
    if (!spendItem(ing)) return false;
    m.hp = Math.min(K.hp, m.hp + K.hp * 0.25); sfx('pop'); flashName('Golem repaired');
    return true;
  }
  function placeBed(x, y, z) {
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const dir = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 0 : 2) : (fz > 0 ? 1 : 3);
    const dv = BED_DIR[dir], hx = x + dv[0], hz = z + dv[1];
    if (!chunkAt(hx >> 4, hz >> 4) || get(hx, y, hz) || !solid(get(x, y - 1, z)) || !solid(get(hx, y - 1, hz))) { flashName('A bed needs two free spots on solid ground'); return; }
    const cells = [[x, z], [hx, hz]];
    for (let i = 0; i < 2; i++) { const c = cells[i]; if (c[0] + 1 > player.x - PR && c[0] < player.x + PR && y + BED_H > player.y && y < player.y + PH && c[1] + 1 > player.z - PR && c[1] < player.z + PR) return; }
    if (mode === 'survival') {
      if (!(inv[BED] > 0)) { showHint('You have no bed.', 1500); return; }
      inv[BED]--; updateHotbar(false);
    }
    setBlock(x, y, z, 19 + dir * 2); setBlock(hx, y, hz, 19 + dir * 2 + 1);
    sfx('place', 1, 0, BED); refreshAround(x, z); refreshAround(hx, hz);
  }
  function detectObsidianPortal(px, py, pz) {
    return lightPortalAt(px, py, pz);
  }

  function doPlace() {
    if (!target) return;
    const x = target.x + target.nx, y = target.y + target.ny, z = target.z + target.nz;
    if (!inBounds(x, y, z) || get(x, y, z)) return;
    if (hotbar[selected] === BED) { placeBed(x, y, z); return; }
    if (hotbar[selected] !== TORCH && x + 1 > player.x - PR && x < player.x + PR && y + 1 > player.y && y < player.y + PH && z + 1 > player.z - PR && z < player.z + PR) return;
    const b = hotbar[selected];
    if (b === TORCH && !solid(get(x, y - 1, z))) { flashName('Torches need something to stand on'); return; }
    if (mode === 'survival') {
      if (!(inv[b] > 0)) { showHint('You have no ' + NAMES[b].toLowerCase() + '. Mine some first.', 1800); return; }
      inv[b]--; updateHotbar(false);
    }
    setBlock(x, y, z, b);
    if (b === OBSIDIAN) detectObsidianPortal(x, y, z);
    sfx('place', 1, 0, b);
    refreshAround(x, z, b === TORCH);
    if (b === HAY || GOLEM_OF[b]) tryBuildGolem(x, y, z);
  }

  function handleActions(dt, tNow) {
    mineCd -= dt; placeCd -= dt; attackCd -= dt;
    const holdOK = !drag || (tNow - drag.t0 > 160 && drag.moved < 6);
    const touchHold = !!(lookT && lookT.moved < 10 && tNow - lookT.t0 > 220);
    const heldMine = (mining && holdOK) || touchHold;
    const heldPlace = placing && holdOK;
    const wantMine = heldMine || pulseMine;
    const wantPlace = heldPlace || pulsePlace;
    const pm = pulseMine, pp = pulsePlace;
    pulseMine = false; pulsePlace = false;

    if (mode === 'spectator') { resetMine(); return; }

    const mobHit = raycastMobs(3.6);
    if (wantMine) {
      if (mobHit && (!blockHit || mobHit.t < blockHit.t + 0.01)) {
        if (attackCd <= 0) { attackMob(mobHit.mob); attackCd = 0.45; }
        resetMine();
      } else if (mode === 'creative') {
        if (target && target.y > 0 && (pm || mineCd <= 0)) { doBreak(target); mineCd = 0.2; }
      } else if (mode === 'survival') {
        if (heldMine && target && target.y > 0) {
          if (mine.x === target.x && mine.y === target.y && mine.z === target.z) mine.t += dt;
          else { mine.x = target.x; mine.y = target.y; mine.z = target.z; mine.t = dt; }
          const tb = get(target.x, target.y, target.z), total = (BREAK_TIME[tb] || 1) / toolSpeed(tb);
          mineBar.style.display = 'block'; mineBar.firstChild.style.width = Math.min(100, mine.t / total * 100) + '%';
          if (mine.t >= total) { doBreak(target); resetMine(); }
        } else resetMine();
      }
    } else resetMine();

    if (wantPlace && canInteract() && (pp || placeCd <= 0)) {
      if (mobHit && mobHit.mob.kind === 'villager' && (!blockHit || mobHit.t < blockHit.t)) { openTrade(mobHit.mob); placeCd = 0.4; }
      else if (mobHit && mobHit.mob.golem && (!blockHit || mobHit.t < blockHit.t) && healGolem(mobHit.mob)) { placeCd = 0.5; }
      else if (target && isBed(get(target.x, target.y, target.z)) && !(keys.ShiftLeft || keys.ShiftRight)) { useBed(target); placeCd = 0.6; }
      else if (target && get(target.x, target.y, target.z) === CTABLE && !(keys.ShiftLeft || keys.ShiftRight)) { openCraft(3); placeCd = 0.4; }
      else placeCd = useSelected();
    }
  }

  /* ---------- Update loop ---------- */
  let gtime = 0, stepDist = 0, lavaDamageTimer = 0;
  function update(dt, tNow) {
    dt = Math.min(dt, 0.05);
    gtime += dt;
    lavaDamageTimer -= dt;
    if (mode !== 'spectator' && lavaDamageTimer <= 0 && get(Math.floor(player.x), Math.floor(player.y + 0.2), Math.floor(player.z)) === LAVA) {
      damagePlayer(2, false); lavaDamageTimer = 0.8; flashName('Ouch! Lava burns you!');
    }
    if (sleepT > 0) {
      sleepT -= dt;
      const el = 3.2 - sleepT;
      fadeEl.style.opacity = sleepT <= 0 ? 0 : (el < 1 ? el : (sleepT > 1 ? 1 : sleepT));
      if (!slept && el >= 1.2) { slept = true; tod = 0.02; setWeather('clear'); showHint('Good morning!', 1800); sfx('pop'); }
    }
    let mx = 0, mz = 0;
    if (keys.KeyW) mz -= 1;
    if (keys.KeyS) mz += 1;
    if (keys.KeyA) mx -= 1;
    if (keys.KeyD) mx += 1;
    if (keys.ArrowLeft) player.yaw += 2.0 * dt;
    if (keys.ArrowRight) player.yaw -= 2.0 * dt;
    if (keys.ArrowUp) player.pitch = Math.min(1.55, player.pitch + 1.6 * dt);
    if (keys.ArrowDown) player.pitch = Math.max(-1.55, player.pitch - 1.6 * dt);
    mx += touchMove.x; mz += touchMove.z;
    if (sleepT > 0) { mx = 0; mz = 0; }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const shift = keys.ShiftLeft || keys.ShiftRight;
    const jumpHeld = (keys.Space || touchJump) && sleepT <= 0;
    const sn = Math.sin(player.yaw), cs = Math.cos(player.yaw);

    if (mode === 'spectator') {
      const speed = 12 * specSpeed, cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
      const tvx = (mx * cs + mz * sn * cp) * speed;
      const tvz = (-mx * sn + mz * cs * cp) * speed;
      const tvy = (-mz * sp + ((jumpHeld ? 1 : 0) - (shift ? 1 : 0))) * speed;
      const k = Math.min(1, 10 * dt);
      player.vx += (tvx - player.vx) * k; player.vy += (tvy - player.vy) * k; player.vz += (tvz - player.vz) * k;
      player.x += player.vx * dt;
      player.y = Math.max(-5, Math.min(H + 40, player.y + player.vy * dt));
      player.z += player.vz * dt;
      player.onGround = false; player.fallStart = null;
    } else {
      const flying = player.fly && mode === 'creative';
      const sprinting = shift && !flying && (mx !== 0 || mz !== 0) && !(mode === 'survival' && hunger <= 6);   // too hungry to sprint
      const speed = flying ? (keys.ControlLeft ? 18 : 10) : (sprinting ? 6.6 : 4.4);
      const tvx = (mx * cs + mz * sn) * speed;
      const tvz = (-mx * sn + mz * cs) * speed;
      const accel = (player.onGround || flying) ? 14 : 3.5;
      const k = Math.min(1, accel * dt);
      player.vx += (tvx - player.vx) * k;
      player.vz += (tvz - player.vz) * k;
      if (flying) {
        const up = (jumpHeld ? 1 : 0) - (shift ? 1 : 0);
        player.vy += (up * speed - player.vy) * Math.min(1, 10 * dt);
      } else {
        player.vy = Math.max(-50, player.vy - 28 * dt);
        if (jumpHeld && player.onGround) { player.vy = 8.6; exert(sprinting ? 0.2 : 0.04); }
      }
      player.onGround = false;
      moveEnt(player, 0, player.vx * dt);
      moveEnt(player, 2, player.vz * dt);
      moveEnt(player, 1, player.vy * dt);
      checkPortal(dt);
      if (player.y < -30) respawn();
      const wspd = Math.hypot(player.vx, player.vz);
      exert(dt * (0.015 + (wspd > 1.2 && player.onGround ? (sprinting ? 0.13 : 0.03) : 0)));
      if (mode === 'survival' && hunger !== shownHunger) updateFood();
      if (!flying && player.onGround && wspd > 1.2) {
        stepDist += wspd * dt;
        if (stepDist > 2.2) { stepDist = 0; sfx('step', 0.8, 0, get(Math.floor(player.x), Math.floor(player.y - 0.2), Math.floor(player.z))); }
      }

      if (flying) player.fallStart = null;
      else if (player.onGround) {
        if (player.fallStart !== null) {
          const dist = player.fallStart - player.y;
          if (dist > 3.5) damagePlayer(Math.floor(dist - 3)); else if (dist > 1.6) sfx('land', Math.min(1, dist / 5));
          player.fallStart = null;
        }
      } else if (player.vy < 0) {
        player.fallStart = (player.fallStart === null) ? player.y : Math.max(player.fallStart, player.y);
      } else player.fallStart = null;
    }

    camera.position.set(player.x, player.y + EYE, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);

    blockHit = mode === 'spectator' ? null : raycast(canInteract() ? (mode === 'creative' ? 6 : 5) : 4);
    target = canInteract() ? blockHit : null;
    if (target) { sel.visible = true; sel.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5); }
    else sel.visible = false;

    updateMobs(dt); updateBlasts(dt); updateArrows(dt); updateFx(dt); updateMusic(dt);
    if (hasHealth()) {
      sinceHurt += dt;
      if (hp < MAXHP && sinceHurt > DIFF[difficulty].regenAfter && (mode !== 'survival' || difficulty === 'peaceful' || hunger >= 15)) {
        regenT += dt;
        if (regenT >= DIFF[difficulty].regenEvery) { regenT = 0; hp = Math.min(MAXHP, hp + 1); updateHearts(); exert(1.2); }
      }
      if (mode === 'survival' && difficulty !== 'peaceful' && hunger <= 0) {
        starveT += dt;
        if (starveT >= 4) { starveT = 0; if (hp > (difficulty === 'easy' ? 10 : (difficulty === 'normal' ? 1 : 0))) damagePlayer(1); }
      } else starveT = 0;
      if (mode === 'adventure') checkRelics();
    }
    if (!dead && sleepT <= 0) handleActions(dt, tNow);
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.35; camera.position.y += (Math.random() - 0.5) * shake * 0.35;
      camera.rotation.z = (Math.random() - 0.5) * shake * 0.05;
      shake = Math.max(0, shake - dt * 2.2);
    } else camera.rotation.z = 0;
  }

  /* ---------- Day / night ---------- */
  /* ---------- Weather: rain and thunderstorms ---------- */
  const RAIN_N = 700;
  const rainPos = new Float32Array(RAIN_N * 6), rainMeta = [];
  for (let i = 0; i < RAIN_N; i++) rainMeta.push({ x: 0, y: -1e9, z: 0, v: 24, minY: 0 });
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMesh = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xb4d0ee, transparent: true, opacity: 0.55, depthWrite: false }));
  rainMesh.frustumCulled = false; rainMesh.visible = false; scene.add(rainMesh);
  const bolts = [];
  const boltEl = document.getElementById('bolt');
  const WEATHER_LABEL = { clear: 'Clear', rain: 'Rain', storm: 'Storm' };
  function setWeather(w) {
    weather = w;
    rainTarget = w === 'clear' ? 0 : (w === 'rain' ? 0.75 : 1);
    weatherT = w === 'clear' ? 420 + Math.random() * 480 : (w === 'rain' ? 150 + Math.random() * 270 : 100 + Math.random() * 140);
    nextBolt = 3 + Math.random() * 6;
    updateWeatherUI();
  }
  function strike() {
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
    lightningT = 1;
    const dist = Math.hypot(bx + 0.5 - player.x, bz + 0.5 - player.z), del = Math.min(3.5, dist / 28);
    if (Snd.ctx) {
      const v = Math.max(0.15, 1 - dist / 90);
      hiss({ d: 2.2, vol: 0.6 * v, type: 'lowpass', f: 450, f2: 60, delay: del });
      tone({ f: 58, f2: 28, d: 1.8, type: 'sine', vol: 0.5 * v, delay: del });
      hiss({ d: 0.12, vol: 0.4 * v, type: 'highpass', f: 2500 });
    }
    if (dist < 3.5 && hasHealth() && player.y + 1 > gy - 3) damagePlayer(6);   // a roof overhead protects you
    mobs.slice().forEach(function (m) { if (Math.hypot(m.x - (bx + 0.5), m.z - (bz + 0.5)) < 3.5) damageMob(m, 12); });
  }
  function updateWeather(dt) {
    weatherT -= dt;
    if (weatherT <= 0) setWeather(weather === 'clear' ? (Math.random() < 0.72 ? 'rain' : 'storm') : 'clear');
    const diff = rainTarget - rainLevel;
    rainLevel += Math.sign(diff) * Math.min(Math.abs(diff), dt / 12);
    if (weather === 'storm') { nextBolt -= dt; if (nextBolt <= 0) { nextBolt = 5 + Math.random() * 12; strike(); } }
    if (lightningT > 0) lightningT = Math.max(0, lightningT - dt * 3);
    boltEl.style.opacity = lightningT * 0.5;
    for (let i = bolts.length - 1; i >= 0; i--) {
      bolts[i].life -= dt;
      if (bolts[i].life <= 0) { scene.remove(bolts[i].mesh); bolts[i].mesh.geometry.dispose(); bolts[i].mesh.material.dispose(); bolts.splice(i, 1); }
    }
  }
  // Raindrops fall around the camera and stop at the first surface above them, so roofs keep the rain off
  function columnTop(x, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    return chunkAt(bx >> 4, bz >> 4) ? topY(bx, bz) + 1 : camera.position.y - 40;
  }
  function updateRain(dt) {
    rainMesh.visible = rainLevel > 0.02;
    if (!rainMesh.visible) return;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const active = Math.floor(RAIN_N * rainLevel);
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
  let rainGain = null, rainFilter = null, rainSndT = 0, rainSheltered = false;
  function updateRainSound(dt) {
    if (!Snd.ctx || !Snd.noise) return;
    if (!rainGain) {
      const c = Snd.ctx, src = c.createBufferSource();
      src.buffer = Snd.noise; src.loop = true;
      rainFilter = c.createBiquadFilter(); rainFilter.type = 'lowpass'; rainFilter.frequency.value = 5000;
      rainGain = c.createGain(); rainGain.gain.value = 0;
      src.connect(rainFilter); rainFilter.connect(rainGain); rainGain.connect(Snd.sfxGain);
      src.start();
    }
    rainSndT -= dt;
    if (rainSndT <= 0) { rainSndT = 0.3; rainSheltered = topY(Math.floor(player.x), Math.floor(player.z)) > player.y + 2; }
    const target = rainLevel * (rainSheltered ? 0.05 : 0.16);
    rainGain.gain.value += (target - rainGain.gain.value) * Math.min(1, dt * 2);
    rainFilter.frequency.value = rainSheltered ? 900 : 5000;
  }

  let tod = 0.22;
  const DAY = 1200;   // a full day lasts 20 minutes: 10 of daylight, 10 of night
  const cNight = new THREE.Color(0x0a1230), cDay = new THREE.Color(0x87ceeb), cDusk = new THREE.Color(0xf0905a), tmpC = new THREE.Color();
  const sunDir = new THREE.Vector3();
  const cGray = new THREE.Color(0x707a86), cFlash = new THREE.Color(0xdde6ff), tmpG = new THREE.Color();
  function daylight(dt) {
    tod = (tod + dt / DAY) % 1;
    const a = tod * Math.PI * 2;
    const s = Math.sin(a);
    isNight = s < -0.1; isDay = s > 0.05;
    const k = Math.max(0, Math.min(1, 0.5 + s * 1.2));
    if (dimension === 'nether') tmpC.set(0x581b18);
    else if (dimension === 'end') tmpC.set(0x160d2b);
    else tmpC.copy(cNight).lerp(cDay, k);
    const dusk = Math.max(0, 1 - Math.abs(s - 0.02) / 0.22) * 0.55;
    if (dimension === 'overworld') tmpC.lerp(cDusk, dusk);
    if (rainLevel > 0.01) { tmpG.copy(cNight).lerp(cGray, k); tmpC.lerp(tmpG, rainLevel * 0.8); }   // overcast sky
    if (lightningT > 0) tmpC.lerp(cFlash, lightningT * 0.55);
    scene.fog.near = dimension === 'nether' ? 12 : (dimension === 'end' ? 24 : 30 - 14 * rainLevel);
    scene.fog.far = dimension === 'nether' ? 48 : (dimension === 'end' ? 95 : 78 - 30 * rainLevel);
    scene.background.copy(tmpC); scene.fog.color.copy(tmpC);
    const lightL = dimension === 'nether' ? 0.62 : (dimension === 'end' ? 0.42 : Math.max(0.28, Math.min(1, 0.55 + s * 0.7)) * (1 - 0.3 * rainLevel) + lightningT * 0.5);
    dayUniform.value = lightL; glowMat.opacity = 0.2 + (1 - lightL) * 0.75;
    sunDir.set(Math.cos(a), Math.sin(a), 0.25).normalize();
    sun.position.copy(camera.position).addScaledVector(sunDir, 200);
    moon.position.copy(camera.position).addScaledVector(sunDir, -200);
    sun.lookAt(camera.position); moon.lookAt(camera.position);
    sun.visible = s > -0.2 && rainLevel < 0.6; moon.visible = s < 0.2 && rainLevel < 0.6;
  }

  /* ---------- UI / state ---------- */
  const overlay = document.getElementById('overlay');
  const playBtn = document.getElementById('play');
  const newBtn = document.getElementById('newworld');
  const subEl = document.getElementById('sub');
  const infoEl = document.getElementById('info');
  const hintEl = document.getElementById('hint');
  const objEl = document.getElementById('objective');
  const modeDescEl = document.getElementById('modeDesc');
  const modeBtns = Array.prototype.slice.call(document.querySelectorAll('.mode'));
  const diffBtns = Array.prototype.slice.call(document.querySelectorAll('.dmode'));
  const diffDescEl = document.getElementById('diffDesc');
  const DIFF_DESC = {
    peaceful: 'No monsters, no hunger, and health comes back quickly. Falls and explosions still hurt.',
    easy: 'Fewer, slower monsters that hit softly, with slow-firing skeletons and longer creeper fuses.',
    normal: 'The standard challenge.',
    hard: 'Lots of fast monsters that spot you from far away and hit hard. Skeletons shoot quickly, creepers blow sooner, and health returns slowly.'
  };
  const DESC = {
    creative: 'Unlimited blocks, instant building and flying. Nothing can hurt you.',
    survival: 'Mine blocks to collect them, then build with what you gather. Stone needs a pickaxe, and better tools mine faster. Keep an eye on your hunger and eat meat. Dig for coal, copper, iron and diamonds. Zombies, skeletons, creepers and spiders come out at night, and falls hurt. Torches light up the dark and keep them from spawning nearby. Craft a table from planks for bigger recipes.',
    adventure: 'The world is protected, so you can\u2019t break or place blocks. Find all ' + RELIC_COUNT + ' glowing relics and stay alive.',
    spectator: 'Fly through anything and look around. You can\u2019t touch the world. Scroll to change speed.'
  };
  const LABEL = { creative: 'Creative', survival: 'Survival', adventure: 'Adventure', spectator: 'Spectator' };

  if (isTouch) {
    touchUI.style.display = 'block';
    document.getElementById('controls').innerHTML =
      '<dt>Left side</dt><dd>Drag to move</dd><dt>Right side</dt><dd>Drag to look, tap to break or hit, hold to mine</dd>' +
      '<dt>Place</dt><dd>Puts down the selected block</dd><dt>Hotbar</dt><dd>Tap to choose a block</dd><dt>Bag</dt><dd>Open the inventory</dd>';
  }

  function updateModeUI() {
    const inter = canInteract(), health = hasHealth();
    hotbarEl.style.display = inter ? 'flex' : 'none';
    heartsEl.style.display = health ? 'flex' : 'none';
    heartsEl.classList.toggle('raised', inter);
    foodEl.style.display = mode === 'survival' ? 'flex' : 'none'; foodEl.classList.toggle('raised', inter);
    objEl.style.display = mode === 'adventure' ? 'block' : 'none';
    sel.visible = false; resetMine();
    bPlace.style.display = inter ? 'block' : 'none';
    bFly.style.display = mode === 'creative' ? 'block' : 'none';
    bInv.style.display = inter ? 'block' : 'none';
    bJump.textContent = mode === 'spectator' ? 'Up' : 'Jump';
    for (const r of relics) r.group.visible = (mode === 'adventure') && !r.got;
    modeBtns.forEach(function (b) { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    modeDescEl.textContent = DESC[mode];
    updateDiffUI();
    updateHotbar(false); updateHearts(); updateFood();
  }
  function setMode(m) {
    mode = m;
    mining = placing = pulseMine = pulsePlace = false;
    clearMobs();
    hp = MAXHP; sinceHurt = 99; regenT = 0; hunger = 20; sat = 5; exhaust = 0; starveT = 0;
    player.fly = (m === 'spectator'); player.vy = 0; player.fallStart = null;
    if (dead) { dead = false; respawn(); playBtn.textContent = ready ? 'Play' : 'Loading\u2026'; subEl.textContent = 'Mode changed to ' + LABEL[m] + '.'; }
    if (ready && m !== 'spectator' && collides(player.x, player.y, player.z)) player.y = topY(Math.floor(player.x), Math.floor(player.z)) + 1.01;
    updateModeUI();
  }
  const wBtns = Array.prototype.slice.call(document.querySelectorAll('.wmode'));
  function updateWeatherUI() {
    wBtns.forEach(function (b) { const on = b.dataset.weather === weather; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }
  wBtns.forEach(function (b) { b.addEventListener('click', function () { setWeather(b.dataset.weather); sfx('click'); saveWorld().then(refreshWorlds); }); });
  updateWeatherUI();
  const sfxBtn = document.getElementById('sfxBtn'), musicBtn = document.getElementById('musicBtn');
  function syncSoundBtns() {
    sfxBtn.textContent = 'Sound: ' + (Snd.sfx ? 'On' : 'Off'); musicBtn.textContent = 'Music: ' + (Snd.music ? 'On' : 'Off');
    sfxBtn.setAttribute('aria-pressed', Snd.sfx ? 'true' : 'false'); musicBtn.setAttribute('aria-pressed', Snd.music ? 'true' : 'false');
  }
  sfxBtn.addEventListener('click', function () { audioInit(); Snd.sfx = !Snd.sfx; applySound(); saveSound(); syncSoundBtns(); sfx('click'); });
  musicBtn.addEventListener('click', function () { audioInit(); Snd.music = !Snd.music; applySound(); saveSound(); syncSoundBtns(); if (Snd.music) Snd.nextMusic = 0.2; });
  window.addEventListener('keydown', function (e) {
    if (e.code !== 'KeyM' || e.repeat) return;
    audioInit();
    const on = !(Snd.sfx || Snd.music);
    Snd.sfx = Snd.music = on; applySound(); saveSound(); syncSoundBtns();
    if (playing) showHint('Sound ' + (on ? 'on' : 'off'), 1200);
  });
  syncSoundBtns();
  function updateDiffUI() {
    diffBtns.forEach(function (b) { const on = b.dataset.diff === difficulty; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    diffDescEl.textContent = DIFF_DESC[difficulty] + (hasHealth() ? '' : ' (Applies in Survival and Adventure.)');
  }
  function setDifficulty(d) {
    if (!DIFF[d]) return;
    difficulty = d;
    if (DIFF[d].cap === 0 && hasHealth()) for (let i = mobs.length - 1; i >= 0; i--) if (mobs[i].hostile) removeMobAt(i);
    updateDiffUI();
    sfx('click');
    saveWorld().then(refreshWorlds);
  }
  diffBtns.forEach(function (b) { b.addEventListener('click', function () { setDifficulty(b.dataset.diff); }); });
  modeBtns.forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); saveWorld().then(refreshWorlds); }); });

  let hintTimer = 0;
  function showHint(msg, ms) {
    hintEl.textContent = msg; hintEl.style.display = 'block';
    clearTimeout(hintTimer); hintTimer = setTimeout(function () { hintEl.style.display = 'none'; }, ms || 6000);
  }
  function enterFallback() {
    if (fallback || isTouch) return;
    fallback = true; locked = false;
    playing = true; overlay.classList.add('hidden');
    showHint('Mouse capture is blocked here. Drag to look, click to break, right-click to place.', 6000);
  }
  function requestLock() {
    try {
      const p = canvas.requestPointerLock && canvas.requestPointerLock();
      if (p && p.catch) p.catch(enterFallback);
      if (!canvas.requestPointerLock) enterFallback();
    } catch (err) { enterFallback(); }
    setTimeout(function () { if (playing && !locked && !fallback && !isTouch) enterFallback(); }, 500);
  }
  document.addEventListener('pointerlockerror', enterFallback);
  document.addEventListener('pointerlockchange', function () {
    if (document.pointerLockElement === canvas) locked = true;
    else if (locked) { locked = false; mining = placing = false; if (!fallback && !invOpen) pause(); }
  });

  function startGame() {
    if (!ready) return;
    audioInit();
    if (dead) { dead = false; respawn(); hp = MAXHP; hunger = 20; sat = 5; exhaust = 0; sinceHurt = 99; clearMobs(); updateHearts(); updateFood(); }
    overlay.classList.add('hidden');
    playing = true;
    if (mode === 'spectator') showHint('Space up, Shift down, scroll changes speed. You fly where you look.', 5000);
    else if (mode === 'adventure') showHint('Find the glowing beams. Each one marks a relic.', 5000);
    if (!isTouch && !fallback) requestLock();
  }
  function pause() {
    playing = false; mining = placing = false; drag = null;
    for (const k in keys) keys[k] = false;
    subEl.textContent = 'Paused. Pick a mode or keep playing.';
    playBtn.textContent = 'Resume';
    overlay.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    saveWorld().then(refreshWorlds);
  }
  function die() {
    dead = true;
    pause();
    subEl.textContent = 'You died. Respawn to try again.';
    playBtn.textContent = 'Respawn';
  }
  playBtn.addEventListener('click', startGame);
  /* ---------- Commands (press T or /) ---------- */
  const chatEl = document.getElementById('chatlog'), cmdBar = document.getElementById('cmdbar'), cmdInput = document.getElementById('cmdinput');
  const cmdHist = []; let cmdHistI = 0;
  const chatLines = [];
  function chat(msg, kind) {
    const line = document.createElement('div');
    line.className = 'cl' + (kind ? ' ' + kind : ''); line.textContent = msg;
    chatEl.appendChild(line); chatLines.push(line);
    while (chatLines.length > 9) chatEl.removeChild(chatLines.shift());
    setTimeout(function () { const i = chatLines.indexOf(line); if (i >= 0) { chatLines.splice(i, 1); chatEl.removeChild(line); } }, 12000);
  }
  const CMDS = {};
  function defCmd(names, usage, desc, fn, choices) {
    const c = { name: names[0], usage: usage, desc: desc, fn: fn, choices: choices };
    names.forEach(function (n) { CMDS[n] = c; });
  }
  const { slug, itemMap, findItem } = createItemResolver(NAMES, BED);
  function spawnSpot() {
    const x = player.x - Math.sin(player.yaw) * 3, z = player.z - Math.cos(player.yaw) * 3;
    getOrGen(Math.floor(x) >> 4, Math.floor(z) >> 4);
    return [x, topY(Math.floor(x), Math.floor(z)) + 1.01, z];
  }
  function ensureAround(x, z) { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) getOrGen((Math.floor(x) >> 4) + dx, (Math.floor(z) >> 4) + dz); }
  function rebuildRegion(x1, z1, x2, z2) {
    for (let cx = (Math.min(x1, x2) >> 4) - 1; cx <= (Math.max(x1, x2) >> 4) + 1; cx++) for (let cz = (Math.min(z1, z2) >> 4) - 1; cz <= (Math.max(z1, z2) >> 4) + 1; cz++) rebuildSet.add(cx + ',' + cz);
    flushRebuilds();
  }
  const MODE_ALIASES = { creative: 'creative', c: 'creative', '1': 'creative', survival: 'survival', s: 'survival', '0': 'survival', adventure: 'adventure', a: 'adventure', '2': 'adventure', spectator: 'spectator', sp: 'spectator', '3': 'spectator' };
  const DIFF_ALIASES = { peaceful: 'peaceful', p: 'peaceful', '0': 'peaceful', easy: 'easy', e: 'easy', '1': 'easy', normal: 'normal', n: 'normal', '2': 'normal', hard: 'hard', h: 'hard', '3': 'hard' };
  const TIME_NAMES = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 };
  const mobNames = function () { return Object.keys(KINDS); };

  defCmd(['help', '?'], '/help [command]', 'List the commands, or explain one', function (a) {
    if (a[0]) {
      const c = CMDS[a[0].toLowerCase().replace(/^\//, '')];
      if (!c) throw new Error('No command called "' + a[0] + '"');
      return c.usage + '  -  ' + c.desc;
    }
    const names = []; Object.keys(CMDS).forEach(function (k) { if (CMDS[k].name === k) names.push(k); });
    return 'Commands: ' + names.sort().map(function (n) { return '/' + n; }).join('  ') + '   (try /help <command>)';
  }, function () { return Object.keys(CMDS); });
  function clearPortalVisuals() { while (portalVisuals.length) { const m = portalVisuals.pop(); scene.remove(m); m.geometry.dispose(); m.material.dispose(); } }
  function showPortalVisual(portal) {
    if (portal.dimension !== dimension) return;
    const geo = new THREE.PlaneGeometry(portal.width + 0.85, portal.height - 0.15);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9a42ff, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(portal.x + 0.5, portal.y + 1 + portal.height / 2, portal.z + 0.5);
    if (portal.axis === 'z') mesh.rotation.y = Math.PI / 2;
    scene.add(mesh); portalVisuals.push(mesh);
  }
  function buildPortalFrame(dim, centerX, baseY, centerZ) {
    // Build a classic obsidian portal frame (5 blocks wide, 5 blocks tall).
    const cx = Math.round(centerX), cz = Math.round(centerZ), by = Math.max(1, Math.min(H - 6, Math.floor(baseY)));
    // Load all nearby chunks before placing the frame, including Z-side chunks.
    ensureAround(cx, cz);
    // Standard 4-by-5 frame (two blocks wide and three blocks tall inside).
    const portal = { dimension: dim, x: cx - 0.5, y: by, z: cz, width: 2, height: 3, axis: 'x' };
    for (let dx = -2; dx <= 1; dx++) {
      for (let dy = 0; dy <= 4; dy++) {
        const edge = dx === -2 || dx === 1 || dy === 0 || dy === 4;
        setBlock(cx + dx, by + dy, cz, edge ? OBSIDIAN : 0);
      }
    }
    portals.push(portal);
    showPortalVisual(portal);
    rebuildRegion(cx - 2, cz, cx + 2, cz);
    saveWorld();
    showHint('Portal activated! Walk through the purple opening.', 3000);
    return portal;
  }
  function changeDimension(target, x, z, y) {
    clearPortalVisuals();
    if (dimension === 'overworld') chunks.forEach(function (c) { if (c.edited) savedChunks.set(ckey(c.cx, c.cz), c.data.slice()); });
    chunks.forEach(function (c) { disposeMesh(c); });
    chunks.clear(); resetChunkCache(); structCache.clear(); clearMobs();
    dimension = target;
    portals.forEach(showPortalVisual);
    const tx = x === undefined ? 0.5 : x, tz = z === undefined ? 0.5 : z;
    ensureAround(tx, tz);
    player.x = tx; player.z = tz;
    player.y = y === undefined ? (target === 'nether' ? 15 : (target === 'end' ? 22 : topY(Math.floor(tx), Math.floor(tz)) + 1.01)) : y;
    for (let tries = 0; tries < 12 && collides(player.x, player.y, player.z); tries++) player.y += 1;
    player.vx = player.vy = player.vz = 0; player.fallStart = null;
    saveWorld();
    showHint(target === 'nether' ? 'Welcome to the Nether! Watch your step in the red-hot caverns.' : target === 'end' ? 'Welcome to the End! Stay on the floating islands.' : 'Back to the Overworld.', 5000);
  }
  function checkPortal(dt) {
    portalCooldown = Math.max(0, portalCooldown - dt);
    if (portalCooldown > 0 || !playing || dimension === 'end') return;
    const p = portals.find(q => portalContains(q, dimension, player));
    if (!p) return;
    const target = dimension === 'overworld' ? 'nether' : 'overworld';
    const scale = dimension === 'overworld' ? 1 / 8 : 8;
    const tx = Math.round(p.x * scale), tz = Math.round(p.z * scale);
    let destination = portals.find(function (q) { return q.dimension === target && Math.abs(q.x - tx) < 3 && Math.abs(q.z - tz) < 3; });
    // Load the destination dimension before building a paired frame there.
    changeDimension(target, tx, tz, target === 'nether' ? 15 : undefined);
    if (!destination) {
      getOrGen(tx >> 4, tz >> 4);
      const floorY = target === 'nether' ? 13 : topY(tx, tz) + 1;
      destination = buildPortalFrame(target, tx, floorY, tz);
    }
    // Move just in front of the matching doorway so the player won't bounce straight back.
    player.x = destination.x + (destination.axis === 'z' ? 2.1 : 0); player.z = destination.z + (destination.axis === 'z' ? 0 : 2.1); player.y = destination.y + 1.05;
    for (let tries = 0; tries < 12 && collides(player.x, player.y, player.z); tries++) player.y += 1;
    portalCooldown = 2.5;
    showHint('Portal travel: ' + (target === 'nether' ? 'Overworld → Nether' : 'Nether → Overworld'), 3000);
  }
  defCmd(['portal'], '/portal [build]', 'Build an obsidian Nether portal frame in front of you; walk through it to travel', function (a) {
    if (dimension === 'end') throw new Error('Nether portals do not work in the End. Return to the Overworld first.');
    if (a.length && a[0].toLowerCase() !== 'build') throw new Error('Usage: /portal [build]');
    const cx = Math.round(player.x - Math.sin(player.yaw) * 3);
    const cz = Math.round(player.z - Math.cos(player.yaw) * 3);
    const by = Math.max(1, Math.min(H - 6, Math.floor(player.y) - 1));
    const made = buildPortalFrame(dimension, cx, by, cz);
    saveWorld();
    return 'Built an obsidian Nether portal frame at ' + made.x + ' ' + made.y + ' ' + made.z + '. Walk through the doorway to travel.';
  }, function () { return ['build']; });
  defCmd(['dimension', 'dim'], '/dimension <overworld|nether|end>', 'Travel between the Overworld, Nether, and End', function (a) {
    const target = (a[0] || '').toLowerCase();
    if (['overworld', 'nether', 'end'].indexOf(target) < 0) throw new Error('Usage: /dimension <overworld|nether|end>');
    if (target === dimension) return 'You are already in the ' + target + '.';
    changeDimension(target);
    return 'Entered the ' + target + '.';
  }, function () { return ['overworld', 'nether', 'end']; });
  defCmd(['time'], '/time set <day|noon|sunset|night|midnight|sunrise|ticks> | add <ticks> | query', 'Change or read the time of day (24000 ticks per day)', function (a) {
    const sub = (a[0] || '').toLowerCase();
    if (sub === 'query') return 'It is ' + Math.round(tod * 24000) + ' ticks into the day (' + (isNight ? 'night' : 'day') + ')';
    if (sub === 'set' || sub === 'add') {
      const v = (a[1] || '').toLowerCase();
      const n = (sub === 'set' && TIME_NAMES[v] !== undefined) ? TIME_NAMES[v] : parseFloat(v);
      if (!isFinite(n)) throw new Error('Usage: /time ' + sub + (sub === 'set' ? ' <day|noon|sunset|night|midnight|sunrise|ticks>' : ' <ticks>'));
      tod = sub === 'set' ? ((((n % 24000) + 24000) % 24000) / 24000) : ((((tod + n / 24000) % 1) + 1) % 1);
      return 'Time ' + (sub === 'set' ? 'set to ' : 'moved on to ') + Math.round(tod * 24000) + ' ticks';
    }
    throw new Error('Usage: /time set <day|noon|sunset|night|midnight|sunrise|ticks>, /time add <ticks>, /time query');
  }, function (i) { return i === 1 ? ['set', 'add', 'query'] : Object.keys(TIME_NAMES); });
  defCmd(['day'], '/day', 'Set the time to morning', function () { tod = TIME_NAMES.day / 24000; return 'Time set to day'; });
  defCmd(['night'], '/night', 'Set the time to night', function () { tod = TIME_NAMES.night / 24000; return 'Time set to night'; });
  defCmd(['weather'], '/weather <clear|rain|storm> [seconds]', 'Change the weather', function (a) {
    const w = (a[0] || '').toLowerCase();
    if (!WEATHER_LABEL[w]) throw new Error('Usage: /weather <clear|rain|storm> [seconds]');
    setWeather(w);
    if (a[1] !== undefined && +a[1] > 0) weatherT = +a[1];
    saveWorld().then(refreshWorlds);
    return 'Weather set to ' + WEATHER_LABEL[w].toLowerCase();
  }, function () { return ['clear', 'rain', 'storm']; });
  defCmd(['gamemode', 'gm'], '/gamemode <creative|survival|adventure|spectator>', 'Switch game mode', function (a) {
    const m = MODE_ALIASES[(a[0] || '').toLowerCase()];
    if (!m) throw new Error('Usage: /gamemode <creative|survival|adventure|spectator>');
    setMode(m); saveWorld().then(refreshWorlds);
    return 'Game mode is now ' + LABEL[m];
  }, function () { return ['creative', 'survival', 'adventure', 'spectator']; });
  defCmd(['difficulty'], '/difficulty <peaceful|easy|normal|hard>', 'Change the difficulty', function (a) {
    const d = DIFF_ALIASES[(a[0] || '').toLowerCase()];
    if (!d) throw new Error('Usage: /difficulty <peaceful|easy|normal|hard>');
    setDifficulty(d);
    return 'Difficulty is now ' + DIFF[d].label.toLowerCase();
  }, function () { return ['peaceful', 'easy', 'normal', 'hard']; });
  defCmd(['give'], '/give <item> [count]', 'Give yourself an item or block (Creative puts it in your hotbar)', function (a) {
    if (!a[0]) throw new Error('Usage: /give <item> [count]');
    const id = findItem(a[0], false);
    let n = a[1] === undefined ? 1 : Math.floor(+a[1]);
    if (!(n >= 1)) throw new Error('The count must be 1 or more');
    n = Math.min(n, 9999);
    if (hotbar.indexOf(id) < 0) hotbar[selected] = id;
    if (mode === 'creative') { updateHotbar(true); return NAMES[id] + ' is in your hotbar (Creative items are unlimited)'; }
    inv[id] = Math.min(9999, (inv[id] || 0) + n); updateHotbar(true);
    return 'Gave you ' + n + ' ' + NAMES[id];
  }, function (i) { return i === 1 ? Object.keys(itemMap()) : []; });
  defCmd(['clear'], '/clear', 'Empty your backpack', function () { for (const k in inv) delete inv[k]; updateHotbar(false); return 'Backpack cleared'; });
  defCmd(['heal'], '/heal', 'Restore your health', function () { hp = MAXHP; sinceHurt = 99; updateHearts(); return 'You feel healthy again'; });
  defCmd(['feed'], '/feed', 'Fill your hunger bar', function () { hunger = 20; sat = 5; exhaust = 0; updateFood(); return 'You are no longer hungry'; });
  defCmd(['fly'], '/fly', 'Toggle flying (Creative)', function () {
    if (mode !== 'creative') throw new Error('Flying is a Creative mode ability');
    toggleFly(); return player.fly ? 'Flying on' : 'Flying off';
  });
  defCmd(['tp', 'teleport'], '/tp <x> <y> <z> | <x> <z> | spawn   (~ means relative)', 'Teleport', function (a) {
    let x, y, z;
    if ((a[0] || '').toLowerCase() === 'spawn') { x = 0.5; z = 0.5; ensureAround(x, z); y = topY(0, 0) + 1.01; }
    else if (a.length >= 3) { x = coord(a[0], player.x); y = coord(a[1], player.y); z = coord(a[2], player.z); ensureAround(x, z); }
    else if (a.length === 2) { x = coord(a[0], player.x); z = coord(a[1], player.z); ensureAround(x, z); y = topY(Math.floor(x), Math.floor(z)) + 1.01; }
    else throw new Error('Usage: /tp <x> <y> <z>, /tp <x> <z>, or /tp spawn');
    if (!(y > -20 && y < H + 200)) throw new Error('That height is out of range');
    for (let k = 0; k < 80 && mode !== 'spectator' && collides(x, y, z); k++) y += 1;
    player.x = x; player.y = y; player.z = z; player.vx = player.vy = player.vz = 0; player.fallStart = null;
    return 'Teleported to ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ' + z.toFixed(1);
  }, function (i) { return i === 1 ? ['spawn'] : []; });
  defCmd(['pos'], '/pos', 'Show where you are', function () { return 'You are at ' + player.x.toFixed(1) + ' ' + player.y.toFixed(1) + ' ' + player.z.toFixed(1); });
  defCmd(['seed'], '/seed', 'Show the world seed', function () { return 'Seed: ' + seed; });
  defCmd(['spawn', 'summon'], '/spawn <creature> [count]', 'Spawn creatures in front of you', function (a) {
    if (!a[0]) throw new Error('Usage: /spawn <creature> [count]. Creatures: ' + mobNames().join(', '));
    const q = slug(a[0]).replace(/_/g, '');
    let kind = mobNames().filter(function (k) { return k === q; })[0] || (q === 'golem' ? 'irongolem' : null);
    if (!kind) { const c = mobNames().filter(function (k) { return k.indexOf(q) === 0; }); if (c.length === 1) kind = c[0]; }
    if (!kind) throw new Error('Unknown creature "' + a[0] + '". Creatures: ' + mobNames().join(', '));
    const K = KINDS[kind];
    if (K.hostile && hasHealth() && DIFF[difficulty].cap === 0) throw new Error('Monsters cannot spawn on Peaceful');
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
  defCmd(['kill'], '/kill [hostile|passive|villagers|golems|all|me]', 'Remove creatures (or yourself)', function (a) {
    const what = (a[0] || 'hostile').toLowerCase();
    if (what === 'me' || what === 'self') {
      if (!hasHealth()) throw new Error('You can only do that in Survival or Adventure');
      hp = 1; damagePlayer(1); return 'Ouch.';
    }
    const sel = { hostile: function (m) { return m.hostile; }, passive: function (m) { return !m.hostile && !m.golem && m.kind !== 'villager'; }, villagers: function (m) { return m.kind === 'villager'; }, golems: function (m) { return m.golem; }, all: function () { return true; } }[what];
    if (!sel) throw new Error('Usage: /kill [hostile|passive|villagers|golems|all|me]');
    let n = 0;
    for (let i = mobs.length - 1; i >= 0; i--) if (sel(mobs[i])) { removeMobAt(i); n++; }
    return 'Removed ' + n + ' creature' + (n === 1 ? '' : 's');
  }, function () { return ['hostile', 'passive', 'villagers', 'golems', 'all', 'me']; });
  defCmd(['setblock'], '/setblock <x> <y> <z> <block|air>', 'Place a single block', function (a) {
    if (a.length < 4) throw new Error('Usage: /setblock <x> <y> <z> <block|air>');
    const x = Math.floor(coord(a[0], player.x)), y = Math.floor(coord(a[1], player.y)), z = Math.floor(coord(a[2], player.z));
    if (y < 0 || y >= H) throw new Error('Height must be between 0 and ' + (H - 1));
    const id = a[3].toLowerCase() === 'air' ? 0 : findItem(a[3], true);
    getOrGen(x >> 4, z >> 4);
    const old = get(x, y, z);
    setBlock(x, y, z, id); queueRebuild(x, z, id === TORCH || old === TORCH); flushRebuilds();
    return 'Set ' + x + ' ' + y + ' ' + z + ' to ' + (id ? NAMES[id] : 'air');
  }, function (i) { return i === 4 ? ['air'].concat(Object.keys(itemMap()).filter(function (k) { return itemMap()[k] < 100; })) : []; });
  defCmd(['fill'], '/fill <x1> <y1> <z1> <x2> <y2> <z2> <block|air>', 'Fill a box with a block (up to 32768 blocks)', function (a) {
    if (a.length < 7) throw new Error('Usage: /fill <x1> <y1> <z1> <x2> <y2> <z2> <block|air>');
    const x1 = Math.floor(coord(a[0], player.x)), y1 = Math.floor(coord(a[1], player.y)), z1 = Math.floor(coord(a[2], player.z));
    const x2 = Math.floor(coord(a[3], player.x)), y2 = Math.floor(coord(a[4], player.y)), z2 = Math.floor(coord(a[5], player.z));
    const lx = Math.min(x1, x2), hx = Math.max(x1, x2), lz = Math.min(z1, z2), hz = Math.max(z1, z2), ly = Math.max(0, Math.min(y1, y2)), hy = Math.min(H - 1, Math.max(y1, y2));
    const vol = (hx - lx + 1) * (hz - lz + 1) * (hy - ly + 1);
    if (vol > 32768) throw new Error('That is ' + vol + ' blocks. The limit is 32768');
    const id = a[6].toLowerCase() === 'air' ? 0 : findItem(a[6], true);
    for (let cx = lx >> 4; cx <= hx >> 4; cx++) for (let cz = lz >> 4; cz <= hz >> 4; cz++) getOrGen(cx, cz);
    for (let x = lx; x <= hx; x++) for (let z = lz; z <= hz; z++) for (let y = ly; y <= hy; y++) setBlock(x, y, z, id);
    rebuildRegion(lx, lz, hx, hz);
    return 'Filled ' + vol + ' block' + (vol === 1 ? '' : 's') + ' with ' + (id ? NAMES[id] : 'air');
  }, function (i) { return i === 7 ? ['air'].concat(Object.keys(itemMap()).filter(function (k) { return itemMap()[k] < 100; })) : []; });
  defCmd(['explode'], '/explode [radius]', 'Blow up the ground in front of you', function (a) {
    const r = Math.max(1, Math.min(12, +(a[0] || 4) || 4)), sp = spawnSpot();
    explode(sp[0], sp[1], sp[2], r, 30 * r / 4.2);
    return 'Boom (radius ' + r + ')';
  });
  defCmd(['locate'], '/locate <village|temple|tower|dungeon|cabin|circle> [tp]', 'Find the nearest structure', function (a) {
    const type = (a[0] || '').toLowerCase();
    if (!STRUCT_NAMES[type]) throw new Error('Usage: /locate <' + Object.keys(STRUCT_NAMES).join('|') + '> [tp]');
    const prx = Math.floor(player.x / REG), prz = Math.floor(player.z / REG);
    let best = null, bd = 1e9;
    for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) {
      const st = structureFor(prx + dx, prz + dz);
      if (!st || st.type !== type) continue;
      const d = Math.hypot(st.cx - player.x, st.cz - player.z);
      if (d < bd) { bd = d; best = st; }
    }
    if (!best) throw new Error('No ' + STRUCT_NAMES[type].toLowerCase() + ' within about 600 blocks');
    if ((a[1] || '').toLowerCase() === 'tp') {
      const x = best.cx + 0.5, z = best.cz + 4.5; ensureAround(x, z);
      player.x = x; player.z = z; player.y = topY(Math.floor(x), Math.floor(z)) + 1.01; player.vx = player.vy = player.vz = 0; player.fallStart = null;
      return 'Teleported to the ' + STRUCT_NAMES[type].toLowerCase() + ' at ' + best.cx + ' ' + best.cz;
    }
    return 'Nearest ' + STRUCT_NAMES[type].toLowerCase() + ': x ' + best.cx + ', z ' + best.cz + ' (' + Math.round(bd) + ' blocks away)';
  }, function (i) { return i === 1 ? Object.keys(STRUCT_NAMES) : (i === 2 ? ['tp'] : []); });
  defCmd(['save'], '/save', 'Save the world now', function () { saveWorld().then(refreshWorlds); return storageOK ? 'Saving the world...' : 'Saving is not available in this browser'; });
  defCmd(['say'], '/say <message>', 'Write a message in the chat', function (a) { return '[You] ' + a.join(' '); });

  function execute(line) {
    line = line.trim();
    if (!line) return;
    if (line.charAt(0) !== '/') { chat('[You] ' + line); return; }
    chat(line, 'echo');
    const parts = line.slice(1).trim().split(/\s+/), name = (parts.shift() || '').toLowerCase();
    if (!name) return;
    const c = CMDS[name];
    if (!c) { chat('Unknown command "' + name + '". Type /help for the list.', 'bad'); return; }
    try { const out = c.fn(parts); if (out) chat(out); }
    catch (err) { chat(err.message || String(err), 'bad'); }
  }
  function openCmd(prefill) {
    invOpen = true; cmdOpen = true; playing = false; mining = placing = false; drag = null;
    for (const k in keys) keys[k] = false;
    touchMove.x = 0; touchMove.z = 0; touchJump = false; stick = null; lookT = null;
    cmdBar.classList.remove('hidden'); cmdInput.value = prefill || ''; cmdHistI = cmdHist.length;
    if (document.pointerLockElement) document.exitPointerLock();
    setTimeout(function () { cmdInput.focus(); }, 0);
  }
  function completeCmd() {
    const raw = cmdInput.value.replace(/^\//, ''), parts = raw.split(/\s+/);
    if (parts.length === 1) {
      const names = Object.keys(CMDS).filter(function (n) { return n.indexOf(parts[0].toLowerCase()) === 0; });
      if (names.length === 1) cmdInput.value = '/' + names[0] + ' '; else if (names.length > 1) chat(names.join('  '), 'echo');
      return;
    }
    const c = CMDS[parts[0].toLowerCase()];
    if (!c || !c.choices) return;
    const cur = (parts[parts.length - 1] || '').toLowerCase();
    const opts = c.choices(parts.length - 1, parts).filter(function (x) { return String(x).indexOf(cur) === 0; });
    if (opts.length === 1) { parts[parts.length - 1] = opts[0]; cmdInput.value = '/' + parts.join(' ') + ' '; }
    else if (opts.length > 1) chat(opts.slice(0, 14).join('  ') + (opts.length > 14 ? '  ...' : ''), 'echo');
  }
  cmdInput.addEventListener('keydown', function (e) {
    e.stopPropagation();   // typing here must not trigger game keys
    if (e.key === 'Enter') {
      const line = cmdInput.value;
      if (line.trim()) { cmdHist.push(line); if (cmdHist.length > 50) cmdHist.shift(); }
      execute(line);
      closeInventory(!dead);   // if a command killed you, stay on the respawn screen
    } else if (e.key === 'Escape') { e.preventDefault(); closeInventory(false); }
    else if (e.key === 'Tab') { e.preventDefault(); completeCmd(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (cmdHistI > 0) { cmdHistI--; cmdInput.value = cmdHist[cmdHistI]; } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (cmdHistI < cmdHist.length - 1) { cmdHistI++; cmdInput.value = cmdHist[cmdHistI]; } else { cmdHistI = cmdHist.length; cmdInput.value = ''; } }
  });
  cmdInput.addEventListener('keyup', function (e) { e.stopPropagation(); });
  window.addEventListener('keydown', function (e) {
    if (cmdOpen || !playing || invOpen || e.repeat) return;
    if (e.code === 'KeyT') { e.preventDefault(); openCmd(''); }
    else if (e.key === '/') { e.preventDefault(); openCmd('/'); }
  });
  document.getElementById('btnCmd').addEventListener('click', function () { if (!isTouch && playing) openCmd('/'); });

  /* ---------- Saved worlds (IndexedDB, kept in this browser) ---------- */
  const worldsEl = document.getElementById('worlds');
  const saveNote = document.getElementById('saveNote');
  let db = null, storageOK = false, currentWorld = null, worldList = [], saveChain = Promise.resolve(), busy = false;
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // Dexie uses the existing v1 database/stores without a destructive upgrade.
  function openDB() { return openWorldStorage(); }
  function dbListWorlds() { return db.listWorlds(); }
  function dbGetWorld(id) { return db.getWorld(id); }
  function dbGetChunks(id) { return db.getChunks(id); }
  function dbDeleteWorld(id) { return db.deleteWorld(id); }

  function snapshot() {
    const m = currentWorld;
    m.dimension = dimension; m.enderDragonDefeated = enderDragonDefeated; m.portals = snapshotPortals(portals); m.mode = mode; m.difficulty = difficulty; m.spawn = spawnPoint; m.omen = omen; m.hunger = hunger; m.sat = sat; m.weather = { w: weather, t: weatherT, r: rainLevel }; m.lastPlayed = Date.now(); m.tod = tod; m.hp = dead ? MAXHP : hp;
    m.selected = selected; m.hotbar = hotbar.slice(); m.inv = Object.assign({}, inv);
    m.player = { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, fly: !!player.fly };
    m.relics = relics.map(function (r) { return { x: r.x, y: r.y, z: r.z, got: r.got }; });
    m.toolWear = Object.assign({}, toolWear);
    m.golems = mobs.filter(function (g) { return g.golem && g.persist; }).map(function (g) { return { kind: g.kind, x: g.x, y: g.y, z: g.z, hp: g.hp, hx: g.hx, hz: g.hz }; });
    return m;
  }
  function doSave() {
    if (!storageOK || !currentWorld || !ready) return Promise.resolve();
    const meta = snapshot();
    const dirty = [];
    if (dimension === 'overworld') chunks.forEach(function (c) { if (c.dirty) dirty.push(c); });
    const recMap = new Map();
    dirty.forEach(function (c) {
      c.dirty = false;
      recMap.set(ckey(c.cx, c.cz), { k: meta.id + ':' + c.cx + ',' + c.cz, w: meta.id, cx: c.cx, cz: c.cz, data: c.data.slice() });
    });
    // Keep modified Overworld chunks safe while the player explores other dimensions.
    if (dimension !== 'overworld') savedChunks.forEach(function (data, key) {
      const parts = key; // key is the packed chunk coordinate used by the chunk cache
      const cx = (parts >> 16) << 16 >> 16, cz = (parts << 16) >> 16;
      const k = meta.id + ':' + cx + ',' + cz;
      recMap.set(key, { k: k, w: meta.id, cx: cx, cz: cz, data: data.slice() });
    });
    const recs = Array.from(recMap.values());
    return db.saveWorld(meta, recs).catch(function (err) {
      // Keep dirty chunks in memory if the transaction fails; retry on autosave.
      dirty.forEach(function (c) { c.dirty = true; });
      throw err;
    });
  }
  function saveWorld() {
    saveChain = saveChain.then(doSave).catch(function (err) {
      console.error('MauriceCraft save failed:', err);
      showHint('Saving failed. Your changes are still in memory; please keep this tab open and try again.', 6500);
    });
    return saveChain;
  }


  function ago(t) {
    const sec = Math.max(0, (Date.now() - t) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
    if (sec < 86400) return Math.floor(sec / 3600) + ' h ago';
    return Math.floor(sec / 86400) + ' d ago';
  }
  function renderWorlds() {
    worldsEl.innerHTML = '';
    saveNote.textContent = storageOK
      ? 'Worlds save automatically in this browser, including every block you change.'
      : 'Saving is not available in this browser, so this world will be lost when you leave.';
    worldList.forEach(function (w) {
      const isCur = !!currentWorld && currentWorld.id === w.id;
      const row = document.createElement('div'); row.className = 'world' + (isCur ? ' on' : '');
      const main = document.createElement('button'); main.type = 'button'; main.className = 'wmain';
      main.appendChild(document.createTextNode(w.name));
      const sm = document.createElement('small'); sm.textContent = (LABEL[w.mode] || 'Creative') + ' \u00b7 played ' + ago(w.lastPlayed || w.created || Date.now()); main.appendChild(sm);
      main.addEventListener('click', function () { if (busy) return; if (isCur) startGame(); else loadWorld(w.id); });
      const del = document.createElement('button'); del.type = 'button'; del.className = 'wdel'; del.textContent = 'Delete';
      del.setAttribute('aria-label', 'Delete ' + w.name);
      let armed = false, t = 0;
      del.addEventListener('click', function () {
        if (busy) return;
        if (!armed) { armed = true; del.textContent = 'Sure?'; del.classList.add('armed'); t = setTimeout(function () { armed = false; del.textContent = 'Delete'; del.classList.remove('armed'); }, 2500); }
        else { clearTimeout(t); deleteWorld(w.id); }
      });
      row.appendChild(main); row.appendChild(del); worldsEl.appendChild(row);
    });
  }
  async function refreshWorlds() {
    if (storageOK) {
      try { worldList = (await dbListWorlds()).sort(function (a, b) { return (b.lastPlayed || 0) - (a.lastPlayed || 0); }); } catch (e) { /* keep old list */ }
    }
    renderWorlds();
  }
  function setBusy(b, text) {
    busy = b;
    playBtn.disabled = newBtn.disabled = b;
    worldsEl.classList.toggle('busy', b);
    if (b) { playBtn.textContent = 'Loading\u2026'; subEl.textContent = text || 'Loading\u2026'; }
  }
  function finishLoad() {
    subEl.textContent = currentWorld.name + '. Choose a mode and play.';
    playBtn.textContent = 'Play';
    setBusy(false);
    renderWorlds();
    playBtn.focus({ preventScroll: true });
  }

  function applyWorld(m) {
    const p = m.player || { x: 0.5, y: 60, z: 0.5, yaw: 0, pitch: 0, fly: false };
    dimension = ['overworld', 'nether', 'end'].includes(m.dimension) ? m.dimension : 'overworld';
    enderDragonDefeated = !!m.enderDragonDefeated;
    portals.length = 0; portals.push(...restorePortals(m.portals));
    clearPortalVisuals(); portals.forEach(showPortalVisual);
    resetWorld(m.seed, Math.floor(p.x / 16), Math.floor(p.z / 16));
    clearMobs();
    player.x = p.x; player.y = p.y; player.z = p.z; player.vx = player.vy = player.vz = 0;
    player.yaw = p.yaw || 0; player.pitch = p.pitch || 0; player.fallStart = null;
    for (const k in inv) delete inv[k];
    Object.keys(m.inv || {}).forEach(function (k) { inv[k] = m.inv[k]; });
    if (m.hotbar && m.hotbar.length === 9) for (let i = 0; i < 9; i++) hotbar[i] = m.hotbar[i];
    selected = m.selected || 0;
    tod = (typeof m.tod === 'number') ? m.tod : 0.22;
    for (const k in toolWear) delete toolWear[k];
    Object.keys(m.toolWear || {}).forEach(function (k) { toolWear[k] = m.toolWear[k]; });
    mode = m.mode || 'creative';
    difficulty = DIFF[m.difficulty] ? m.difficulty : 'normal';
    spawnPoint = m.spawn || null; omen = !!m.omen;
    if (m.weather && WEATHER_LABEL[m.weather.w]) { weather = m.weather.w; weatherT = m.weather.t || 300; rainLevel = m.weather.r || 0; }
    else { weather = 'clear'; weatherT = 420; rainLevel = 0; }
    rainTarget = weather === 'clear' ? 0 : (weather === 'rain' ? 0.75 : 1); updateWeatherUI();
    clearRelics();
    (m.relics || []).forEach(function (r) { addRelic(r.x, r.y, r.z, r.got); });
    ready = true; dead = false;
    if (!relics.length) createRelics();
    setMode(mode);
    hp = (m.hp > 0) ? m.hp : MAXHP; updateHearts();
    hunger = (typeof m.hunger === 'number') ? m.hunger : 20; sat = (typeof m.sat === 'number') ? m.sat : 5; updateFood();
    (m.golems || []).forEach(function (g) {
      if (!KINDS[g.kind] || Math.hypot(g.x - player.x, g.z - player.z) > 60 || !chunkAt(Math.floor(g.x) >> 4, Math.floor(g.z) >> 4)) return;
      const gm = addMob(g.kind, g.x, g.y, g.z, null); gm.hp = g.hp; gm.persist = true; gm.hx = g.hx; gm.hz = g.hz;
    });
    if (mode === 'creative') player.fly = !!p.fly;
  }
  async function loadWorld(id) {
    setBusy(true, 'Loading world\u2026');
    try {
      await saveWorld();
      ready = false;
      const meta = await dbGetWorld(id);
      if (!meta) throw new Error('missing');
      const recs = await dbGetChunks(id);
      savedChunks.clear();
      recs.forEach(function (r) { savedChunks.set(ckey(r.cx, r.cz), r.data); });
      currentWorld = meta;
      await sleep(20);
      applyWorld(meta);
      finishLoad();
    } catch (e) {
      await newWorld();
    }
  }
  async function newWorld() {
    setBusy(true, 'Building your world\u2026');
    try { await saveWorld(); } catch (e) { /* ignore */ }
    ready = false;
    await sleep(20);
    let maxN = 0;
    worldList.forEach(function (w) { const mm = /^World (\d+)$/.exec(w.name); if (mm) maxN = Math.max(maxN, +mm[1]); });
    const sd = (Math.random() * 1e6) | 0;
    savedChunks.clear();
    currentWorld = { id: 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), name: 'World ' + (maxN + 1), seed: sd, created: Date.now(), lastPlayed: Date.now() };
    resetWorld(sd, 0, 0);
    spawnPoint = null; omen = false;
    weather = 'clear'; weatherT = 420 + Math.random() * 300; rainLevel = 0; rainTarget = 0; updateWeatherUI();
    respawn(); clearMobs();
    for (const k in inv) delete inv[k];
    for (let i = 0; i < 9; i++) hotbar[i] = ALL_BLOCKS[i];
    selected = 0; tod = 0.22;
    for (const k in toolWear) delete toolWear[k];
    createRelics();
    ready = true; dead = false;
    setMode(mode);
    await saveWorld();
    await refreshWorlds();
    finishLoad();
  }
  async function deleteWorld(id) {
    if (busy) return;
    const wasCurrent = !!currentWorld && currentWorld.id === id;
    setBusy(true, 'Deleting\u2026');
    try { await saveChain; await dbDeleteWorld(id); } catch (e) { /* ignore */ }
    if (wasCurrent) { currentWorld = null; ready = false; }
    await refreshWorlds();
    if (wasCurrent) { if (worldList.length) await loadWorld(worldList[0].id); else await newWorld(); }
    else setBusy(false);
  }
  newBtn.addEventListener('click', function () { if (!busy) newWorld(); });
  async function init() {
    try { db = await openDB(); storageOK = true; } catch (e) { storageOK = false; }
    if (storageOK) {
      try { worldList = (await dbListWorlds()).sort(function (a, b) { return (b.lastPlayed || 0) - (a.lastPlayed || 0); }); }
      catch (e) { storageOK = false; worldList = []; }
    }
    renderWorlds();
    if (storageOK && worldList.length) await loadWorld(worldList[0].id); else await newWorld();
  }
  setInterval(function () { if (ready && playing) saveWorld(); }, 15000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveWorld(); });
  window.addEventListener('pagehide', function () { saveWorld(); });

  let frames = 0, fpsT = 0, fps = 0, infoT = 0;
  let last = performance.now();
  function frame(now) {
    const dt = (now - last) / 1000; last = now;
    if (ready) {
      streamChunks();
      if (playing) update(dt, now);
      else { camera.position.set(player.x, player.y + EYE, player.z); camera.rotation.set(player.pitch, player.yaw, 0); }
      daylight(dt);
      updateWeather(dt); updateRain(dt); updateRainSound(dt);
      updateRelics(dt, now / 1000);
      if (playing) {
        frames++; fpsT += dt; infoT += dt;
        if (fpsT >= 1) { fps = frames; frames = 0; fpsT = 0; }
        if (infoT > 0.2) {
          infoT = 0;
          const state = mode === 'creative' ? (player.fly ? 'Flying' : 'Walking') : (isNight && hasHealth() ? 'Night' : (mode === 'spectator' ? 'x' + specSpeed.toFixed(2) : 'Day'));
          infoEl.textContent = LABEL[mode] + (hasHealth() ? ' \u00b7 ' + DIFF[difficulty].label : '') + '  ' + state + '\nX ' + player.x.toFixed(1) + '  Y ' + player.y.toFixed(1) + '  Z ' + player.z.toFixed(1) + '\n' + fps + ' fps' + (weather === 'clear' ? '' : ' \u00b7 ' + WEATHER_LABEL[weather]) + '\nNearby: ' + nearestStructure();
          if (mode === 'adventure') objEl.textContent = objectiveText();
        }
      }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  setMode('creative');
  setTimeout(init, 30);
  requestAnimationFrame(frame);
})();
