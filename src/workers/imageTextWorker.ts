/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from '../types';
import { generateShape } from '../generators/ShapeGenerator';
import { sampleImage } from '../generators/ImageSampler';
import { sampleText } from '../generators/TextSampler';

// ============================================================================
// Generation worker. Keeps all heavy target generation (shape / image / text)
// off the main thread. Results are posted back as transferable typed arrays so
// there is no copy. Each request carries a jobId; the main thread ignores stale
// responses (cancellation of outdated jobs).
// ============================================================================

const loadedFonts = new Set<string>();

async function ensureFont(name: string | null | undefined, dataUrl: string | null | undefined): Promise<string> {
  if (!name || !dataUrl) return 'Inter, Arial, sans-serif';
  if (loadedFonts.has(name)) return `"${name}", sans-serif`;
  try {
    // FontFace is available in worker scope where supported.
    const face = new FontFace(name, `url(${dataUrl})`);
    await face.load();
    (self as unknown as { fonts: FontFaceSet }).fonts.add(face);
    loadedFonts.add(name);
    return `"${name}", sans-serif`;
  } catch {
    return 'Inter, Arial, sans-serif';
  }
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const res: WorkerResponse = { jobId: req.jobId, ok: false };
  try {
    if (req.kind === 'shape' && req.shape) {
      const t = generateShape(req.shape, req.count, req.seed);
      res.ok = true;
      res.positions = t.positions;
      res.colors = t.colors;
      res.count = t.count;
      res.hasColor = t.hasColor;
      res.bounds = t.bounds;
    } else if (req.kind === 'image' && req.imageBitmap && req.image) {
      const t = sampleImage(req.imageBitmap, req.image, req.count, req.seed, req.depthMap ?? null);
      res.ok = true;
      res.positions = t.positions;
      res.colors = t.colors;
      res.count = t.count;
      res.hasColor = t.hasColor;
      res.bounds = t.bounds;
      req.imageBitmap.close();
      req.depthMap?.close();
    } else if (req.kind === 'text' && req.text) {
      let family = req.text.fontFamily;
      if (req.fontName && req.fontDataUrl) {
        family = await ensureFont(req.fontName, req.fontDataUrl);
      }
      const t = sampleText(req.text, req.count, req.seed, family);
      res.ok = true;
      res.positions = t.positions;
      res.colors = t.colors;
      res.count = t.count;
      res.hasColor = t.hasColor;
      res.bounds = t.bounds;
    } else {
      res.error = 'Invalid request';
    }
  } catch (err) {
    res.ok = false;
    res.error = err instanceof Error ? err.message : String(err);
  }

  const transfer: Transferable[] = [];
  if (res.positions) transfer.push(res.positions.buffer);
  if (res.colors) transfer.push(res.colors.buffer);
  (self as unknown as Worker).postMessage(res, transfer);
};
