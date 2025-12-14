import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';

const isAllowedRemoteImageUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    // Seedream images are typically hosted on Volcengine TOS; keep a tight allowlist to avoid SSRF.
    if (host === 'ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com') return true;
    if (host.endsWith('.tos-cn-beijing.volces.com')) return true;
    return false;
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fetchWithRetry = async (url: string, tries = 3) => {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 90_000).unref?.();
      try {
        const resp = await fetch(url, { cache: 'no-store', signal: ac.signal });
        if (!resp.ok) throw new Error(`Image download failed: ${resp.status}`);
        return resp;
      } finally {
        clearTimeout(timer as any);
      }
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retriable = /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|undici/i.test(msg);
      if (!retriable || attempt === tries) throw err;
      await sleep(400 * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
};

export async function POST(req: NextRequest) {
  if (!getUserIdFromRequest(req)) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const url = typeof payload.url === 'string' ? payload.url.trim() : '';
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });
  if (!isAllowedRemoteImageUrl(url)) return NextResponse.json({ error: 'url not allowed' }, { status: 400 });

  try {
    const upstream = await fetchWithRetry(url, 3);
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('download-image failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to download image' }, { status: 500 });
  }
}
