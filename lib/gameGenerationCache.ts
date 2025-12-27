import fs from 'fs/promises';
import crypto from 'crypto';
import os from 'os';
import path from 'path';

export type GameGenerationJobState = 'queued' | 'running' | 'completed' | 'failed';

export interface GameGenerationJobRecord<T = unknown> {
  jobId: string;
  userId: string;
  state: GameGenerationJobState;
  progress: number; // 0..100
  message: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  error?: string;
  result?: T;
  debug?: unknown[];
}

const TTL_MS = 10 * 60 * 1000;

const getCacheDir = () => {
  const dir = process.env.GENERATION_CACHE_DIR?.trim();
  if (dir) return dir;
  return path.join(os.tmpdir(), 'renyuki-generation-cache');
};

const getUserDir = (userId: string) => path.join(getCacheDir(), userId);

const getJobFilePath = (userId: string, jobId: string) => path.join(getUserDir(userId), `${jobId}.json`);

const nowIso = () => new Date().toISOString();

const addMsIso = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();

const atomicWriteJson = async (filePath: string, data: unknown) => {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs.rename(tmp, filePath);
  } catch (err: any) {
    const code = err?.code;
    if (code === 'ENOENT') {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data), 'utf8');
      await fs.unlink(tmp).catch(() => {});
      return;
    }
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
};

export const createJob = async <T>(userId: string, jobId: string, message = '任务已创建'): Promise<GameGenerationJobRecord<T>> => {
  const createdAt = nowIso();
  const record: GameGenerationJobRecord<T> = {
    jobId,
    userId,
    state: 'queued',
    progress: 0,
    message,
    createdAt,
    updatedAt: createdAt,
    expiresAt: addMsIso(createdAt, TTL_MS),
  };
  await atomicWriteJson(getJobFilePath(userId, jobId), record);
  return record;
};

export const readJob = async <T>(userId: string, jobId: string): Promise<GameGenerationJobRecord<T> | null> => {
  const filePath = getJobFilePath(userId, jobId);
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const record = JSON.parse(text) as GameGenerationJobRecord<T>;
    const expiresAt = new Date(record.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      await fs.unlink(filePath).catch(() => {});
      return null;
    }
    return record;
  } catch {
    return null;
  }
};

export const updateJob = async <T>(
  userId: string,
  jobId: string,
  patch: Partial<Omit<GameGenerationJobRecord<T>, 'jobId' | 'userId' | 'createdAt'>>
): Promise<GameGenerationJobRecord<T> | null> => {
  const existing = await readJob<T>(userId, jobId);
  if (!existing) return null;
  const updatedAt = nowIso();
  const next: GameGenerationJobRecord<T> = {
    ...existing,
    ...patch,
    updatedAt,
    expiresAt: addMsIso(updatedAt, TTL_MS),
  };
  await atomicWriteJson(getJobFilePath(userId, jobId), next);
  return next;
};

export const deleteJob = async (userId: string, jobId: string) => {
  await fs.unlink(getJobFilePath(userId, jobId)).catch(() => {});
};

export const cleanupExpiredJobsForUser = async (userId: string) => {
  const userDir = getUserDir(userId);
  let entries: Array<{ name: string; isFile: boolean }> = [];
  try {
    const dirents = await fs.readdir(userDir, { withFileTypes: true });
    entries = dirents.map((d) => ({ name: d.name, isFile: d.isFile() }));
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((e) => e.isFile && e.name.endsWith('.json'))
      .map(async (e) => {
        const p = path.join(userDir, e.name);
        try {
          const stat = await fs.stat(p);
          if (Date.now() - stat.mtimeMs > TTL_MS) {
            await fs.unlink(p).catch(() => {});
          }
        } catch {}
      })
  );
};
 
export const cleanupExpiredJobsAllUsers = async () => {
  const baseDir = getCacheDir();
  let dirents: Array<{ name: string; isDir: boolean }> = [];
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    dirents = entries.map((d) => ({ name: d.name, isDir: d.isDirectory() }));
  } catch {
    return;
  }
  await Promise.all(dirents.filter((d) => d.isDir).map((d) => cleanupExpiredJobsForUser(d.name)));
};

let cleanupLoopStarted = false;
const startCleanupLoop = () => {
  if (cleanupLoopStarted) return;
  if (process.env.DISABLE_GENERATION_CACHE_CLEANUP === '1') return;
  cleanupLoopStarted = true;
  const intervalMs = 2 * 60 * 1000;
  const timer = setInterval(() => {
    void cleanupExpiredJobsAllUsers();
  }, intervalMs);
  (timer as any).unref?.();
};

startCleanupLoop();
