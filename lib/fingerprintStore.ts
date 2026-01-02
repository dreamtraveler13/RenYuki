import crypto from 'crypto';
import { getDb } from './db';
import { getUserById, type PublicUser } from './userStore';

const getFingerprintSecret = () =>
  process.env.AUTH_SECRET || process.env.JIEKOU_API_KEY || process.env.API_KEY || 'dev-insecure-secret';

const hashFingerprint = (fingerprint: string) =>
  crypto.createHmac('sha256', getFingerprintSecret()).update(fingerprint).digest('hex');

export const getUserByFingerprint = async (fingerprint: string): Promise<PublicUser | null> => {
  const trimmed = fingerprint.trim();
  if (!trimmed) return null;
  const hash = hashFingerprint(trimmed);
  const db = await getDb();
  const { rows } = await db.query('SELECT user_id FROM device_fingerprints WHERE fingerprint_hash = $1 LIMIT 1', [hash]);
  if (!rows[0]) return null;
  return await getUserById(String(rows[0].user_id));
};

export const recordFingerprint = async (params: {
  userId: string;
  fingerprint: string;
  ip?: string;
  ua?: string;
}): Promise<{ inserted: boolean }> => {
  const trimmed = params.fingerprint.trim();
  if (!trimmed) return { inserted: false };
  const hash = hashFingerprint(trimmed);
  const db = await getDb();
  const now = new Date().toISOString();
  const { rows } = await db.query(
    `
      INSERT INTO device_fingerprints (
        id, user_id, fingerprint_hash, ip, user_agent, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (fingerprint_hash) DO NOTHING
      RETURNING id
    `,
    [crypto.randomUUID(), params.userId, hash, params.ip || null, params.ua || null, now]
  );
  return { inserted: !!rows[0] };
};
