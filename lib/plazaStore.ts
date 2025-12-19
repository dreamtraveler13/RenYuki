import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { PlazaGame, PlazaGameSummary, SaveFile } from '@/types';

type PlazaRecord = {
  id: string;
  createdAt: string;
  uploaderUserId: string;
  plays: number;
  save: SaveFile;
};

const getDataDir = () => process.env.RENYUKI_DATA_DIR || path.join(process.cwd(), 'data');
const getPlazaDir = () => path.join(getDataDir(), 'plaza');
const getPlazaPath = (id: string) => path.join(getPlazaDir(), `${id}.json`);

const ensurePlazaDir = async () => {
  await fs.mkdir(getPlazaDir(), { recursive: true });
};

const toSummary = (r: PlazaRecord): PlazaGameSummary => {
  const coverBase64 = r.save.memoryCoverBase64 || r.save.assets?.heroine?.normal || '';
  return {
    id: r.id,
    title: r.save.title || 'Untitled Story',
    date: r.save.date || new Date(r.createdAt).toLocaleString('zh-CN'),
    heroineName: r.save.heroineName || 'Unknown',
    affinity: typeof r.save.affinity === 'number' ? r.save.affinity : 0,
    coverBase64,
    plays: r.plays || 0,
  };
};

const readPlazaRecord = async (id: string): Promise<PlazaRecord | null> => {
  try {
    const raw = await fs.readFile(getPlazaPath(id), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof (parsed as any).id !== 'string') return null;
    return parsed as PlazaRecord;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
};

const writePlazaRecord = async (rec: PlazaRecord) => {
  await ensurePlazaDir();
  const filePath = getPlazaPath(rec.id);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(rec, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
};

let writeChain: Promise<void> = Promise.resolve();

const withWriteLock = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const task = writeChain
    .catch(() => undefined)
    .then(async () => await fn());
  writeChain = task.then(
    () => undefined,
    () => undefined
  );
  return task;
};

export const listPlazaGames = async (): Promise<PlazaGameSummary[]> => {
  await ensurePlazaDir();
  const dir = getPlazaDir();
  const files = await fs.readdir(dir).catch(() => []);
  const ids = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((id) => id.length > 0);

  const records = await Promise.all(
    ids.map(async (id) => {
      try {
        return await readPlazaRecord(id);
      } catch {
        return null;
      }
    })
  );

  return records
    .filter((x): x is PlazaRecord => !!x)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(toSummary);
};

export const getPlazaGame = async (id: string): Promise<PlazaGame | null> => {
  const rec = await readPlazaRecord(id);
  if (!rec) return null;
  return { ...toSummary(rec), save: rec.save };
};

export const publishPlazaGame = async (userId: string, save: SaveFile): Promise<PlazaGameSummary> => {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const rec: PlazaRecord = {
    id,
    createdAt,
    uploaderUserId: userId,
    plays: 0,
    save,
  };
  await withWriteLock(async () => await writePlazaRecord(rec));
  return toSummary(rec);
};

export const incrementPlazaPlay = async (id: string) => {
  await withWriteLock(async () => {
    const rec = await readPlazaRecord(id);
    if (!rec) return;
    rec.plays = (rec.plays || 0) + 1;
    await writePlazaRecord(rec);
  });
};

export const deletePlazaGame = async (id: string) => {
  await withWriteLock(async () => {
    await ensurePlazaDir();
    try {
      await fs.unlink(getPlazaPath(id));
    } catch (err: any) {
      if (err?.code === 'ENOENT') return;
      throw err;
    }
  });
};
