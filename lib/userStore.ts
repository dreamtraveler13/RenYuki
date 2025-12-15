import crypto from 'crypto';
import { promisify } from 'util';
import { readDb, updateDb } from './db';

type UserRecord = {
  id: string;
  username: string;
  displayName: string;
  passwordSalt: string;
  passwordHash: string;
  coins: number;
  policyStrikes?: number;
  bannedAt?: string;
  banReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  coins: number;
  bannedAt?: string;
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
  bannedAt: u.bannedAt,
  createdAt: u.createdAt,
});

export const getUserById = async (userId: string): Promise<PublicUser | null> => {
  const db = await readDb();
  const u = db.users[userId] as UserRecord | undefined;
  return u ? toPublicUser(u) : null;
};

export const getUserRecordById = async (userId: string): Promise<UserRecord | null> => {
  const db = await readDb();
  const u = db.users[userId] as UserRecord | undefined;
  return u || null;
};

const getUserRecordByUsername = async (username: string): Promise<UserRecord | null> => {
  const u = normalizeUsername(username);
  const db = await readDb();
  const userId = db.usernameToId[u];
  if (!userId) return null;
  return (db.users[userId] as UserRecord | undefined) || null;
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

  return await updateDb(async (db) => {
    if (db.usernameToId[username]) throw new Error('USERNAME_TAKEN');

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const { salt, hash } = await createPasswordHash(password);

    const user: UserRecord = {
      id,
      username,
      displayName: displayName || username,
      passwordSalt: salt,
      passwordHash: hash,
      coins: 1,
      createdAt: now,
      updatedAt: now,
    };

    db.users[id] = user;
    db.usernameToId[username] = id;

    return toPublicUser(user);
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

export const isUserBanned = async (userId: string): Promise<boolean> => {
  const u = await getUserRecordById(userId);
  return !!u?.bannedAt;
};

export const recordPoliticalSensitiveStrike = async (
  userId: string,
  matched: string
): Promise<{ strikes: number; banned: boolean; bannedAt?: string }> => {
  return await updateDb((db) => {
    const user = db.users[userId] as UserRecord | undefined;
    if (!user) throw new Error('USER_NOT_FOUND');

    if (user.bannedAt) {
      return { strikes: user.policyStrikes || 0, banned: true, bannedAt: user.bannedAt };
    }

    const strikes = (user.policyStrikes || 0) + 1;
    user.policyStrikes = strikes;
    user.updatedAt = new Date().toISOString();

    const banned = strikes >= 3;
    if (banned) {
      user.bannedAt = new Date().toISOString();
      user.banReason = `CN_POLITICAL_SENSITIVE:${matched}`;
    }

    db.users[userId] = user;
    return { strikes, banned, bannedAt: user.bannedAt };
  });
};

export const consumeUserCoins = async (userId: string, cost: number): Promise<number> => {
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('INVALID_COST');
  const intCost = Math.floor(cost);

  return await updateDb((db) => {
    const user = db.users[userId] as UserRecord | undefined;
    if (!user) throw new Error('USER_NOT_FOUND');
    if (user.bannedAt) throw new Error('USER_BANNED');
    if (user.coins < intCost) throw new Error('INSUFFICIENT_COINS');
    user.coins -= intCost;
    user.updatedAt = new Date().toISOString();
    db.users[userId] = user;
    return user.coins;
  });
};

export const refundUserCoins = async (userId: string, amount: number): Promise<number> => {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  const delta = Math.floor(amount);

  return await updateDb((db) => {
    const user = db.users[userId] as UserRecord | undefined;
    if (!user) throw new Error('USER_NOT_FOUND');
    user.coins += delta;
    user.updatedAt = new Date().toISOString();
    db.users[userId] = user;
    return user.coins;
  });
};

export const getUserCoins = async (userId: string): Promise<number> => {
  const u = await getUserRecordById(userId);
  return u ? u.coins : 0;
};
