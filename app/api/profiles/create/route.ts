import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { createProfile } from '@/lib/profileStore';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const { role, name, images } = payload || {};
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!role || !cleanName || !images) {
    return NextResponse.json({ error: 'role, name, images are required' }, { status: 400 });
  }

  if (role !== 'protagonist' && role !== 'heroine') {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 });
  }

  try {
    const profile = await createProfile({
      userId,
      role,
      name: cleanName,
      images,
    });
    return NextResponse.json({ profile });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'create failed' }, { status: 500 });
  }
}
