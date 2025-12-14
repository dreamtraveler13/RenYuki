import { NextRequest, NextResponse } from 'next/server';
import { getTask } from '@/lib/taskStore';
import { getUserIdFromRequest } from '@/lib/authSession';

export async function GET(req: NextRequest) {
  if (!getUserIdFromRequest(req)) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const taskId = req.nextUrl.searchParams.get('task_id');
  if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 });

  const task = getTask(taskId);
  if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 });

  return NextResponse.json({ status: task.status, error: task.error || null });
}
