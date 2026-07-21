import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import type { ModelSettings, ParticleTarget } from '../types';
import { hexToRgb } from '../util/color';

// ============================================================================
// ModelSampler — loads a GLB/glTF model and samples `count` points across its
// mesh surfaces (area-weighted) to produce true 3D particle targets. Runs on
// the main thread: GLTFLoader needs DOM/URL and MeshSurfaceSampler is fast.
// ============================================================================

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();

// World-space surface area of a mesh (sum of triangle areas).
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
    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    area += _ab.cross(_ac).length() * 0.5;
  }
  return area;
}

export async function sampleModel(
  data: ArrayBuffer | string,
  settings: ModelSettings,
  count: number,
): Promise<ParticleTarget> {
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
    try {
      loader.parse(data as ArrayBuffer, '', (g) => resolve(g as unknown as { scene: THREE.Object3D }), reject);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
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

  let written = 0;
  for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi];
    const share = mi === meshes.length - 1 ? count - written : Math.round((count * areas[mi]) / totalArea);
    if (share <= 0) continue;

    const hasVertexColor = !!mesh.geometry.attributes.color;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mat = mesh.material as any;
    const matColor: THREE.Color | null = mat && mat.color ? mat.color : null;

    let sampler: MeshSurfaceSampler;
    try {
      sampler = new MeshSurfaceSampler(mesh).build();
    } catch {
      continue; // skip un-sampleable geometry (e.g. no faces)
    }

    for (let i = 0; i < share && written < count; i++) {
      sampler.sample(tmpPos, undefined, hasVertexColor ? tmpColor : undefined);
      tmpPos.applyMatrix4(mesh.matrixWorld);
      positions[written * 3] = tmpPos.x;
      positions[written * 3 + 1] = tmpPos.y;
      positions[written * 3 + 2] = tmpPos.z;

      if (settings.useModelColor) {
        if (hasVertexColor) {
          colors[written * 3] = tmpColor.r;
          colors[written * 3 + 1] = tmpColor.g;
          colors[written * 3 + 2] = tmpColor.b;
        } else if (matColor) {
          colors[written * 3] = matColor.r;
          colors[written * 3 + 1] = matColor.g;
          colors[written * 3 + 2] = matColor.b;
        } else {
          colors[written * 3] = 1;
          colors[written * 3 + 1] = 1;
          colors[written * 3 + 2] = 1;
        }
      } else {
        colors[written * 3] = solid[0];
        colors[written * 3 + 1] = solid[1];
        colors[written * 3 + 2] = solid[2];
      }
      written++;
    }
  }

  // Fill any remainder (rounding) by repeating the last valid sample.
  for (let i = written; i < count; i++) {
    const src = written > 0 ? written - 1 : 0;
    positions[i * 3] = positions[src * 3];
    positions[i * 3 + 1] = positions[src * 3 + 1];
    positions[i * 3 + 2] = positions[src * 3 + 2];
    colors[i * 3] = colors[src * 3];
    colors[i * 3 + 1] = colors[src * 3 + 1];
    colors[i * 3 + 2] = colors[src * 3 + 2];
  }

  // Normalize: center on the origin and scale to fit a ~1.5-unit radius.
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
    if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
  }
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, cz = (minz + maxz) / 2;
  const half = Math.max(maxx - minx, maxy - miny, maxz - minz) / 2 || 1;
  const scale = (1.5 / half) * settings.scale;

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (positions[i * 3] - cx) * scale;
    positions[i * 3 + 1] = (positions[i * 3 + 1] - cy) * scale;
    positions[i * 3 + 2] = (positions[i * 3 + 2] - cz) * scale;
  }

  // Release GPU-less CPU geometry references.
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
