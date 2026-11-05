import * as THREE from 'three';
import { makeAtlas } from './texture-atlas';

export interface GameRenderer {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  atlasCanvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  mat: THREE.MeshBasicMaterial;
  torchMat: THREE.MeshBasicMaterial;
  dayUniform: { value: number };
  glowMat: THREE.PointsMaterial;
  sun: THREE.Mesh;
  moon: THREE.Mesh;
  sel: THREE.LineSegments;
}

/** Set up the canvas, lighting, and texture materials once at startup. */
export function createGameRenderer(getToolTile: (tier: number, kind: number) => number): GameRenderer {
  const canvas = document.getElementById('view');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing game canvas #view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 30, 78);
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 500);
  camera.rotation.order = 'YXZ';

  const atlasCanvas = makeAtlas(getToolTile);
  const tex = new THREE.CanvasTexture(atlasCanvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;

  const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });
  const dayUniform = { value: 1 };
  mat.onBeforeCompile = shader => {
    shader.uniforms.uDay = dayUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLight;\nvarying float vLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = aLight;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDay;\nvarying float vLight;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vColor * max(vec3(uDay), vLight * vec3(1.0, 0.8, 0.52));');
  };

  const torchMat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true });
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 64;
  const glowContext = glowCanvas.getContext('2d');
  if (!glowContext) throw new Error('Cannot draw torch glow without a 2D canvas');
  const glowGradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  glowGradient.addColorStop(0, 'rgba(255,205,120,1)');
  glowGradient.addColorStop(0.35, 'rgba(255,150,50,0.45)');
  glowGradient.addColorStop(1, 'rgba(255,120,30,0)');
  glowContext.fillStyle = glowGradient;
  glowContext.fillRect(0, 0, 64, 64);
  const glowMat = new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(glowCanvas), size: 3.4, transparent: true,
    opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending,
    color: 0xffffff,
  });

  function makeDisc(color: number, size: number): THREE.Mesh {
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ color, fog: false, depthWrite: false }),
    );
    scene.add(disc);
    return disc;
  }
  const sun = makeDisc(0xfff0a8, 34);
  const moon = makeDisc(0xdfe7ff, 24);
  const sel = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)),
    new THREE.LineBasicMaterial({ color: 0x000000 }),
  );
  sel.visible = false;
  scene.add(sel);

  function resizeViewport(): void {
    const width = window.innerWidth;
    const height = Math.max(1, window.innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resizeViewport);
  resizeViewport();
  return { canvas, renderer, scene, camera, atlasCanvas, tex, mat, torchMat, dayUniform,
    glowMat, sun, moon, sel };
}
