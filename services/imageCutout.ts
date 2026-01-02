'use client';

const MODNET_MODEL_URL = '/models/modnet.onnx';
const MODNET_INPUT_SIZE = 512;
const MAX_CUTOUT_CONCURRENCY = 2;

type OrtModule = typeof import('onnxruntime-web');

let ortModulePromise: Promise<OrtModule> | null = null;
let modnetModelBufferPromise: Promise<ArrayBuffer> | null = null;
let modnetSessionPromise: Promise<import('onnxruntime-web').InferenceSession> | null = null;
const resultCache = new Map<string, string>();

const loadOrt = async () => {
  if (!ortModulePromise) {
    ortModulePromise = import(/* webpackIgnore: true */ '/ort/ort.webgpu.bundle.min.mjs').then(
      (mod) => ((mod as any).default ?? mod) as OrtModule
    );
  }
  return ortModulePromise;
};

const loadModelBuffer = async () => {
  if (!modnetModelBufferPromise) {
    modnetModelBufferPromise = fetch(MODNET_MODEL_URL, { cache: 'force-cache' }).then(async (resp) => {
      if (!resp.ok) throw new Error(`MODNet model load failed: ${resp.status}`);
      return await resp.arrayBuffer();
    });
  }
  return modnetModelBufferPromise;
};

const getGraphOptimizationLevel = (ort: OrtModule) => {
  const level = (ort as any).GraphOptimizationLevel;
  if (!level) return 'all';
  return level.all ?? level.ORT_ENABLE_ALL ?? 'all';
};

const ensureModnetSession = async () => {
  if (modnetSessionPromise) return modnetSessionPromise;
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    throw new Error('WebGPU is not supported in this browser.');
  }
  modnetSessionPromise = (async () => {
    const ort = await loadOrt();
    if ((ort as any).env?.wasm) {
      (ort as any).env.wasm.wasmPaths = '/ort/';
      (ort as any).env.wasm.numThreads = 1;
      (ort as any).env.wasm.simd = true;
    }
    const modelBuffer = await loadModelBuffer();
    return await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: getGraphOptimizationLevel(ort),
    });
  })();
  return modnetSessionPromise;
};

export const warmUpBackgroundRemoval = async () => {
  try {
    await ensureModnetSession();
  } catch {
    // ignore; fallback will handle
  }
};

const normalizeBase64ToDataUrl = (base64Data: string) => {
  const trimmed = typeof base64Data === 'string' ? base64Data.trim() : '';
  if (trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('/9j')) return `data:image/jpeg;base64,${trimmed}`;
  return `data:image/png;base64,${trimmed}`;
};

const base64ToBlob = (base64Data: string) => {
  const dataUrl = normalizeBase64ToDataUrl(base64Data);
  const [prefix, data] = dataUrl.split(',');
  const mimeMatch = /data:(.*?);base64/.exec(prefix || '');
  const mime = mimeMatch?.[1] || 'image/png';
  const binStr = atob(data || '');
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
};

const createCanvas = (width: number, height: number) => {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const canvasToBase64Png = async (canvas: OffscreenCanvas | HTMLCanvasElement): Promise<string> => {
  if ('convertToBlob' in canvas) {
    const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  const dataUrl = (canvas as HTMLCanvasElement).toDataURL('image/png');
  return dataUrl.split(',')[1] || '';
};

const runModnet = async (base64Data: string): Promise<string> => {
  const session = await ensureModnetSession();
  const ort = await loadOrt();

  const blob = base64ToBlob(base64Data);
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;

  const inputCanvas = createCanvas(MODNET_INPUT_SIZE, MODNET_INPUT_SIZE);
  const inputCtx = inputCanvas.getContext('2d');
  if (!inputCtx) throw new Error('Canvas context not available');
  inputCtx.imageSmoothingEnabled = true;
  inputCtx.drawImage(bitmap, 0, 0, MODNET_INPUT_SIZE, MODNET_INPUT_SIZE);
  const imageData = inputCtx.getImageData(0, 0, MODNET_INPUT_SIZE, MODNET_INPUT_SIZE);
  const { data } = imageData;

  const input = new Float32Array(1 * 3 * MODNET_INPUT_SIZE * MODNET_INPUT_SIZE);
  let offset = 0;
  for (let y = 0; y < MODNET_INPUT_SIZE; y += 1) {
    for (let x = 0; x < MODNET_INPUT_SIZE; x += 1) {
      const idx = (y * MODNET_INPUT_SIZE + x) * 4;
      input[offset] = data[idx] / 255;
      input[offset + MODNET_INPUT_SIZE * MODNET_INPUT_SIZE] = data[idx + 1] / 255;
      input[offset + 2 * MODNET_INPUT_SIZE * MODNET_INPUT_SIZE] = data[idx + 2] / 255;
      offset += 1;
    }
  }

  const inputName = session.inputNames[0];
  const tensor = new ort.Tensor('float32', input, [1, 3, MODNET_INPUT_SIZE, MODNET_INPUT_SIZE]);
  const outputs = await session.run({ [inputName]: tensor });
  const outputName = session.outputNames[0];
  const matte = outputs[outputName]?.data as Float32Array;
  if (!matte) throw new Error('MODNet output missing');

  const maskCanvas = createCanvas(MODNET_INPUT_SIZE, MODNET_INPUT_SIZE);
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) throw new Error('Canvas context not available');
  const maskImage = maskCtx.createImageData(MODNET_INPUT_SIZE, MODNET_INPUT_SIZE);
  const maskData = maskImage.data;
  for (let i = 0; i < matte.length; i += 1) {
    const alpha = Math.max(0, Math.min(1, matte[i])) * 255;
    const di = i * 4;
    maskData[di] = 255;
    maskData[di + 1] = 255;
    maskData[di + 2] = 255;
    maskData[di + 3] = alpha;
  }
  maskCtx.putImageData(maskImage, 0, 0);

  const outputCanvas = createCanvas(width, height);
  const outputCtx = outputCanvas.getContext('2d');
  if (!outputCtx) throw new Error('Canvas context not available');
  outputCtx.drawImage(bitmap, 0, 0, width, height);
  outputCtx.globalCompositeOperation = 'destination-in';
  outputCtx.drawImage(maskCanvas as any, 0, 0, width, height);

  return await canvasToBase64Png(outputCanvas);
};

const legacyRemoveBackground = async (base64Data: string): Promise<string> => {
  return await new Promise((resolve) => {
    const img = new Image();
    img.src = normalizeBase64ToDataUrl(base64Data);
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64Data);
        return;
      }
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
      const newBase64 = canvas.toDataURL('image/png').split(',')[1];
      resolve(newBase64);
    };
    img.onerror = () => resolve(base64Data);
  });
};

export const removeBackground = async (base64Data: string): Promise<string> => {
  const cached = resultCache.get(base64Data);
  if (cached) return cached;
  try {
    const result = await runModnet(base64Data);
    resultCache.set(base64Data, result);
    return result;
  } catch (err) {
    console.warn('MODNet background removal failed, fallback to legacy', err);
    const fallback = await legacyRemoveBackground(base64Data);
    resultCache.set(base64Data, fallback);
    return fallback;
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

export const stripAssetBase64Map = async <T extends Record<string, any>>(
  assetsObj: T,
  onProgress?: (done: number, total: number) => void
): Promise<T> => {
  const entries = Object.entries(assetsObj).filter(([, v]) => typeof v === 'string' && v.trim().length > 0) as Array<
    [string, string]
  >;
  const unique = Array.from(new Set(entries.map(([, v]) => v)));
  const total = unique.length;
  let done = 0;
  await warmUpBackgroundRemoval();
  const cleanedPairs = await runWithConcurrency(unique, MAX_CUTOUT_CONCURRENCY, async (img) => {
    const cleaned = await removeBackground(img);
    done += 1;
    onProgress?.(done, total);
    return [img, cleaned] as const;
  });
  const map = new Map(cleanedPairs);
  const out: Record<string, any> = { ...assetsObj };
  entries.forEach(([k, v]) => {
    out[k] = map.get(v) || v;
  });
  return out as T;
};
