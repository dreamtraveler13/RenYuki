import { createCanvas, loadImage } from 'canvas';

const MAX_CUTOUT_CONCURRENCY = 2;

const normalizeBase64ToDataUrl = (base64Data: string) => {
  const trimmed = typeof base64Data === 'string' ? base64Data.trim() : '';
  if (!trimmed) return '';
  if (trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('/9j')) return `data:image/jpeg;base64,${trimmed}`;
  return `data:image/png;base64,${trimmed}`;
};

const removeWhiteBackground = async (base64Data: string): Promise<string> => {
  const dataUrl = normalizeBase64ToDataUrl(base64Data);
  if (!dataUrl) return base64Data;

  try {
    const img = await loadImage(dataUrl);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;

    const visited = new Uint8Array(width * height);
    const stack: number[] = [];

    const START_THRESHOLD = 235;
    const FILL_THRESHOLD = 230;
    const SAT_THRESHOLD = 18;
    const COLOR_DISTANCE_THRESHOLD = 28;
    const EDGE_THRESHOLD = 45;

    const getBrightness = (idx: number) => (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    const getSaturation = (idx: number) => {
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      return max - min;
    };
    const colorDistance = (idx: number, bg: { r: number; g: number; b: number }) =>
      Math.abs(data[idx] - bg.r) + Math.abs(data[idx + 1] - bg.g) + Math.abs(data[idx + 2] - bg.b);

    const getPixelIdx = (x: number, y: number) => (y * width + x) * 4;

    const sampleCornerColor = (x: number, y: number) => {
      const radius = Math.max(1, Math.round(Math.min(width, height) * 0.01));
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let dy = 0; dy <= radius; dy += 1) {
        for (let dx = 0; dx <= radius; dx += 1) {
          const sx = Math.min(width - 1, Math.max(0, x + dx));
          const sy = Math.min(height - 1, Math.max(0, y + dy));
          const idx = getPixelIdx(sx, sy);
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          count += 1;
        }
      }
      return { r: r / count, g: g / count, b: b / count };
    };

    const corners = [
      sampleCornerColor(0, 0),
      sampleCornerColor(width - 1, 0),
      sampleCornerColor(0, height - 1),
      sampleCornerColor(width - 1, height - 1),
    ];

    const brightCorners = corners.filter((c) => (c.r + c.g + c.b) / 3 > START_THRESHOLD);
    const bgSamples = brightCorners.length > 0 ? brightCorners : corners;
    const background = bgSamples.reduce(
      (acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }),
      { r: 0, g: 0, b: 0 }
    );
    background.r /= bgSamples.length;
    background.g /= bgSamples.length;
    background.b /= bgSamples.length;

    const isEdgeStrong = (x: number, y: number, idx: number) => {
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      let maxDiff = 0;
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = getPixelIdx(nx, ny);
        const diff = Math.abs(r - data[nIdx]) + Math.abs(g - data[nIdx + 1]) + Math.abs(b - data[nIdx + 2]);
        if (diff > maxDiff) maxDiff = diff;
      }
      return maxDiff > EDGE_THRESHOLD;
    };

    const isBackgroundCandidate = (idx: number, x: number, y: number) => {
      const brightness = getBrightness(idx);
      if (brightness < FILL_THRESHOLD) return false;
      if (getSaturation(idx) > SAT_THRESHOLD) return false;
      if (colorDistance(idx, background) > COLOR_DISTANCE_THRESHOLD) return false;
      if (isEdgeStrong(x, y, idx)) return false;
      return true;
    };

    const cornerPoints = [
      { x: 0, y: 0 },
      { x: width - 1, y: 0 },
      { x: 0, y: height - 1 },
      { x: width - 1, y: height - 1 },
    ];
    for (const c of cornerPoints) {
      const idx = c.y * width + c.x;
      const pixelIdx = idx * 4;
      if (getBrightness(pixelIdx) > START_THRESHOLD && getSaturation(pixelIdx) <= SAT_THRESHOLD) {
        stack.push(idx);
        visited[idx] = 1;
      }
    }

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = Math.floor(idx / width);
      const neighbors: number[] = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < width - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - width);
      if (y < height - 1) neighbors.push(idx + width);

      for (const nIdx of neighbors) {
        if (visited[nIdx] === 0) {
          const pixelIdx = nIdx * 4;
          if (isBackgroundCandidate(pixelIdx, nIdx % width, Math.floor(nIdx / width))) {
            visited[nIdx] = 1;
            stack.push(nIdx);
          } else {
            visited[nIdx] = 2;
          }
        }
      }
    }

    for (let i = 0; i < width * height; i += 1) {
      if (visited[i] === 1) {
        const pixelIdx = i * 4;
        data[pixelIdx + 3] = 0;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1] || base64Data;
  } catch {
    return base64Data;
  }
};

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const current = nextIndex;
      if (current >= items.length) break;
      nextIndex += 1;
      results[current] = await task(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
};

export const stripAssetBase64MapServer = async <T extends Record<string, any>>(assetsObj: T): Promise<T> => {
  const entries = Object.entries(assetsObj || {}).filter(([, v]) => typeof v === 'string' && v.trim().length > 0) as Array<
    [string, string]
  >;
  if (entries.length === 0) return assetsObj;

  const unique = Array.from(new Set(entries.map(([, v]) => v)));
  const cleanedPairs = await runWithConcurrency(unique, MAX_CUTOUT_CONCURRENCY, async (img) => {
    const cleaned = await removeWhiteBackground(img);
    return [img, cleaned] as const;
  });
  const map = new Map(cleanedPairs);
  const out: Record<string, any> = { ...assetsObj };
  entries.forEach(([k, v]) => {
    out[k] = map.get(v) || v;
  });
  return out as T;
};
