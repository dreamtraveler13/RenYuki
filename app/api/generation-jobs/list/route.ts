import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { listGenerationJobs } from '@/lib/generationJobStore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const jobs = await listGenerationJobs(userId);
  const summaries = jobs.map((job) => ({
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    refundedAt: job.refundedAt,
    coinCost: job.coinCost,
    resultSaveId: job.resultSaveId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }));
  return NextResponse.json(
    { jobs: summaries },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
