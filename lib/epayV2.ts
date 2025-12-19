import crypto from 'crypto';

export type EpayPayType = 'alipay' | 'wxpay';

export type EpayCreateResponse = {
  code?: number;
  msg?: string;
  trade_no?: string;
  pay_type?: string;
  pay_info?: string;
  timestamp?: string;
  sign?: string;
  sign_type?: string;
};

export type EpayQueryResponse = {
  code?: number;
  msg?: string;
  trade_no?: string;
  out_trade_no?: string;
  api_trade_no?: string;
  type?: string;
  status?: number;
  money?: string;
  addtime?: string;
  endtime?: string;
  timestamp?: string;
  sign?: string;
  sign_type?: string;
};

const normalizePemKey = (raw: string, kind: 'private' | 'public') => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('BEGIN') && trimmed.includes('KEY')) return trimmed;

  const b64 = trimmed.replace(/\s+/g, '');
  const lines = b64.match(/.{1,64}/g)?.join('\n') || b64;
  const header = kind === 'private' ? '-----BEGIN PRIVATE KEY-----' : '-----BEGIN PUBLIC KEY-----';
  const footer = kind === 'private' ? '-----END PRIVATE KEY-----' : '-----END PUBLIC KEY-----';
  return `${header}\n${lines}\n${footer}\n`;
};

export const getEpayV2Config = () => {
  const baseUrl = (process.env.EPAY_BASE_URL || 'https://pays.org.cn').replace(/\/+$/, '');
  const pid = (process.env.EPAY_PID || process.env.ZPAY_PID || '').trim();
  const privateKeyRaw = (
    process.env.EPAY_MCH_PRIVATE_KEY ||
    process.env.EPAY_PRIVATE_KEY ||
    process.env.EPAY_RSA_PRIVATE_KEY ||
    ''
  ).trim();
  const publicKeyRaw = (
    process.env.EPAY_PLATFORM_PUBLIC_KEY ||
    process.env.EPAY_PUBLIC_KEY ||
    process.env.EPAY_RSA_PUBLIC_KEY ||
    ''
  ).trim();

  if (!pid) throw new Error('EPAY_PID_MISSING');
  if (!privateKeyRaw) throw new Error('EPAY_PRIVATE_KEY_MISSING');
  if (!publicKeyRaw) throw new Error('EPAY_PUBLIC_KEY_MISSING');

  const privateKey = normalizePemKey(privateKeyRaw, 'private');
  const publicKey = normalizePemKey(publicKeyRaw, 'public');

  return { baseUrl, pid, privateKey, publicKey };
};

export const buildEpaySignString = (params: Record<string, string>) => {
  const parts = Object.entries(params)
    .filter(([k, v]) => {
      if (k === 'sign' || k === 'sign_type') return false;
      if (v == null) return false;
      const str = String(v);
      return str.length > 0;
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`);
  return parts.join('&');
};

export const signEpayParams = (params: Record<string, string>, privateKeyPem: string) => {
  const base = buildEpaySignString(params);
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(base, 'utf8');
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
};

const normalizeIncomingSignature = (raw: string) => {
  const s = (raw || '').trim();
  if (!s) return '';
  try {
    // Handles both URL encoded and plain base64 signatures.
    return decodeURIComponent(s.replace(/\s+/g, '+'));
  } catch {
    return s.replace(/\s+/g, '+');
  }
};

export const verifyEpaySignature = (params: Record<string, string>, publicKeyPem: string) => {
  const sign = normalizeIncomingSignature(params.sign || '');
  if (!sign) return false;
  const base = buildEpaySignString(params);
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(base, 'utf8');
  verifier.end();
  try {
    return verifier.verify(publicKeyPem, sign, 'base64');
  } catch {
    return false;
  }
};

const shouldRequireResponseSignature = () => {
  const raw = (process.env.EPAY_REQUIRE_RESPONSE_SIGN || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
};

const toStringRecord = (obj: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!obj || typeof obj !== 'object') return out;
  Object.entries(obj as Record<string, unknown>).forEach(([k, v]) => {
    if (v == null) return;
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') out[k] = String(v);
  });
  return out;
};

const verifyEpayResponseOrThrow = (respObj: unknown, publicKeyPem: string) => {
  const record = toStringRecord(respObj);
  const hasSign = typeof record.sign === 'string' && record.sign.trim().length > 0;
  if (!hasSign && !shouldRequireResponseSignature()) return;
  if (!hasSign) throw new Error('EPAY response missing signature');
  if (!verifyEpaySignature(record, publicKeyPem)) throw new Error('EPAY response signature invalid');
};

const toFormBody = (params: Record<string, string>) => {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v == null) return;
    const str = String(v);
    if (!str) return;
    sp.set(k, str);
  });
  return sp.toString();
};

export const epayCreateOrder = async (params: {
  pid: string;
  method: 'jump' | 'web';
  device?: 'pc' | 'mobile' | 'wechat' | 'alipay' | 'qq';
  type: EpayPayType;
  out_trade_no: string;
  notify_url: string;
  return_url: string;
  name: string;
  money: string;
  clientip: string;
  param?: string;
}): Promise<EpayCreateResponse> => {
  const { baseUrl, privateKey, publicKey } = getEpayV2Config();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyParams: Record<string, string> = {
    pid: params.pid,
    method: params.method,
    ...(params.device ? { device: params.device } : {}),
    type: params.type,
    out_trade_no: params.out_trade_no,
    notify_url: params.notify_url,
    return_url: params.return_url,
    name: params.name,
    money: params.money,
    clientip: params.clientip,
    ...(params.param ? { param: params.param } : {}),
    timestamp,
    sign_type: 'RSA',
  };
  const sign = signEpayParams(bodyParams, privateKey);
  bodyParams.sign = sign;

  const resp = await fetch(`${baseUrl}/api/pay/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: toFormBody(bodyParams),
    cache: 'no-store',
  });

  const text = await resp.text().catch(() => '');
  if (!resp.ok) throw new Error(text || `EPAY create failed: ${resp.status}`);
  let json: EpayCreateResponse;
  try {
    json = JSON.parse(text) as EpayCreateResponse;
  } catch {
    throw new Error(text || 'EPAY returned invalid JSON');
  }
  verifyEpayResponseOrThrow(json, publicKey);
  return json;
};

export const epayQueryOrder = async (params: {
  pid: string;
  out_trade_no: string;
}): Promise<EpayQueryResponse> => {
  const { baseUrl, privateKey, publicKey } = getEpayV2Config();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyParams: Record<string, string> = {
    pid: params.pid,
    out_trade_no: params.out_trade_no,
    timestamp,
    sign_type: 'RSA',
  };
  const sign = signEpayParams(bodyParams, privateKey);
  bodyParams.sign = sign;

  const resp = await fetch(`${baseUrl}/api/pay/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: toFormBody(bodyParams),
    cache: 'no-store',
  });

  const text = await resp.text().catch(() => '');
  if (!resp.ok) throw new Error(text || `EPAY query failed: ${resp.status}`);
  let json: EpayQueryResponse;
  try {
    json = JSON.parse(text) as EpayQueryResponse;
  } catch {
    throw new Error(text || 'EPAY returned invalid JSON');
  }
  verifyEpayResponseOrThrow(json, publicKey);
  return json;
};
