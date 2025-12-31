import type { GeneratedAssets, GameScript, SaveFile, UserProfile } from '@/types';
import { getDb, jsonParse, jsonStringify } from './db';

const TTL_MS = 10 * 60 * 1000;

const pruneExpiredSaves = async (userId: string) => {
  const db = await getDb();
  const cutoff = new Date(Date.now() - TTL_MS).toISOString();
  await db.query('DELETE FROM saves WHERE user_id = $1 AND created_at < $2', [userId, cutoff]);
};

const rowToSave = (row: any): SaveFile => ({
  id: Number(row.id),
  title: String(row.title || 'Untitled Story'),
  date: String(row.date),
  heroineName: String(row.heroine_name || 'Unknown'),
  affinity: typeof row.affinity === 'number' ? row.affinity : Number(row.affinity) || 0,
  currentNodeId: String(row.current_node_id),
  script: jsonParse<GameScript>(row.script_json, { title: 'Untitled Story', heroineName: 'Unknown', startNodeId: '', nodes: {} }),
  assets: jsonParse<GeneratedAssets>(row.assets_json, { heroine: { normal: '', happy: '', surprised: '', angry: '', shy: '' }, protagonist: { normal: '', happy: '', surprised: '', angry: '', shy: '' }, backgrounds: {}, music: {}, voice: {} }),
  userProfile: jsonParse<UserProfile>(row.user_profile_json, { name: '', avatarBase64: '' }),
  memoryCoverBase64: row.memory_cover_base64 || undefined,
});

export const listSaves = async (userId: string): Promise<SaveFile[]> => {
  await pruneExpiredSaves(userId);
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM saves WHERE user_id = $1 ORDER BY id DESC', [userId]);
  return rows.map(rowToSave);
};

export const createSave = async (params: {
  userId: string;
  script: GameScript;
  assets: GeneratedAssets;
  userProfile: UserProfile;
  currentNodeId: string;
  affinity: number;
  memoryCoverBase64?: string;
}): Promise<SaveFile> => {
  await pruneExpiredSaves(params.userId);
  const db = await getDb();
  const now = new Date();
  const id = now.getTime();
  const date = now.toLocaleString('zh-CN');
  const save: SaveFile = {
    id,
    title: params.script.title || 'Untitled Story',
    date,
    heroineName: params.script.heroineName || 'Unknown',
    affinity: params.affinity,
    currentNodeId: params.currentNodeId,
    script: params.script,
    assets: params.assets,
    userProfile: params.userProfile,
    memoryCoverBase64: params.memoryCoverBase64,
  };

  await db.query(
    `
      INSERT INTO saves (
        id, user_id, title, date, heroine_name, affinity, current_node_id,
        script_json, assets_json, user_profile_json, memory_cover_base64, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)
    `,
    [
      save.id,
      params.userId,
      save.title,
      save.date,
      save.heroineName,
      save.affinity,
      save.currentNodeId,
      jsonStringify(save.script),
      jsonStringify(save.assets),
      jsonStringify(save.userProfile),
      save.memoryCoverBase64 || null,
      now.toISOString(),
    ]
  );

  return save;
};

export const restoreSave = async (userId: string, saveData: SaveFile): Promise<SaveFile> => {
  await pruneExpiredSaves(userId);
  const db = await getDb();
  const now = new Date();
  const newSave: SaveFile = {
    ...saveData,
    id: now.getTime(),
    date: now.toLocaleString('zh-CN'),
  };

  await db.query(
    `
      INSERT INTO saves (
        id, user_id, title, date, heroine_name, affinity, current_node_id,
        script_json, assets_json, user_profile_json, memory_cover_base64, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)
    `,
    [
      newSave.id,
      userId,
      newSave.title,
      newSave.date,
      newSave.heroineName,
      newSave.affinity,
      newSave.currentNodeId,
      jsonStringify(newSave.script),
      jsonStringify(newSave.assets),
      jsonStringify(newSave.userProfile),
      newSave.memoryCoverBase64 || null,
      now.toISOString(),
    ]
  );

  return newSave;
};

export const updateSaveAssets = async (
  userId: string,
  id: number,
  assets: GeneratedAssets,
  memoryCoverBase64?: string
): Promise<SaveFile | null> => {
  await pruneExpiredSaves(userId);
  const db = await getDb();
  const { rows } = await db.query(
    `
      UPDATE saves
      SET assets_json = $3::jsonb,
          memory_cover_base64 = $4
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
    [id, userId, jsonStringify(assets), memoryCoverBase64 || null]
  );
  return rows[0] ? rowToSave(rows[0]) : null;
};

export const deleteSave = async (userId: string, id: number) => {
  const db = await getDb();
  await db.query('DELETE FROM saves WHERE user_id = $1 AND id = $2', [userId, id]);
};
