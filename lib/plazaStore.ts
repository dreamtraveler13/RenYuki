import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { PlazaGame, PlazaGameSummary, SaveFile } from '@/types';
import { getDb, jsonParse, jsonStringify } from './db';

const getPlazaStorageDir = () => {
  const dir = process.env.PLAZA_STORAGE_DIR || process.env.ZEABUR_VOLUME_PATH || '';
  return dir && dir.trim().length > 0 ? dir.trim() : path.join(process.cwd(), 'plaza_storage');
};

const writePlazaSaveFile = async (id: string, save: SaveFile): Promise<string> => {
  const dir = getPlazaStorageDir();
  await fs.mkdir(dir, { recursive: true });
  const filename = `${id}.json`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, JSON.stringify(save), 'utf8');
  return filename; // store relative filename in DB
};

const readPlazaSaveFile = async (savePath: string): Promise<SaveFile> => {
  const dir = getPlazaStorageDir();
  const filePath = path.isAbsolute(savePath) ? savePath : path.join(dir, savePath);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as SaveFile;
};

const deletePlazaSaveFile = async (savePath: string) => {
  const dir = getPlazaStorageDir();
  const filePath = path.isAbsolute(savePath) ? savePath : path.join(dir, savePath);
  await fs.unlink(filePath);
};

const defaultSave: SaveFile = {
  id: 0,
  title: 'Untitled Story',
  date: new Date().toLocaleString('zh-CN'),
  heroineName: 'Unknown',
  affinity: 0,
  currentNodeId: '',
  script: { title: 'Untitled Story', heroineName: 'Unknown', startNodeId: '', nodes: {} },
  assets: {
    heroine: { normal: '', happy: '', surprised: '', angry: '', shy: '' },
    protagonist: { normal: '', happy: '', surprised: '', angry: '', shy: '' },
    backgrounds: {},
    music: {},
    voice: {},
  },
  userProfile: { name: '', avatarBase64: '' },
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
      ORDER BY created_at DESC
    `
  );
  return rows.map(rowToSummary);
};

export const getPlazaGame = async (id: string): Promise<PlazaGame | null> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM plaza_games WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const savePath = typeof rows[0].save_path === 'string' ? rows[0].save_path : '';
  let save: SaveFile;
  if (savePath.trim().length > 0) {
    try {
      save = await readPlazaSaveFile(savePath.trim());
    } catch (err) {
      console.error('read plaza save file failed', err);
      save = jsonParse<SaveFile>(rows[0].save_json, defaultSave);
    }
  } else {
    save = jsonParse<SaveFile>(rows[0].save_json, defaultSave);
  }
  return { ...rowToSummary(rows[0]), save };
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
