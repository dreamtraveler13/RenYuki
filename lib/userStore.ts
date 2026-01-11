import crypto from 'crypto';
import { promisify } from 'util';
import { getDb } from './db';

type UserRecord = {
  id: string;
  username: string;
  displayName: string;
  passwordSalt: string;
  passwordHash: string;
  coins: number;
  firstPurchaseAt?: string;
  policyStrikes?: number;
  bannedAt?: string;
  banReason?: string;
  policyAcceptedAt?: string;
  policyVersion?: number;
  policyAcceptedIp?: string;
  policyAcceptedUa?: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  coins: number;
  firstPurchaseAt?: string;
  bannedAt?: string;
  policyAcceptedAt?: string;
  policyVersion?: number;
  createdAt: string;
};

const normalizeUsername = (raw: string) => raw.trim().toLowerCase();

const scryptAsync = promisify(crypto.scrypt);

const hashPassword = async (password: string, salt: string) => {
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return derived.toString('hex');
};

const createPasswordHash = async (password: string) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);
  return { salt, hash };
};

const verifyPassword = async (password: string, salt: string, expectedHash: string) => {
  const hash = await hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const toPublicUser = (u: UserRecord): PublicUser => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  coins: u.coins,
  firstPurchaseAt: u.firstPurchaseAt,
  bannedAt: u.bannedAt,
  policyAcceptedAt: u.policyAcceptedAt,
  policyVersion: u.policyVersion,
  createdAt: u.createdAt,
});

const rowToUserRecord = (row: any): UserRecord => ({
  id: String(row.id),
  username: String(row.username),
  displayName: String(row.display_name),
  passwordSalt: String(row.password_salt),
  passwordHash: String(row.password_hash),
  coins: Number(row.coins) || 0,
  firstPurchaseAt: row.first_purchase_at ? new Date(row.first_purchase_at).toISOString() : undefined,
  policyStrikes: row.policy_strikes === null || row.policy_strikes === undefined ? undefined : Number(row.policy_strikes),
  bannedAt: row.banned_at ? String(row.banned_at) : undefined,
  banReason: row.ban_reason ? String(row.ban_reason) : undefined,
  policyAcceptedAt: row.policy_accepted_at ? String(row.policy_accepted_at) : undefined,
  policyVersion: row.policy_version === null || row.policy_version === undefined ? undefined : Number(row.policy_version),
  policyAcceptedIp: row.policy_accepted_ip ? String(row.policy_accepted_ip) : undefined,
  policyAcceptedUa: row.policy_accepted_ua ? String(row.policy_accepted_ua) : undefined,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export const getUserById = async (userId: string): Promise<PublicUser | null> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return null;
  return toPublicUser(rowToUserRecord(rows[0]));
};

export const getUserRecordById = async (userId: string): Promise<UserRecord | null> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  return rows[0] ? rowToUserRecord(rows[0]) : null;
};

const getUserRecordByUsername = async (username: string): Promise<UserRecord | null> => {
  const u = normalizeUsername(username);
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [u]);
  return rows[0] ? rowToUserRecord(rows[0]) : null;
};

export const createUser = async (params: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<PublicUser> => {
  const username = normalizeUsername(params.username);
  const displayName = typeof params.displayName === 'string' ? params.displayName.trim() : '';
  const password = params.password;

  if (!username) throw new Error('USERNAME_REQUIRED');
  if (!password) throw new Error('PASSWORD_REQUIRED');
  if (password.length < 6) throw new Error('PASSWORD_TOO_SHORT');

  const db = await getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const { salt, hash } = await createPasswordHash(password);
  try {
    await db.query(
      `
        INSERT INTO users (
          id, username, display_name, password_salt, password_hash,
          coins, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [id, username, displayName || username, salt, hash, 1, now, now]
    );
  } catch (err: any) {
    if (err?.code === '23505') throw new Error('USERNAME_TAKEN');
    throw err;
  }

  return toPublicUser({
    id,
    username,
    displayName: displayName || username,
    passwordSalt: salt,
    passwordHash: hash,
    coins: 1,
    firstPurchaseAt: undefined,
    createdAt: now,
    updatedAt: now,
  });
};

export const authenticateUser = async (params: {
  username: string;
  password: string;
}): Promise<PublicUser | null> => {
  const username = normalizeUsername(params.username);
  const password = params.password;
  if (!username || !password) return null;

  const record = await getUserRecordByUsername(username);
  if (!record) return null;
  if (record.bannedAt) throw new Error('USER_BANNED');
  const ok = await verifyPassword(password, record.passwordSalt, record.passwordHash);
  if (!ok) return null;
  return toPublicUser(record);
};

export const recordPoliticalSensitiveStrike = async (
  userId: string,
  matched: string
): Promise<{ strikes: number; banned: boolean; bannedAt?: string }> => {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT policy_strikes, banned_at FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!rows[0]) throw new Error('USER_NOT_FOUND');

    if (rows[0].banned_at) {
      await client.query('COMMIT');
      return { strikes: Number(rows[0].policy_strikes) || 0, banned: true, bannedAt: String(rows[0].banned_at) };
    }

    const strikes = (Number(rows[0].policy_strikes) || 0) + 1;
    const banned = strikes >= 3;
    const now = new Date().toISOString();
    const bannedAt = banned ? now : null;
    const banReason = banned ? `CN_POLITICAL_SENSITIVE:${matched}` : null;

    await client.query(
      `
        UPDATE users
        SET policy_strikes = $2,
            banned_at = $3,
            ban_reason = $4,
            updated_at = $5
        WHERE id = $1
      `,
      [userId, strikes, bannedAt, banReason, now]
    );

    await client.query('COMMIT');
    return { strikes, banned, bannedAt: bannedAt ? String(bannedAt) : undefined };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const getUserPolicyAcceptance = async (
  userId: string
): Promise<{ acceptedAt?: string; version?: number; bannedAt?: string } | null> => {
  const db = await getDb();
  const { rows } = await db.query(
    'SELECT policy_accepted_at, policy_version, banned_at FROM users WHERE id = $1',
    [userId]
  );
  if (!rows[0]) return null;
  return {
    acceptedAt: rows[0].policy_accepted_at ? String(rows[0].policy_accepted_at) : undefined,
    version: rows[0].policy_version === null || rows[0].policy_version === undefined ? undefined : Number(rows[0].policy_version),
    bannedAt: rows[0].banned_at ? String(rows[0].banned_at) : undefined,
  };
};

export const acceptUserPolicy = async (params: {
  userId: string;
  version: number;
  ip?: string;
  ua?: string;
}): Promise<{ acceptedAt: string; version: number }> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT banned_at FROM users WHERE id = $1', [params.userId]);
  if (!rows[0]) throw new Error('USER_NOT_FOUND');
  if (rows[0].banned_at) throw new Error('USER_BANNED');

  const now = new Date().toISOString();
  await db.query(
    `
      UPDATE users
      SET policy_accepted_at = $2,
          policy_version = $3,
          policy_accepted_ip = $4,
          policy_accepted_ua = $5,
          updated_at = $6
      WHERE id = $1
    `,
    [params.userId, now, params.version, params.ip || null, params.ua || null, now]
  );

  return { acceptedAt: now, version: params.version };
};

export const consumeUserCoins = async (userId: string, cost: number): Promise<number> => {
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('INVALID_COST');
  const intCost = Math.floor(cost);
  const db = await getDb();
  const now = new Date().toISOString();
  const { rows } = await db.query(
    `
      UPDATE users
      SET coins = coins - $2,
          updated_at = $3
      WHERE id = $1 AND banned_at IS NULL AND coins >= $2
      RETURNING coins
    `,
    [userId, intCost, now]
  );
  if (rows[0]) return Number(rows[0].coins) || 0;

  const check = await db.query('SELECT coins, banned_at FROM users WHERE id = $1', [userId]);
  if (!check.rows[0]) throw new Error('USER_NOT_FOUND');
  if (check.rows[0].banned_at) throw new Error('USER_BANNED');
  if ((Number(check.rows[0].coins) || 0) < intCost) throw new Error('INSUFFICIENT_COINS');
  throw new Error('CONSUME_FAILED');
};

export const refundUserCoins = async (userId: string, amount: number): Promise<number> => {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  const delta = Math.floor(amount);
  const db = await getDb();
  const now = new Date().toISOString();
  const { rows } = await db.query(
    `
      UPDATE users
      SET coins = coins + $2,
          updated_at = $3
      WHERE id = $1
      RETURNING coins
    `,
    [userId, delta, now]
  );
  if (!rows[0]) throw new Error('USER_NOT_FOUND');
  return Number(rows[0].coins) || 0;
};

export const getUserCoins = async (userId: string): Promise<number> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT coins FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return 0;
  return Number(rows[0].coins) || 0;
};

export const deleteUserById = async (userId: string): Promise<void> => {
  const db = await getDb();
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
};

export const isUserBanned = async (userId: string): Promise<boolean> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT banned_at FROM users WHERE id = $1', [userId]);
  return !!rows[0]?.banned_at;
};
