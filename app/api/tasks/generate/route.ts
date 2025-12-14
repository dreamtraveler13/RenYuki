import { NextRequest, NextResponse } from 'next/server';
import { generateScript } from '@/lib/aiServer';
import { enforceDailyGenerationLimit } from '@/lib/dailyLimit';
import { createTask, updateTask } from '@/lib/taskStore';

export async function POST(req: NextRequest) {
  const limit = enforceDailyGenerationLimit(req);
  if (limit.blocked) return limit.response;

  const payload = await req.json().catch(() => ({} as Record<string, any>));

  const protagonistName = (payload.protagonistName as string) || 'Player';
  const heroineName = (payload.heroineName as string) || 'Yuki';
  const plotDescription = payload.plotDescription as string | undefined;

  const taskId = createTask('running');

  try {
    const script = await generateScript(protagonistName, heroineName, plotDescription);
    const jsonString = JSON.stringify({ generatedAt: new Date().toISOString(), script }, null, 2);
    updateTask(taskId, { status: 'done', result: jsonString });

    const res = NextResponse.json({ task_id: taskId, status: 'done' }, { status: 200 });
    if (limit.cookieToSet && limit.cookieName) {
      res.cookies.set(limit.cookieName, limit.cookieToSet, { path: '/', maxAge: 60 * 60 * 24 * 30, httpOnly: true });
    }
    return res;
  } catch (error: any) {
    updateTask(taskId, { status: 'error', error: error?.message || 'generation failed' });
    return NextResponse.json(
      { task_id: taskId, status: 'error', error: error?.message || 'generation failed' },
      { status: 500 }
    );
  }
}
