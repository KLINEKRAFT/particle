import type { AppSettings } from '../types';
import type { CameraState } from './CameraController';

// ============================================================================
// MultiScreenManager — cross-window synchronisation over BroadcastChannel plus
// Window Management API detection & launch. Secondary windows regenerate the
// same deterministic scene locally (seed-synced) and apply a camera viewOffset
// so the particle structure appears continuous across displays.
// ============================================================================

const CHANNEL = 'particle-studio-sync';

export interface CamMessage {
  t: 'cam';
  camera: CameraState;
  elapsed: number;
  paused: boolean;
}
export interface SettingsMessage {
  t: 'settings';
  settings: AppSettings;
  sourceToken: number;
}
export interface HelloMessage {
  t: 'hello';
}
export interface ByeMessage {
  t: 'bye';
}
export type SyncMessage = CamMessage | SettingsMessage | HelloMessage | ByeMessage;

export interface SecondaryConfig {
  fullW: number;
  fullH: number;
  offX: number;
  offY: number;
  w: number;
  h: number;
  mirror: boolean;
  spanIndex: number; // -1 when not in manual-span mode
  spanCount: number; // 0 when not in manual-span mode
}

export interface MultiScreenCapabilities {
  windowManagement: boolean;
  isExtended: boolean;
  popupLikely: boolean;
}

export class MultiScreenManager {
  private channel: BroadcastChannel;
  private openedWindows: Window[] = [];
  onMessage: ((msg: SyncMessage) => void) | null = null;

  constructor() {
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (ev: MessageEvent<SyncMessage>) => {
      this.onMessage?.(ev.data);
    };
  }

  post(msg: SyncMessage): void {
    this.channel.postMessage(msg);
  }

  static detect(): MultiScreenCapabilities {
    const w = window as Window & { getScreenDetails?: unknown; screen: Screen & { isExtended?: boolean } };
    return {
      windowManagement: typeof w.getScreenDetails === 'function',
      isExtended: !!w.screen.isExtended,
      popupLikely: true,
    };
  }

  /** Parse secondary-window configuration from the URL. */
  static parseSecondary(): SecondaryConfig | null {
    const p = new URLSearchParams(location.search);
    if (p.get('display') !== 'secondary') return null;
    const num = (k: string, d: number) => {
      const v = parseFloat(p.get(k) || '');
      return Number.isFinite(v) ? v : d;
    };
    const mirror = p.get('mirror') === '1';
    return {
      fullW: num('fw', window.innerWidth),
      fullH: num('fh', window.innerHeight),
      offX: num('ox', 0),
      offY: num('oy', 0),
      w: num('w', window.innerWidth),
      h: num('h', window.innerHeight),
      mirror,
      spanIndex: p.has('seg') ? num('seg', 0) : -1,
      spanCount: num('segs', 0),
    };
  }

  /**
   * Open a synchronized window that renders one horizontal slice of a wider
   * continuous scene (manual span). Works in any browser — the user drags it to
   * the target monitor and full-screens it. Slice size is derived from each
   * window's own dimensions, so identical monitors line up seamlessly.
   */
  openSpanWindow(index: number, count: number): Window | null {
    const params = new URLSearchParams({ display: 'secondary', seg: String(index), segs: String(count) });
    const url = `${location.origin}${location.pathname}?${params.toString()}`;
    const win = window.open(url, `ps_span_${index}_${count}`, 'width=1280,height=720');
    if (win) this.openedWindows.push(win);
    return win;
  }

  isSecondary(): boolean {
    return new URLSearchParams(location.search).get('display') === 'secondary';
  }

  /**
   * Launch synchronized windows across all extended displays using the Window
   * Management API. Returns the number of windows opened, or throws on failure
   * (permission denial / popup blocked) so the caller can show a fallback.
   */
  async launchAcrossScreens(): Promise<number> {
    const w = window as Window & { getScreenDetails?: () => Promise<ScreenDetailsLike> };
    if (typeof w.getScreenDetails !== 'function') {
      throw new Error('Window Management API not supported');
    }
    const details = await w.getScreenDetails();
    const screens = details.screens;
    if (!screens || screens.length === 0) throw new Error('No screens reported');

    // Combined virtual bounds across all screens.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of screens) {
      minX = Math.min(minX, s.left);
      minY = Math.min(minY, s.top);
      maxX = Math.max(maxX, s.left + s.width);
      maxY = Math.max(maxY, s.top + s.height);
    }
    const fullW = maxX - minX;
    const fullH = maxY - minY;

    let opened = 0;
    for (const s of screens) {
      const params = new URLSearchParams({
        display: 'secondary',
        fw: String(fullW),
        fh: String(fullH),
        ox: String(s.left - minX),
        oy: String(s.top - minY),
        w: String(s.width),
        h: String(s.height),
      });
      const url = `${location.origin}${location.pathname}?${params.toString()}`;
      const features = `left=${s.left},top=${s.top},width=${s.width},height=${s.height}`;
      const win = window.open(url, `ps_display_${s.left}_${s.top}`, features);
      if (win) {
        this.openedWindows.push(win);
        opened++;
      }
    }
    if (opened === 0) throw new Error('Popup windows were blocked');
    return opened;
  }

  /** Fallback: open a single synchronized mirror window (user drags to monitor). */
  openMirrorWindow(): Window | null {
    const params = new URLSearchParams({ display: 'secondary', mirror: '1' });
    const url = `${location.origin}${location.pathname}?${params.toString()}`;
    const win = window.open(url, 'ps_mirror', 'width=1280,height=720');
    if (win) this.openedWindows.push(win);
    return win;
  }

  sessionLink(): string {
    const params = new URLSearchParams({ display: 'secondary', mirror: '1' });
    return `${location.origin}${location.pathname}?${params.toString()}`;
  }

  closeAll(): void {
    for (const win of this.openedWindows) {
      try {
        win.close();
      } catch {
        /* ignore */
      }
    }
    this.openedWindows = [];
  }

  dispose(): void {
    this.post({ t: 'bye' });
    this.closeAll();
    this.channel.close();
  }
}

// Minimal shape of the Window Management API surface we use.
interface ScreenLike {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface ScreenDetailsLike {
  screens: ScreenLike[];
}
