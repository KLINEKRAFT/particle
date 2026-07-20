import type { BackendCapabilities } from '../types';

// Feature-detect the rendering backends and recommend a particle budget based
// on rough hardware signals. Never assume a device can do 1M particles.

export async function detectCapabilities(): Promise<BackendCapabilities> {
  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  const cores = nav.hardwareConcurrency || 4;
  const deviceMemoryGb = nav.deviceMemory || 4;

  let webgpu = false;
  let adapterInfo = 'unknown';
  if ('gpu' in navigator && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        webgpu = true;
        const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
        if (info) {
          adapterInfo = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'WebGPU adapter';
        } else {
          adapterInfo = 'WebGPU adapter';
        }
      }
    } catch {
      webgpu = false;
    }
  }

  // WebGL2 detection + renderer string.
  let webgl2 = false;
  let maxTextureSize = 4096;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl) {
      webgl2 = true;
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg && adapterInfo === 'unknown') {
        adapterInfo = (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) || 'WebGL2';
      }
      const lose = gl.getExtension('WEBGL_lose_context');
      lose?.loseContext();
    }
  } catch {
    webgl2 = false;
  }

  // Rough recommendation heuristic.
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  let recommended = 150000;
  let maxRecommended = 1000000;
  if (isMobile) {
    recommended = 30000;
    maxRecommended = 150000;
  } else if (webgpu && cores >= 8 && deviceMemoryGb >= 8) {
    recommended = 300000;
    maxRecommended = 1000000;
  } else if (webgpu) {
    recommended = 200000;
    maxRecommended = 1000000;
  } else if (webgl2 && cores >= 8) {
    recommended = 150000;
    maxRecommended = 500000;
  } else if (webgl2) {
    recommended = 80000;
    maxRecommended = 250000;
  } else {
    recommended = 20000;
    maxRecommended = 50000;
  }

  return {
    webgpu,
    webgl2,
    maxTextureSize,
    adapterInfo,
    recommendedCount: recommended,
    maxRecommendedCount: maxRecommended,
    deviceMemoryGb,
    cores,
  };
}
