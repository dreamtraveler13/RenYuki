import { NextRequest, NextResponse } from 'next/server';
import { deleteTask, getTask } from '@/lib/taskStore';

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get('task_id');
  if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 });

  const task = getTask(taskId);
  if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 });
  if (task.status !== 'done' || !task.result) {
    return NextResponse.json({ error: 'task not ready', status: task.status }, { status: 400 });
  }

  const buffer = Buffer.from(task.result, 'utf8');

  // Fire-and-forget cleanup after sending.
  deleteTask(taskId);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="galgame-${taskId}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
