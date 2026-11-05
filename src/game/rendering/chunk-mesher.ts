import * as THREE from 'three';
import { ckey } from '../world/chunk-key';
import { liquidKind, liquidCornerHeight } from '../world/fluid-blocks';

export interface MeshChunk {
  cx: number;
  cz: number;
  data: Uint8Array;
  meshed: boolean;
  mesh?: THREE.Mesh | null;
  mesh2?: THREE.Mesh | null;
  glow?: THREE.Points | null;
  torches?: number[][] | null;
}
export interface MesherDependencies<T extends MeshChunk> {
  scene: THREE.Scene;
  mat: THREE.MeshBasicMaterial;
  torchMat: THREE.MeshBasicMaterial;
  glowMat: THREE.PointsMaterial;
  chunks: Map<number, T>;
  chunkAt: (cx: number, cz: number) => T | null;
  getBlock: (x: number, y: number, z: number) => number;
  opq: (block: number) => boolean;
  isBed: (block: number) => boolean;
  tiles: Readonly<Record<number, number[]>>;
  height: number;
  chunkSize: number;
  atlasTiles: number;
  bedHeight: number;
  torchId: number;
  waterId?: number;
  lavaId?: number;
}

/** Create and dispose visible chunk meshes without owning world generation. */
export function createChunkMesher<T extends MeshChunk>(deps: MesherDependencies<T>) {
  const { scene, mat, torchMat, glowMat, chunks, chunkAt, opq, isBed } = deps;
  const get = deps.getBlock;
  const TILES = deps.tiles, H = deps.height, CS = deps.chunkSize;
  const ATLAS_N = deps.atlasTiles, BED_H = deps.bedHeight, TORCH = deps.torchId;

  /* ---------- Chunk meshing and lighting ---------- */
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
  function disposeMesh(c: T): void {
    if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
    if (c.mesh2) { scene.remove(c.mesh2); c.mesh2.geometry.dispose(); c.mesh2 = null; }
    if (c.glow) { scene.remove(c.glow); c.glow.geometry.dispose(); c.glow = null; }
    c.meshed = false;
  }
  // A torch is a thin stick with a small flame on top, drawn in its own always-bright mesh
  function addTorch(pos: number[], uv: number[], col: number[], ind: number[], gpos: number[], x: number, y: number, z: number): void {
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
  function addBed(pos: number[], uv: number[], col: number[], ind: number[], light: number[], x: number, y: number, z: number, id: number, lv: number): void {
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
  function buildTorchMeshes(chunk: T, tpos: number[], tuv: number[], tcol: number[], tind: number[], gpos: number[]): void {
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
  function torchesOf(c: T): number[][] {
    if (c.torches) return c.torches;
    const out: number[][] = [], d = c.data;
    for (let i = 0; i < d.length; i++) if (d[i] === TORCH) out.push([c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15)]);
    c.torches = out;
    return out;
  }
  function computeLight(cx: number, cz: number) {
    const src: number[][] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = chunks.get(ckey(cx + dx, cz + dz));
      if (c) { const t = torchesOf(c); for (let i = 0; i < t.length; i++) src.push(t[i]); }
    }
    if (!src.length) return null;
    const x0 = cx * 16 - LIGHT_R, z0 = cz * 16 - LIGHT_R, S = 16 + 2 * LIGHT_R;
    const L = new Uint8Array(S * S * H), qx: number[] = [], qy: number[] = [], qz: number[] = [];
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
  function buildChunk(cx: number, cz: number): void {
    const chunk = chunkAt(cx, cz);
    if (!chunk) return;
    disposeMesh(chunk);
    chunk.meshed = true;
    const data = chunk.data;
    const pos: number[] = [], uv: number[] = [], col: number[] = [], ind: number[] = [];
    const tpos: number[] = [], tuv: number[] = [], tcol: number[] = [], tind: number[] = [], gpos: number[] = [], light: number[] = [];
    const LT = computeLight(cx, cz);
    const lightAt = LT ? function (x: number, y: number, z: number) {
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
            const neighbor = get(nx, ny, nz);
            // Do not draw internal water/lava faces: they create visible square seams
            // and cause large lakes to look like stacks of disconnected cubes.
            const fluid = liquidKind(b);
            if (opq(neighbor) || (fluid && liquidKind(neighbor) === fluid)) continue;
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
              const vertexY = fluid && c[1] === 1
                ? y + liquidCornerHeight(get, x, y, z, c[0], c[2])
                : y + c[1];
              pos.push(x + c[0], vertexY, z + c[2]);
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
  function refreshAround(x: number, z: number, wide = false): void {
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
  /** Shared block cube geometry for TNT and other loose block entities. */
  function blockGeo(blockId: number): THREE.BufferGeometry {
    const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
    const blockTiles = TILES[blockId];
    if (!blockTiles) throw new Error('Cannot render unknown block ID ' + blockId);
    FACES.forEach(face => {
      const vertexIndex = positions.length / 3;
      const tile = blockTiles[face.t];
      const minU = tile / ATLAS_N + EPS, maxU = (tile + 1) / ATLAS_N - EPS;
      const faceUvs = [[minU, EPS], [maxU, EPS], [maxU, 1 - EPS], [minU, 1 - EPS]];
      for (let corner = 0; corner < 4; corner++) {
        const [x, y, z] = face.c[corner];
        positions.push(x - 0.5, y - 0.5, z - 0.5);
        uvs.push(faceUvs[corner][0], faceUvs[corner][1]);
        colors.push(face.s, face.s, face.s);
      }
      indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex,
        vertexIndex + 2, vertexIndex + 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    return geometry;
  }
  return { disposeMesh, buildChunk, refreshAround, blockGeo };
}
