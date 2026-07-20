import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraMode, CameraSettings } from '../types';

// ============================================================================
// CameraController — perspective/orthographic cameras, OrbitControls, framing,
// preset views, and setViewOffset support for spanning multiple displays.
// ============================================================================

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
  mode: CameraMode;
}

export class CameraController {
  perspective: THREE.PerspectiveCamera;
  orthographic: THREE.OrthographicCamera;
  active: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls: OrbitControls;
  mode: CameraMode = 'perspective';

  private aspect = 1;
  private frameRadius = 2;
  private interactive: boolean;

  constructor(domElement: HTMLElement, settings: CameraSettings, interactive = true) {
    this.interactive = interactive;
    this.perspective = new THREE.PerspectiveCamera(settings.fov, 1, settings.near, settings.far);
    this.perspective.position.set(0, 0, 5);

    const f = 3;
    this.orthographic = new THREE.OrthographicCamera(-f, f, f, -f, settings.near, settings.far);
    this.orthographic.position.set(0, 0, 5);

    this.active = this.perspective;
    this.controls = new OrbitControls(this.active, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = settings.damping;
    this.controls.enabled = interactive;
    this.controls.autoRotate = settings.autoRotate;
    this.controls.autoRotateSpeed = settings.autoRotateSpeed;
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 60;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }

  applySettings(s: CameraSettings): void {
    this.perspective.fov = s.fov;
    this.perspective.near = s.near;
    this.perspective.far = s.far;
    this.perspective.updateProjectionMatrix();
    this.orthographic.near = s.near;
    this.orthographic.far = s.far;
    this.orthographic.updateProjectionMatrix();
    this.controls.dampingFactor = s.damping;
    this.controls.autoRotate = s.autoRotate;
    this.controls.autoRotateSpeed = s.autoRotateSpeed;
    if (s.mode !== this.mode) this.setMode(s.mode);
  }

  setMode(mode: CameraMode): void {
    const pos = this.active.position.clone();
    const target = this.controls.target.clone();
    this.mode = mode;
    this.active = mode === 'perspective' ? this.perspective : this.orthographic;
    this.active.position.copy(pos);
    this.controls.object = this.active;
    this.controls.target.copy(target);
    this.updateProjection();
    this.controls.update();
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.updateProjection();
  }

  private updateProjection(): void {
    this.perspective.aspect = this.aspect;
    this.perspective.updateProjectionMatrix();
    const r = this.frameRadius * 1.2;
    this.orthographic.left = -r * this.aspect;
    this.orthographic.right = r * this.aspect;
    this.orthographic.top = r;
    this.orthographic.bottom = -r;
    this.orthographic.updateProjectionMatrix();
  }

  /** Frame a sphere of the given radius centered at the origin. */
  frame(radius: number, animate = false): void {
    this.frameRadius = radius;
    const fov = this.perspective.fov * (Math.PI / 180);
    const dist = (radius * 1.4) / Math.sin(fov / 2);
    const dir = this.active.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(dist);
    if (!animate) {
      this.controls.target.set(0, 0, 0);
      this.active.position.copy(dir);
    } else {
      this.controls.target.set(0, 0, 0);
      this.active.position.copy(dir);
    }
    this.updateProjection();
    this.controls.update();
  }

  setView(view: 'front' | 'side' | 'top' | 'iso'): void {
    const d = this.active.position.distanceTo(this.controls.target) || 5;
    this.controls.target.set(0, 0, 0);
    switch (view) {
      case 'front': this.active.position.set(0, 0, d); break;
      case 'side': this.active.position.set(d, 0, 0); break;
      case 'top': this.active.position.set(0, d, 0.0001); break;
      case 'iso': this.active.position.set(d * 0.6, d * 0.5, d * 0.6); break;
    }
    this.controls.update();
  }

  reset(): void {
    this.frame(this.frameRadius);
  }

  update(): void {
    if (this.interactive) this.controls.update();
    else this.active.updateMatrixWorld();
  }

  getState(): CameraState {
    return {
      position: [this.active.position.x, this.active.position.y, this.active.position.z],
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
      zoom: this.active.zoom,
      mode: this.mode,
    };
  }

  applyState(state: CameraState): void {
    if (state.mode !== this.mode) this.setMode(state.mode);
    this.active.position.set(state.position[0], state.position[1], state.position[2]);
    this.controls.target.set(state.target[0], state.target[1], state.target[2]);
    this.active.zoom = state.zoom;
    this.active.updateProjectionMatrix();
    this.active.updateMatrixWorld();
  }

  /** For spanned multi-monitor: render a sub-rectangle of one continuous view. */
  applyViewOffset(fullW: number, fullH: number, offX: number, offY: number, w: number, h: number): void {
    this.perspective.setViewOffset(fullW, fullH, offX, offY, w, h);
    this.orthographic.setViewOffset(fullW, fullH, offX, offY, w, h);
  }

  clearViewOffset(): void {
    this.perspective.clearViewOffset();
    this.orthographic.clearViewOffset();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
