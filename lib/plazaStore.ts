import crypto from 'crypto';
import { readDb, updateDb } from './db';
import type { PlazaGame, PlazaGameSummary, SaveFile } from '@/types';

type PlazaRecord = {
  id: string;
  createdAt: string;
  uploaderUserId: string;
  plays: number;
  save: SaveFile;
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

export const listPlazaGames = async (): Promise<PlazaGameSummary[]> => {
  const db = await readDb();
  const items = Object.values(db.plaza || {}) as PlazaRecord[];
  return items
    .filter((x) => x && typeof x === 'object' && typeof (x as any).id === 'string')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(toSummary);
};

export const getPlazaGame = async (id: string): Promise<PlazaGame | null> => {
  const db = await readDb();
  const rec = (db.plaza || {})[id] as PlazaRecord | undefined;
  if (!rec) return null;
  return { ...toSummary(rec), save: rec.save };
};

export const publishPlazaGame = async (userId: string, save: SaveFile): Promise<PlazaGameSummary> => {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  return await updateDb((db) => {
    const rec: PlazaRecord = {
      id,
      createdAt,
      uploaderUserId: userId,
      plays: 0,
      save,
    };
    db.plaza[id] = rec;
    return toSummary(rec);
  });
};

export const incrementPlazaPlay = async (id: string) => {
  await updateDb((db) => {
    const rec = (db.plaza || {})[id] as PlazaRecord | undefined;
    if (!rec) return;
    rec.plays = (rec.plays || 0) + 1;
    db.plaza[id] = rec;
  });
};

