import { Pool } from 'pg';

const getDatabaseUrl = () => {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is missing. Set it in your server environment.');
  return url;
};

const shouldUseSsl = (url: string) => {
  const sslMode = process.env.PGSSLMODE || '';
  if (sslMode && /require|verify/i.test(sslMode)) return true;
  if (process.env.PG_SSL === '1' || process.env.POSTGRES_SSL === '1') return true;
  return /sslmode=require/i.test(url);
};

const createPool = () => {
  const connectionString = getDatabaseUrl();
  const useSsl = shouldUseSsl(connectionString);
  const max = Number(process.env.PG_POOL_MAX || 5);
  return new Pool({
    connectionString,
    max: Number.isFinite(max) ? max : 5,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
};

const globalForPg = globalThis as typeof globalThis & { __renyukiPgPool?: Pool };

export const getDb = async (): Promise<Pool> => {
  if (!globalForPg.__renyukiPgPool) {
    globalForPg.__renyukiPgPool = createPool();
  }
  return globalForPg.__renyukiPgPool;
};

export const jsonParse = <T,>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

export const jsonStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
};
