import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import type { ModelSettings, ParticleTarget } from '../types';
import { hexToRgb } from '../util/color';

// ============================================================================
// ModelSampler — loads a GLB/glTF (incl. Draco / meshopt compression, common
// for Meshy exports) and samples `count` points across its mesh surfaces,
// area-weighted. Per-point colour is read from the model's base-colour texture
// (sampled at each point's UV), or vertex/material colour, or a solid override.
// ============================================================================

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _loader: GLTFLoader | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLoader(renderer: any): GLTFLoader {
  if (_loader) return _loader;
  const loader = new GLTFLoader();
  try {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(draco);
  } catch { /* draco optional */ }
  try {
    loader.setMeshoptDecoder(MeshoptDecoder as unknown as never);
  } catch { /* meshopt optional */ }
  try {
    const ktx2 = new KTX2Loader().setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/basis/');
    if (renderer) ktx2.detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
  } catch { /* ktx2 optional (compressed textures won't be colour-sampled) */ }
  _loader = loader;
  return loader;
}

function meshArea(mesh: THREE.Mesh): number {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  if (!pos) return 0;
  const index = geo.index;
  const m = mesh.matrixWorld;
  let area = 0;
  const triCount = index ? index.count / 3 : pos.count / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    _a.fromBufferAttribute(pos, i0).applyMatrix4(m);
    _b.fromBufferAttribute(pos, i1).applyMatrix4(m);
    _c.fromBufferAttribute(pos, i2).applyMatrix4(m);
    area += _ab.subVectors(_b, _a).cross(_ac.subVectors(_c, _a)).length() * 0.5;
  }
  return area;
}

// Read a texture image into a pixel buffer (null if it can't be read on CPU,
// e.g. a GPU-compressed KTX2 texture).
interface TexPixels { data: Uint8ClampedArray; w: number; h: number; }
function readTexture(tex: THREE.Texture | null | undefined): TexPixels | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const img: any = tex?.image;
  if (!img) return null;
  const w = img.width || img.videoWidth || 0;
  const h = img.height || img.videoHeight || 0;
  if (!w || !h) return null; // compressed / non-drawable
  try {
    const cw = Math.min(1024, w);
    const ch = Math.min(1024, h);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, cw, ch);
    return { data: ctx.getImageData(0, 0, cw, ch).data, w: cw, h: ch };
  } catch {
    return null;
  }
}

export async function sampleModel(
  data: ArrayBuffer | string,
  settings: ModelSettings,
  count: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderer?: any,
): Promise<ParticleTarget> {
  const loader = getLoader(renderer);
  const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
    loader.parse(data as ArrayBuffer, '', (g) => resolve(g as unknown as { scene: THREE.Object3D }), reject);
  });

  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry && mesh.geometry.attributes.position) meshes.push(mesh);
  });
  if (meshes.length === 0) throw new Error('No mesh geometry found in this model.');

  const areas = meshes.map(meshArea);
  const totalArea = areas.reduce((a, b) => a + b, 0) || 1;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const solid = hexToRgb(settings.solidColor);
  const tmpPos = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const tmpUv = new THREE.Vector2();

  let written = 0;
  for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi];
    const share = mi === meshes.length - 1 ? count - written : Math.round((count * areas[mi]) / totalArea);
    if (share <= 0) continue;

    const geo = mesh.geometry;
    const hasVertexColor = !!geo.attributes.color;
    const hasUv = !!geo.attributes.uv;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mat = mesh.material as any;
    const matColor: THREE.Color | null = mat && mat.color ? mat.color : null;
    const tex = settings.useModelColor && hasUv ? readTexture(mat && mat.map) : null;

    let sampler: MeshSurfaceSampler;
    try {
      sampler = new MeshSurfaceSampler(mesh).build();
    } catch {
      continue;
    }

    for (let i = 0; i < share && written < count; i++) {
      sampler.sample(tmpPos, undefined, hasVertexColor ? tmpColor : undefined, hasUv ? tmpUv : undefined);
      tmpPos.applyMatrix4(mesh.matrixWorld);
      positions[written * 3] = tmpPos.x;
      positions[written * 3 + 1] = tmpPos.y;
      positions[written * 3 + 2] = tmpPos.z;

      let r = 1, g = 1, b = 1;
      if (settings.useModelColor) {
        if (tex) {
          const px = Math.min(tex.w - 1, Math.max(0, Math.floor(tmpUv.x * tex.w)));
          const py = Math.min(tex.h - 1, Math.max(0, Math.floor((1 - tmpUv.y) * tex.h)));
          const idx = (py * tex.w + px) * 4;
          r = tex.data[idx] / 255;
          g = tex.data[idx + 1] / 255;
          b = tex.data[idx + 2] / 255;
          if (matColor) { r *= matColor.r; g *= matColor.g; b *= matColor.b; }
        } else if (hasVertexColor) {
          r = tmpColor.r; g = tmpColor.g; b = tmpColor.b;
        } else if (matColor) {
          r = matColor.r; g = matColor.g; b = matColor.b;
        }
      } else {
        r = solid[0]; g = solid[1]; b = solid[2];
      }
      colors[written * 3] = r;
      colors[written * 3 + 1] = g;
      colors[written * 3 + 2] = b;
      written++;
    }
  }

  for (let i = written; i < count; i++) {
    const src = written > 0 ? written - 1 : 0;
    positions[i * 3] = positions[src * 3];
    positions[i * 3 + 1] = positions[src * 3 + 1];
    positions[i * 3 + 2] = positions[src * 3 + 2];
    colors[i * 3] = colors[src * 3];
    colors[i * 3 + 1] = colors[src * 3 + 1];
    colors[i * 3 + 2] = colors[src * 3 + 2];
  }

  // Normalize: center on origin, scale to a ~1.5-unit radius.
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
    if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
  }
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, cz = (minz + maxz) / 2;
  const halfMax = Math.max(maxx - minx, maxy - miny, maxz - minz) / 2 || 1;
  const scale = (1.5 / halfMax) * settings.scale;

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (positions[i * 3] - cx) * scale;
    positions[i * 3 + 1] = (positions[i * 3 + 1] - cy) * scale;
    positions[i * 3 + 2] = (positions[i * 3 + 2] - cz) * scale;
  }

  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry?.dispose?.();
  });

  const r = 1.5 * settings.scale;
  return {
    positions,
    colors,
    count,
    hasColor: true,
    bounds: { min: [-r, -r, -r], max: [r, r, r] },
  };
}
