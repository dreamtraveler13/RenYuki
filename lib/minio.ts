import { Client } from 'minio';

type MinioConfig = {
  endPoint: string;
  port?: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
};

let cachedClient: Client | null = null;
let bucketReady: Promise<void> | null = null;

const normalizeEndpoint = (raw: string): { endPoint: string; useSSL?: boolean; port?: number } => {
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    return { endPoint: raw };
  }
  const url = new URL(raw);
  const port = url.port ? Number(url.port) : undefined;
  return { endPoint: url.hostname, useSSL: url.protocol === 'https:', port };
};

const getMinioConfig = (): MinioConfig => {
  const rawEndpoint = process.env.MINIO_ENDPOINT?.trim() || '';
  const accessKey = process.env.MINIO_ACCESS_KEY?.trim() || '';
  const secretKey = process.env.MINIO_SECRET_KEY?.trim() || '';
  const bucket = process.env.MINIO_BUCKET?.trim() || '';

  if (!rawEndpoint || !accessKey || !secretKey || !bucket) {
    throw new Error('MinIO configuration is missing');
  }

  const normalized = normalizeEndpoint(rawEndpoint);
  const envPort = process.env.MINIO_PORT ? Number(process.env.MINIO_PORT) : undefined;
  const useSSL =
    typeof normalized.useSSL === 'boolean'
      ? normalized.useSSL
      : process.env.MINIO_USE_SSL === 'true' || process.env.MINIO_USE_SSL === '1';

  return {
    endPoint: normalized.endPoint,
    port: Number.isFinite(envPort) ? envPort : normalized.port,
    useSSL,
    accessKey,
    secretKey,
    bucket,
    region: process.env.MINIO_REGION?.trim() || undefined,
  };
};

export const getMinioClient = (): Client => {
  if (cachedClient) return cachedClient;
  const config = getMinioConfig();
  cachedClient = new Client({
    endPoint: config.endPoint,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
  });
  return cachedClient;
};

export const getMinioBucket = (): string => getMinioConfig().bucket;

export const ensureMinioBucket = async (): Promise<void> => {
  if (!bucketReady) {
    bucketReady = (async () => {
      const config = getMinioConfig();
      const client = getMinioClient();
      const exists = await client.bucketExists(config.bucket).catch(() => false);
      if (exists) return;
      try {
        await client.makeBucket(config.bucket, config.region);
      } catch (err: any) {
        const code = err?.code || err?.name;
        if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') return;
        throw err;
      }
    })();
  }
  return bucketReady;
};
