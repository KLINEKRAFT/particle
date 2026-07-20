import './styles/main.css';
import { AppController } from './core/AppController';

// Entry point. Creates the canvas + UI overlay, then boots the AppController.
// Handles catastrophic startup errors with a visible message.

function boot(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app root missing');

  const canvas = document.createElement('canvas');
  canvas.id = 'scene';
  canvas.setAttribute('aria-label', '3D particle visualization');
  app.appendChild(canvas);

  const uiRoot = document.createElement('div');
  uiRoot.id = 'ui';
  app.appendChild(uiRoot);

  const controller = new AppController(canvas, uiRoot);
  controller.init().catch((err) => {
    console.error(err);
    const el = document.createElement('div');
    el.className = 'fatal';
    el.innerHTML = `<div><h2>Startup error</h2><p>${err instanceof Error ? err.message : String(err)}</p></div>`;
    document.body.appendChild(el);
  });

  // Handle WebGL/WebGPU context loss gracefully.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    const el = document.createElement('div');
    el.className = 'toast show error';
    el.textContent = 'Graphics context lost. Please reload the page.';
    document.body.appendChild(el);
  });

  window.addEventListener('beforeunload', () => controller.dispose());
}

boot();
