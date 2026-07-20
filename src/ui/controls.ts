// Lightweight, dependency-free control factory. Builds labeled inputs bound to
// a settings object by dot-path, with reset-to-default, tooltips and value
// readouts. Kept separate from the render engine.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setPath(obj: any, path: string, value: any): void {
  const parts = path.split('.');
  const last = parts.pop()!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const target = parts.reduce((o: any, k) => o[k], obj);
  target[last] = value;
}

export interface ControlContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaults: any;
  onChange: (path: string, regen: boolean) => void;
}

interface Refresher {
  refresh: () => void;
}

const refreshers: Refresher[] = [];

export function refreshAllControls(): void {
  for (const r of refreshers) r.refresh();
}

export function clearRefreshers(): void {
  refreshers.length = 0;
}

function labelRow(labelText: string, tooltip?: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'ctl';
  const label = document.createElement('label');
  label.textContent = labelText;
  if (tooltip) {
    label.title = tooltip;
    const info = document.createElement('span');
    info.className = 'ctl-info';
    info.textContent = 'ⓘ';
    info.title = tooltip;
    label.appendChild(info);
  }
  row.appendChild(label);
  return row;
}

export interface SliderOpts {
  label: string;
  path: string;
  min: number;
  max: number;
  step: number;
  regen?: boolean;
  tooltip?: string;
  format?: (v: number) => string;
}

export function slider(ctx: ControlContext, o: SliderOpts): HTMLElement {
  const row = labelRow(o.label, o.tooltip);
  const wrap = document.createElement('div');
  wrap.className = 'ctl-input';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(o.min);
  input.max = String(o.max);
  input.step = String(o.step);
  input.setAttribute('aria-label', o.label);
  const val = document.createElement('span');
  val.className = 'ctl-val';
  const reset = document.createElement('button');
  reset.className = 'ctl-reset';
  reset.textContent = '⟲';
  reset.title = 'Reset to default';
  reset.setAttribute('aria-label', `Reset ${o.label}`);

  const fmt = o.format || ((v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)));
  const refresh = () => {
    const v = getPath(ctx.settings, o.path) as number;
    input.value = String(v);
    val.textContent = fmt(v);
  };
  input.addEventListener('input', () => {
    setPath(ctx.settings, o.path, parseFloat(input.value));
    val.textContent = fmt(parseFloat(input.value));
    ctx.onChange(o.path, !!o.regen);
  });
  reset.addEventListener('click', () => {
    const d = getPath(ctx.defaults, o.path) as number;
    setPath(ctx.settings, o.path, d);
    refresh();
    ctx.onChange(o.path, !!o.regen);
  });
  refresh();
  refreshers.push({ refresh });
  wrap.append(input, val, reset);
  row.appendChild(wrap);
  return row;
}

export function toggle(ctx: ControlContext, o: { label: string; path: string; regen?: boolean; tooltip?: string }): HTMLElement {
  const row = labelRow(o.label, o.tooltip);
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'ctl-toggle';
  input.setAttribute('aria-label', o.label);
  const refresh = () => {
    input.checked = !!getPath(ctx.settings, o.path);
  };
  input.addEventListener('change', () => {
    setPath(ctx.settings, o.path, input.checked);
    ctx.onChange(o.path, !!o.regen);
  });
  refresh();
  refreshers.push({ refresh });
  row.appendChild(input);
  return row;
}

export interface SelectOpts {
  label: string;
  path: string;
  options: { value: string; label: string }[];
  regen?: boolean;
  tooltip?: string;
}
export function select(ctx: ControlContext, o: SelectOpts): HTMLElement {
  const row = labelRow(o.label, o.tooltip);
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', o.label);
  for (const opt of o.options) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    sel.appendChild(el);
  }
  const refresh = () => {
    sel.value = String(getPath(ctx.settings, o.path));
  };
  sel.addEventListener('change', () => {
    setPath(ctx.settings, o.path, sel.value);
    ctx.onChange(o.path, !!o.regen);
  });
  refresh();
  refreshers.push({ refresh });
  row.appendChild(sel);
  return row;
}

export function colorInput(ctx: ControlContext, o: { label: string; path: string; regen?: boolean }): HTMLElement {
  const row = labelRow(o.label);
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'ctl-color';
  input.setAttribute('aria-label', o.label);
  const refresh = () => {
    input.value = getPath(ctx.settings, o.path) as string;
  };
  input.addEventListener('input', () => {
    setPath(ctx.settings, o.path, input.value);
    ctx.onChange(o.path, !!o.regen);
  });
  refresh();
  refreshers.push({ refresh });
  row.appendChild(input);
  return row;
}

export function textInput(ctx: ControlContext, o: { label: string; path: string; regen?: boolean; area?: boolean }): HTMLElement {
  const row = labelRow(o.label);
  row.classList.add('ctl-stack');
  const input = o.area ? document.createElement('textarea') : document.createElement('input');
  if (!o.area) (input as HTMLInputElement).type = 'text';
  input.className = 'ctl-text';
  input.setAttribute('aria-label', o.label);
  const refresh = () => {
    input.value = getPath(ctx.settings, o.path) as string;
  };
  input.addEventListener('input', () => {
    setPath(ctx.settings, o.path, input.value);
    ctx.onChange(o.path, !!o.regen);
  });
  refresh();
  refreshers.push({ refresh });
  row.appendChild(input);
  return row;
}

export function buttonRow(buttons: { label: string; onClick: () => void; title?: string }[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ctl-buttons';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    if (b.title) btn.title = b.title;
    btn.addEventListener('click', b.onClick);
    row.appendChild(btn);
  }
  return row;
}

export function group(title: string, open: boolean, children: HTMLElement[]): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'group';
  details.open = open;
  const summary = document.createElement('summary');
  summary.textContent = title;
  details.appendChild(summary);
  const body = document.createElement('div');
  body.className = 'group-body';
  for (const c of children) body.appendChild(c);
  details.appendChild(body);
  return details;
}
