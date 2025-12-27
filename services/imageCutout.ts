'use client';

export const removeBackground = async (base64Data: string): Promise<string> => {
  return await new Promise((resolve) => {
    const img = new Image();
    const trimmed = typeof base64Data === 'string' ? base64Data.trim() : '';
    const src = trimmed.startsWith('data:')
      ? trimmed
      : trimmed.startsWith('/9j')
        ? `data:image/jpeg;base64,${trimmed}`
        : `data:image/png;base64,${trimmed}`;
    img.src = src;
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

      const START_THRESHOLD = 240;
      const FILL_THRESHOLD = 240;
      const getBrightness = (idx: number) => (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      const isBackgroundCandidate = (idx: number) => {
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        return r > FILL_THRESHOLD && g > FILL_THRESHOLD && b > FILL_THRESHOLD;
      };

      const corners = [0, width - 1, (height - 1) * width, width * height - 1];
      for (const idx of corners) {
        if (getBrightness(idx * 4) > START_THRESHOLD) {
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
            if (isBackgroundCandidate(pixelIdx)) {
              visited[nIdx] = 1;
              stack.push(nIdx);
            } else {
              visited[nIdx] = 2;
            }
          }
        }
      }

      for (let i = 0; i < width * height; i++) {
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

export const stripAssetBase64Map = async <T extends Record<string, any>>(assetsObj: T): Promise<T> => {
  const entries = Object.entries(assetsObj).filter(([, v]) => typeof v === 'string' && v.trim().length > 0) as Array<
    [string, string]
  >;
  const unique = Array.from(new Set(entries.map(([, v]) => v)));
  const cleanedPairs = await Promise.all(unique.map(async (img) => [img, await removeBackground(img)] as const));
  const map = new Map(cleanedPairs);
  const out: Record<string, any> = { ...assetsObj };
  entries.forEach(([k, v]) => {
    out[k] = map.get(v) || v;
  });
  return out as T;
};
