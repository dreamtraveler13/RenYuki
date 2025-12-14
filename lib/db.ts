import fs from 'fs/promises';
import path from 'path';

export type DbSchema = {
  users: Record<string, any>;
  usernameToId: Record<string, string>;
  orders: Record<string, any>;
  plaza: Record<string, any>;
};

const defaultDb = (): DbSchema => ({
  users: {},
  usernameToId: {},
  orders: {},
  plaza: {},
});

const getDataDir = () => process.env.RENYUKI_DATA_DIR || path.join(process.cwd(), 'data');
const getDbPath = () => path.join(getDataDir(), 'db.json');

export const readDb = async (): Promise<DbSchema> => {
  const dbPath = getDbPath();
  try {
    const raw = await fs.readFile(dbPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultDb();
    return {
      users: (parsed as any).users && typeof (parsed as any).users === 'object' ? (parsed as any).users : {},
      usernameToId:
        (parsed as any).usernameToId && typeof (parsed as any).usernameToId === 'object' ? (parsed as any).usernameToId : {},
      orders: (parsed as any).orders && typeof (parsed as any).orders === 'object' ? (parsed as any).orders : {},
      plaza: (parsed as any).plaza && typeof (parsed as any).plaza === 'object' ? (parsed as any).plaza : {},
    };
  } catch (err: any) {
    if (err?.code === 'ENOENT') return defaultDb();
    throw err;
  }
};

const writeDb = async (db: DbSchema) => {
  const dataDir = getDataDir();
  const dbPath = getDbPath();
  await fs.mkdir(dataDir, { recursive: true });
  const tmpPath = `${dbPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tmpPath, dbPath);
};

let writeChain: Promise<void> = Promise.resolve();

export const updateDb = async <T,>(fn: (db: DbSchema) => Promise<T> | T): Promise<T> => {
  const task = writeChain
    .catch(() => undefined)
    .then(async () => {
      const db = await readDb();
      const result = await fn(db);
      await writeDb(db);
      return result;
    });
  writeChain = task.then(
    () => undefined,
    () => undefined
  );
  return task;
};
