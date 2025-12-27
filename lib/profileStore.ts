import crypto from 'crypto';
import type { CharacterImages, CharacterProfile, CharacterRole, PlazaRole, PlazaRoleSummary } from '@/types';
import { getDb, jsonParse, jsonStringify } from './db';

const normalizeImages = (images: CharacterImages): CharacterImages => {
  const normal = images.normal;
  return {
    normal,
    happy: images.happy || normal,
    surprised: images.surprised || normal,
    angry: images.angry || normal,
    shy: images.shy || images.happy || normal,
    sad: images.sad || images.shy || images.happy || normal,
  };
};

const rowToProfile = (row: any): CharacterProfile => ({
  id: String(row.id),
  role: row.role as CharacterRole,
  name: String(row.name),
  images: normalizeImages(jsonParse<CharacterImages>(row.images_json, { normal: '', happy: '', surprised: '', angry: '', shy: '' })),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const rowToPlazaRoleSummary = (row: any): PlazaRoleSummary => ({
  id: String(row.id),
  role: row.role as CharacterRole,
  name: String(row.name),
  coverBase64: String(row.cover_base64 || ''),
  createdAt: String(row.created_at),
});

export const listProfiles = async (userId: string): Promise<CharacterProfile[]> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM profiles WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return rows.map(rowToProfile);
};

export const getProfileById = async (userId: string, id: string): Promise<CharacterProfile | null> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM profiles WHERE user_id = $1 AND id = $2', [userId, id]);
  return rows[0] ? rowToProfile(rows[0]) : null;
};

export const createProfile = async (params: {
  userId: string;
  role: CharacterRole;
  name: string;
  images: CharacterImages;
}): Promise<CharacterProfile> => {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const images = normalizeImages(params.images);
  await db.query(
    `
      INSERT INTO profiles (
        id, user_id, role, name, images_json, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
    `,
    [id, params.userId, params.role, params.name, jsonStringify(images), now, now]
  );
  return { id, role: params.role, name: params.name, images, createdAt: now, updatedAt: now };
};

export const deleteProfile = async (userId: string, id: string) => {
  const db = await getDb();
  await db.query('DELETE FROM profiles WHERE user_id = $1 AND id = $2', [userId, id]);
};

export const publishProfileToPlaza = async (userId: string, profileId: string): Promise<PlazaRoleSummary> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM profiles WHERE user_id = $1 AND id = $2', [userId, profileId]);
  if (!rows[0]) throw new Error('PROFILE_NOT_FOUND');
  const profile = rowToProfile(rows[0]);
  const plazaId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const coverBase64 = profile.images.normal || '';
  await db.query(
    `
      INSERT INTO plaza_roles (
        id, created_at, uploader_user_id, role, name, images_json, cover_base64
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
    `,
    [plazaId, createdAt, userId, profile.role, profile.name, jsonStringify(profile.images), coverBase64]
  );
  return { id: plazaId, role: profile.role, name: profile.name, coverBase64, createdAt };
};

export const listPlazaRoles = async (): Promise<PlazaRoleSummary[]> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT id, created_at, role, name, cover_base64 FROM plaza_roles ORDER BY created_at DESC');
  return rows.map(rowToPlazaRoleSummary);
};

export const getPlazaRole = async (id: string): Promise<PlazaRole | null> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM plaza_roles WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const images = normalizeImages(jsonParse<CharacterImages>(rows[0].images_json, { normal: '', happy: '', surprised: '', angry: '', shy: '' }));
  return {
    id: String(rows[0].id),
    role: rows[0].role as CharacterRole,
    name: String(rows[0].name),
    coverBase64: String(rows[0].cover_base64 || ''),
    createdAt: String(rows[0].created_at),
    images,
  };
};

export const importPlazaRoleToProfile = async (userId: string, plazaRoleId: string): Promise<CharacterProfile> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM plaza_roles WHERE id = $1', [plazaRoleId]);
  if (!rows[0]) throw new Error('ROLE_NOT_FOUND');
  const images = normalizeImages(jsonParse<CharacterImages>(rows[0].images_json, { normal: '', happy: '', surprised: '', angry: '', shy: '' }));
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.query(
    `
      INSERT INTO profiles (
        id, user_id, role, name, images_json, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [id, userId, rows[0].role, rows[0].name, jsonStringify(images), now, now]
  );
  return {
    id,
    role: rows[0].role as CharacterRole,
    name: String(rows[0].name),
    images,
    createdAt: now,
    updatedAt: now,
  };
};
