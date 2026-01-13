import type { StartGameGenerationInput } from '@/lib/gameGenerationWorker';
import { getDb, jsonParse, jsonStringify } from './db';
import { refundUserCoins } from './userStore';

export type GenerationJobState = 'queued' | 'running' | 'completed' | 'failed' | 'expired';

export type GenerationJobRecord = {
  id: string;
  userId: string;
  input: StartGameGenerationInput;
  status: GenerationJobState;
  progress: number;
  message: string;
  error?: string;
  coinCost: number;
  refundedAt?: string;
  resultSaveId?: number;
  downloadedAt?: string;
  createdAt: string;
  updatedAt: string;
};

const TTL_MS = 10 * 60 * 1000;

let ensuredDownloadedAtColumn = false;
const ensureDownloadedAtColumn = async () => {
  if (ensuredDownloadedAtColumn) return;
  const db = await getDb();
  try {
    await db.query('ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS downloaded_at timestamptz');
  } catch {}
  ensuredDownloadedAtColumn = true;
};

const rowToRecord = (row: any): GenerationJobRecord => ({
  id: String(row.id),
  userId: String(row.user_id),
  input: jsonParse<StartGameGenerationInput>(row.input_json, { plotDescription: '' }),
  status: row.status as GenerationJobState,
  progress: Number(row.progress) || 0,
  message: String(row.message || ''),
  error: row.error ? String(row.error) : undefined,
  coinCost: Number(row.coin_cost) || 0,
  refundedAt: row.refunded_at ? new Date(row.refunded_at).toISOString() : undefined,
  resultSaveId: row.result_save_id ? Number(row.result_save_id) : undefined,
  downloadedAt: row.downloaded_at ? new Date(row.downloaded_at).toISOString() : undefined,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export const createGenerationJobRecord = async (params: {
  id: string;
  userId: string;
  input: StartGameGenerationInput;
  coinCost: number;
  message: string;
}): Promise<GenerationJobRecord> => {
  await ensureDownloadedAtColumn();
  const db = await getDb();
  const now = new Date().toISOString();
  const { rows } = await db.query(
    `
      INSERT INTO generation_jobs (
        id, user_id, input_json, status, progress, message,
        coin_cost, created_at, updated_at
      ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      params.id,
      params.userId,
      jsonStringify(params.input),
      'queued',
      0,
      params.message,
      params.coinCost,
      now,
      now,
    ]
  );
  return rowToRecord(rows[0]);
};

export const updateGenerationJobRecord = async (
  userId: string,
  id: string,
  patch: Partial<Omit<GenerationJobRecord, 'id' | 'userId' | 'input' | 'createdAt'>>
): Promise<GenerationJobRecord | null> => {
  await ensureDownloadedAtColumn();
  const db = await getDb();
  const now = new Date().toISOString();
  const { rows } = await db.query(
    `
      UPDATE generation_jobs
      SET status = COALESCE($3, status),
          progress = COALESCE($4, progress),
          message = COALESCE($5, message),
          error = COALESCE($6, error),
          refunded_at = COALESCE($7, refunded_at),
          result_save_id = COALESCE($8, result_save_id),
          downloaded_at = COALESCE($9, downloaded_at),
          updated_at = $10
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
    [
      id,
      userId,
      patch.status || null,
      typeof patch.progress === 'number' ? patch.progress : null,
      patch.message || null,
      patch.error || null,
      patch.refundedAt ? new Date(patch.refundedAt).toISOString() : null,
      typeof patch.resultSaveId === 'number' ? patch.resultSaveId : null,
      patch.downloadedAt ? new Date(patch.downloadedAt).toISOString() : null,
      now,
    ]
  );
  return rows[0] ? rowToRecord(rows[0]) : null;
};

export const getGenerationJobRecord = async (userId: string, id: string): Promise<GenerationJobRecord | null> => {
  await ensureDownloadedAtColumn();
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM generation_jobs WHERE id = $1 AND user_id = $2', [id, userId]);
  return rows[0] ? rowToRecord(rows[0]) : null;
};

const expireStaleJobs = async (userId: string) => {
  const db = await getDb();
  const cutoff = new Date(Date.now() - TTL_MS).toISOString();
  const { rows } = await db.query(
    `
      SELECT * FROM generation_jobs
      WHERE user_id = $1
        AND status IN ('queued', 'running')
        AND updated_at < $2
    `,
    [userId, cutoff]
  );

  if (!rows.length) return;
  for (const row of rows) {
    const record = rowToRecord(row);
    if (!record.refundedAt && record.coinCost > 0) {
      try {
        await refundUserCoins(userId, record.coinCost);
      } catch {}
    }
    await updateGenerationJobRecord(userId, record.id, {
      status: 'expired',
      progress: 100,
      message: '任务超时',
      error: record.error || '任务超时，请重试',
      refundedAt: record.refundedAt || new Date().toISOString(),
    });
  }
};

export const listGenerationJobs = async (userId: string): Promise<GenerationJobRecord[]> => {
  await ensureDownloadedAtColumn();
  await expireStaleJobs(userId);
  const db = await getDb();
  const { rows } = await db.query(
    `
      SELECT * FROM generation_jobs
      WHERE user_id = $1
        AND status NOT IN ('failed', 'expired')
      ORDER BY created_at DESC
    `,
    [userId]
  );
  return rows.map(rowToRecord);
};

export const markGenerationJobDownloaded = async (userId: string, id: string): Promise<GenerationJobRecord | null> => {
  await ensureDownloadedAtColumn();
  const db = await getDb();
  const now = new Date().toISOString();
  const { rows } = await db.query(
    `
      UPDATE generation_jobs
      SET downloaded_at = COALESCE(downloaded_at, $3),
          updated_at = $3
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
    [id, userId, now]
  );
  return rows[0] ? rowToRecord(rows[0]) : null;
};
