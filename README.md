# Particle Studio

An interactive, GPU-accelerated 3D **particle generator and simulator** for the
browser. Generate mathematical shapes, turn images into 2.5D particle reliefs,
render text as three-dimensional particle forms, and morph smoothly between any
of them — with up to **1,000,000 particles** on capable hardware.

Built with **Vite + TypeScript + Three.js**, using a **WebGPU** compute backend
(TSL storage buffers + compute shaders) with an automatic **WebGL2** fallback
(`GPUComputationRenderer`-style render-target GPGPU). The UI is vanilla
HTML/CSS/TS and is fully decoupled from the rendering engine.

---

## Features

- **Sources**
  - **Shapes:** cube, sphere, helix, torus, torus/trefoil knot, Lorenz attractor
    — each with its own parameters (surface/volume, thickness, turns, P/Q, σ/ρ/β…).
  - **Image → particles:** drag & drop PNG / JPG / WebP / SVG. Processed entirely
    locally in a Web Worker. Multiple depth modes (luminance, edge, radial,
    layered, wave, noise, optional grayscale depth map), colour from the image or
    a solid override, background removal, alpha/brightness masking.
  - **Text → particles:** multi-line text rasterised in a Web Worker with
    extrude / bevel / rounded / wave / layered depth. Browser fonts plus local
    `.ttf` / `.otf` / `.woff` upload.
  - **3D model → particles:** drag & drop a `.glb` / `.gltf` model; points are
    sampled across the mesh surface (area-weighted) for a true 3D particle form,
    using the model's own material/vertex colours or a solid override.
- **Morphing** between any two sources with spring physics, easing, and
  scatter / explode / spiral impulses.
- **Continuous motion:** curl & simplex noise, brownian, orbital, wave, vortex,
  gravity, centre attraction, explosion, pointer attraction/repulsion — all with
  a deterministic seed.
- **Rendering:** GPU point sprites / billboards in **a single draw call**, with
  soft / dot / square / glowing-disc / spark / sphere styles, additive or normal
  blending, size attenuation, glow, distance fade, and optional bloom.
- **Colour:** solid, 2- and 3-stop gradients, image colours, position/depth/
  velocity mapping, rainbow and custom palettes, plus hue/saturation/brightness/
  contrast and colour animation.
- **Camera:** OrbitControls (rotate / zoom / pan), perspective & orthographic,
  front/side/top/iso presets, auto-rotate, framing, and `setViewOffset`-based
  multi-monitor spanning.
- **Dual-monitor:** spanned single window **and** synchronized multi-window mode
  via the Window Management API + `BroadcastChannel`, with graceful fallbacks.
- **Performance:** hardware capability detection, recommended counts, adaptive
  render-scale, DPR cap, optional auto particle reduction, a live debug panel
  (FPS, frame time, draw calls, points, backend, resolution, DPR, GPU-memory
  estimate, adapter), and a pause button.
- **Presets:** eight built-ins plus save / rename / duplicate / delete /
  import / export (JSON) in LocalStorage.
- **Presentation mode** that hides the entire interface.

## Getting started

Requires **Node 18+**.

```bash
npm install      # install pinned dependencies (lockfile committed)
npm run dev      # start the Vite dev server (http://localhost:5173)
npm run build    # type-check (tsc --noEmit) + production build to dist/
npm run preview  # preview the production build locally
npm run typecheck
```

## Deployment (static site)

The production build in `dist/` is a fully static site. `vite.config.ts` uses
`base: './'` so it works both at a domain root and under a sub-path.

- **Vercel:** framework preset *Vite*, build `npm run build`, output `dist`.
  (Or drag-and-drop `dist/` in the dashboard.)
- **Netlify:** build command `npm run build`, publish directory `dist`.
- **GitHub Pages:** run `npm run build`, then publish the contents of `dist/`
  (e.g. push to a `gh-pages` branch or use an action). `base: './'` makes the
  project-page sub-path work without extra config.

Everything runs client-side — no server, no uploads. Images, fonts and presets
never leave the browser.

## Rendering architecture

```
AppController ── RendererManager ── ParticleEngine ── WebGPUParticleBackend (TSL compute + storage buffers)
     │               (renderer,        │              └ WebGLParticleBackend  (GPUComputationRenderer + gl.POINTS)
     │                scene, bloom)     │
     ├─ CameraController                ├─ GenerationManager ── Web Worker ── ShapeGenerator / ImageSampler / TextSampler
     ├─ MorphController                 │
     ├─ PerformanceManager              └─ (per-particle GPU buffers: position, velocity, target, colour)
     ├─ MultiScreenManager (BroadcastChannel + Window Management API)
     ├─ PresetManager (LocalStorage)
     └─ UIController (vanilla DOM)
```

Particle state (position, velocity, target, colour) lives in **GPU buffers**.
Each frame a GPU pass integrates a shared simulation:

```
force  = (target − position) · returnForce           // spring-to-shape / morph
       + motionField(position, time) · motionStrength // curl noise, vortex, …
       + pointerForce(position)
velocity = (velocity + force · dt) · damping
position = position + velocity · dt
```

- **WebGPU backend** (`WebGPUParticleBackend`) uses Three.js **TSL**
  `instancedArray` storage buffers and a **compute shader** for integration, then
  renders instanced camera-facing sprites (`SpriteNodeMaterial`) — WebGPU point
  primitives are always 1px, so sized particles use billboards. Morphing sets new
  targets (the spring pulls particles in) plus an optional impulse compute pass.
- **WebGL2 backend** (`WebGLParticleBackend`) integrates the same simulation with
  **`GPUComputationRenderer`** (position & velocity in floating-point render
  targets) and renders with `gl.POINTS` reading positions from the texture.

The backend is chosen at startup: WebGPU when available, otherwise WebGL2. Target
generation always runs in a **Web Worker** with transferable typed arrays, so the
UI stays responsive even while generating a million points. Outdated generation
jobs are cancelled (job-id tokens), and count/parameter changes are debounced.

## Browser capability notes

- **WebGPU** is used where available (Chrome/Edge 113+, and Safari/Firefox as
  their implementations ship). It gives the best performance and true compute
  shaders.
- **WebGL2** is the fallback and is broadly supported. Both paths render in a
  single draw call.
- **Window Management API** (`getScreenDetails`, `screen.isExtended`) is currently
  Chromium-only and requires user permission; the app feature-detects it and
  falls back gracefully.
- Floating-point render targets (WebGL2) are required for the fallback GPGPU path
  and are available on effectively all WebGL2 devices.

## Dual-monitor usage

1. **Spanned window (most reliable):** maximise/stretch a single browser window
   across both monitors. The renderer handles the ultra-wide aspect ratio and the
   particle object is never distorted.
2. **Synchronized dual windows:** click **Launch dual display**. Where the Window
   Management API is supported and permitted, one window opens per screen; each
   uses `PerspectiveCamera.setViewOffset()` to render its slice of one continuous
   scene, staying in sync via `BroadcastChannel` (camera, settings, seed, time,
   playback). Secondary windows regenerate the identical scene locally from the
   synced seed, so no large buffers are sent between windows.

**Fallbacks** (always available): *Open mirror window* (a second synchronized
window you drag to the other monitor), *Copy session link* (open it in any
window), or plain single-window mode. Each window has its own GPU context, so
dual-window mode offers an automatic particle-count reduction.

## Controls & shortcuts

| Action | Control |
| --- | --- |
| Rotate | Left-drag |
| Zoom | Wheel / trackpad scroll |
| Pan | Right-drag |
| Frame object | Double-click |
| Reset camera | `R` |
| Hide / show interface | `H` |
| Fullscreen | `F` |
| Pause / resume | `Space` |

## Performance

Performance depends heavily on the GPU — no fixed FPS is guaranteed. The app
detects hardware, recommends a starting count, warns before enabling ~1M
particles, and can adapt render scale (and optionally reduce particle count)
automatically when the frame rate stays below target.

At **very high counts the app automatically simplifies** for you:
- Bloom / heavy post-processing is best left off above a few hundred thousand
  particles (it re-renders the scene through additional passes).
- Adaptive quality lowers the internal render scale before touching particle
  count; the device-pixel-ratio is capped.

**Measured example** (this project was validated in a CPU-only *SwiftShader*
WebGL2 context — a deliberate worst case with no GPU acceleration):

| Particles | FPS (SwiftShader / no GPU) |
| --- | --- |
| 150,000 | ~60 |
| 250,000 | ~28 |
| 500,000 | ~30 |
| 1,000,000 | runs; frame-rate-bound on CPU raster |

On real GPUs (integrated or discrete) these figures are dramatically higher —
WebGPU with compute shaders in particular handles 500K–1M smoothly on modern
hardware. Always measure on your target device using the built-in debug panel.

## Known limitations

- An uploaded photo is not volumetric geometry: image mode produces a
  high-quality **2.5D relief** with user-controlled depth/extrusion, not a true
  3D reconstruction.
- WebGPU point primitives cannot be sized, so the WebGPU backend renders
  instanced sprites (a few more vertices per particle than `gl.POINTS`).
- The morph timeline shows spring-based transition progress; because the
  transition is physical (spring + impulse), it is played, not scrubbed.
- Synchronized multi-window mode depends on the Window Management API
  (Chromium-only today) and popup permission; the mirror-window and spanned-
  window fallbacks work everywhere.
- Very large source images are downscaled for sampling (capped internally) to
  bound memory and worker time.

## Project structure

```
src/
  main.ts                     entry point
  types.ts                    shared settings / message interfaces
  config/defaults.ts          default settings
  core/
    AppController.ts          wiring, main loop, input, generation, sync
    RendererManager.ts        renderer + scene + bloom + sizing
    ParticleEngine.ts         backend selection + per-frame uniforms
    backends/
      ParticleBackend.ts      backend interface
      WebGPUParticleBackend.ts  TSL compute + storage buffers + sprites
      WebGLParticleBackend.ts   GPUComputationRenderer + gl.POINTS
      glsl.ts / enums.ts        shared GLSL chunks + numeric encodings
    CameraController.ts       cameras, OrbitControls, view offset
    MorphController.ts        morph timeline + impulses
    PerformanceManager.ts     FPS / stats / adaptive quality
    GenerationManager.ts      worker orchestration + cancellation
    MultiScreenManager.ts     BroadcastChannel + Window Management API
    PresetManager.ts          built-in + LocalStorage presets
  generators/
    ShapeGenerator.ts         deterministic shape point clouds
    ImageSampler.ts           image → 2.5D particle relief
    TextSampler.ts            text → particle form
  workers/imageTextWorker.ts  runs the generators off the main thread
  ui/UIController.ts          all DOM controls, HUD, timeline
  ui/controls.ts              schema-driven control factory
  util/                       rng, colour, capability detection
  styles/main.css             dark premium UI theme
```

## License

MIT.
