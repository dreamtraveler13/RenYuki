import crypto from 'crypto';
import type { PlazaGame, PlazaGameSummary, SaveFile } from '@/types';
import { getDb, jsonStringify } from './db';
import { ensureMinioBucket, getMinioBucket, getMinioClient } from './minio';

const MINIO_PREFIX = 'minio:';

const buildPlazaSaveKey = (id: string) => `plaza-saves/${id}.json`;

const normalizeMinioKey = (savePath: string) =>
  savePath.startsWith(MINIO_PREFIX) ? savePath.slice(MINIO_PREFIX.length) : savePath;

const isMinioPath = (savePath: string) => savePath.startsWith(MINIO_PREFIX);

const streamToString = async (stream: NodeJS.ReadableStream): Promise<string> =>
  await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });

const writePlazaSaveFile = async (id: string, save: SaveFile): Promise<string> => {
  await ensureMinioBucket();
  const client = getMinioClient();
  const bucket = getMinioBucket();
  const key = buildPlazaSaveKey(id);
  const body = Buffer.from(JSON.stringify(save), 'utf8');
  await client.putObject(bucket, key, body, body.length, { 'Content-Type': 'application/json' });
  return `${MINIO_PREFIX}${key}`;
};

const readPlazaSaveFile = async (savePath: string): Promise<SaveFile> => {
  if (!isMinioPath(savePath)) {
    throw new Error('Legacy plaza save is not supported');
  }
  await ensureMinioBucket();
  const client = getMinioClient();
  const bucket = getMinioBucket();
  const key = normalizeMinioKey(savePath);
  const stream = await client.getObject(bucket, key);
  const raw = await streamToString(stream);
  return JSON.parse(raw) as SaveFile;
};

const deletePlazaSaveFile = async (savePath: string) => {
  if (!isMinioPath(savePath)) return;
  await ensureMinioBucket();
  const client = getMinioClient();
  const bucket = getMinioBucket();
  const key = normalizeMinioKey(savePath);
  await client.removeObject(bucket, key);
};

const toSummaryFromSave = (params: {
  id: string;
  createdAt: string;
  plays: number;
  reportCount?: number;
  save: SaveFile;
}): PlazaGameSummary => {
  const coverBase64 = params.save.memoryCoverBase64 || params.save.assets?.heroine?.normal || '';
  return {
    id: params.id,
    title: params.save.title || 'Untitled Story',
    date: params.save.date || new Date(params.createdAt).toLocaleString('zh-CN'),
    heroineName: params.save.heroineName || 'Unknown',
    affinity: typeof params.save.affinity === 'number' ? params.save.affinity : 0,
    coverBase64,
    plays: params.plays || 0,
    reportCount: params.reportCount || 0,
  };
};

const rowToSummary = (row: any): PlazaGameSummary => ({
  id: String(row.id),
  title: String(row.title || 'Untitled Story'),
  date: String(row.date || new Date(row.created_at).toLocaleString('zh-CN')),
  heroineName: String(row.heroine_name || 'Unknown'),
  affinity: typeof row.affinity === 'number' ? row.affinity : Number(row.affinity) || 0,
  coverBase64: String(row.cover_base64 || ''),
  plays: typeof row.plays === 'number' ? row.plays : Number(row.plays) || 0,
  reportCount: typeof row.report_count === 'number' ? row.report_count : Number(row.report_count) || 0,
});

export const listPlazaGames = async (): Promise<PlazaGameSummary[]> => {
  const db = await getDb();
  const { rows } = await db.query(
    `
      SELECT id, title, date, heroine_name, affinity, cover_base64, plays, report_count, created_at
      FROM plaza_games
      WHERE save_path LIKE 'minio:%'
      ORDER BY created_at DESC
    `
  );
  return rows.map(rowToSummary);
};

export const listPlazaGamesByUser = async (userId: string): Promise<PlazaGameSummary[]> => {
  const db = await getDb();
  const { rows } = await db.query(
    `
      SELECT id, title, date, heroine_name, affinity, cover_base64, plays, report_count, created_at
      FROM plaza_games
      WHERE uploader_user_id = $1
        AND save_path LIKE 'minio:%'
      ORDER BY created_at DESC
    `,
    [userId]
  );
  return rows.map(rowToSummary);
};

export const getPlazaGame = async (id: string): Promise<PlazaGame | null> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM plaza_games WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const savePath = typeof rows[0].save_path === 'string' ? rows[0].save_path : '';
  if (!savePath.trim() || !isMinioPath(savePath.trim())) return null;
  try {
    const save = await readPlazaSaveFile(savePath.trim());
    return { ...rowToSummary(rows[0]), save };
  } catch (err) {
    console.error('read plaza save file failed', err);
    return null;
  }
};

export const getPlazaGameOwnerId = async (id: string): Promise<string | null> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT uploader_user_id FROM plaza_games WHERE id = $1', [id]);
  if (!rows[0]?.uploader_user_id) return null;
  return String(rows[0].uploader_user_id);
};

export const publishPlazaGame = async (userId: string, save: SaveFile): Promise<PlazaGameSummary> => {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const summary = toSummaryFromSave({ id, createdAt, plays: 0, reportCount: 0, save });
  const db = await getDb();
  const savePath = await writePlazaSaveFile(id, save);

  try {
    await db.query(
      `
        INSERT INTO plaza_games (
          id, created_at, uploader_user_id, title, date, heroine_name,
          affinity, cover_base64, plays, report_count, save_path, save_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      `,
      [
        id,
        createdAt,
        userId,
        summary.title,
        summary.date,
        summary.heroineName,
        summary.affinity,
        summary.coverBase64,
        summary.plays,
        summary.reportCount || 0,
        savePath,
        jsonStringify({}), // keep compatibility with existing NOT NULL schema
      ]
    );
  } catch (err) {
    try {
      await deletePlazaSaveFile(savePath);
    } catch {}
    throw err;
  }

  return summary;
};

export const incrementPlazaPlay = async (id: string) => {
  const db = await getDb();
  await db.query('UPDATE plaza_games SET plays = plays + 1 WHERE id = $1', [id]);
};

export const deletePlazaGame = async (id: string) => {
  const db = await getDb();
  try {
    const { rows } = await db.query('SELECT save_path FROM plaza_games WHERE id = $1', [id]);
    const savePath = typeof rows?.[0]?.save_path === 'string' ? rows[0].save_path.trim() : '';
    if (savePath) {
      await deletePlazaSaveFile(savePath);
    }
  } catch (err) {
    console.warn('delete plaza save file failed', err);
  }
  await db.query('DELETE FROM plaza_games WHERE id = $1', [id]);
};
