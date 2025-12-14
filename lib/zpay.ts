import crypto from 'crypto';

export type ZpayPayType = 'alipay' | 'wxpay';

export type ZpaySubmitParams = {
  pid: string;
  money: string;
  name: string;
  notify_url: string;
  out_trade_no: string;
  return_url: string;
  type: ZpayPayType;
  param?: string;
  cid?: string;
  sign?: string;
  sign_type?: 'MD5';
};

export type ZpayOrderQueryResult = {
  code?: number;
  msg?: string;
  trade_no?: string;
  out_trade_no?: string;
  money?: string;
  status?: number;
  type?: string;
};

export const getZpayConfig = () => {
  const baseUrl = (process.env.ZPAY_BASE_URL || 'https://zpayz.cn').replace(/\/+$/, '');
  const pid = (process.env.ZPAY_PID || '').trim();
  const key = (process.env.ZPAY_PKEY || process.env.ZPAY_KEY || '').trim();
  if (!pid) throw new Error('ZPAY_PID_MISSING');
  if (!key) throw new Error('ZPAY_PKEY_MISSING');
  return { baseUrl, pid, key };
};

export const buildZpaySignString = (params: Record<string, string>) => {
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

export const signZpayParams = (params: Record<string, string>, key: string) => {
  const base = buildZpaySignString(params);
  return crypto.createHash('md5').update(base + key, 'utf8').digest('hex');
};

export const buildZpaySubmitUrl = (params: ZpaySubmitParams) => {
  const { baseUrl, key } = getZpayConfig();

  const plainParams: Record<string, string> = {};
  Object.entries(params).forEach(([k, v]) => {
    if (typeof v === 'string' && v.length > 0) plainParams[k] = v;
  });

  const sign = signZpayParams(plainParams, key);
  const url = new URL(`${baseUrl}/submit.php`);
  Object.entries({ ...plainParams, sign, sign_type: 'MD5' }).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
};

export const verifyZpaySignature = (params: Record<string, string>) => {
  const { key } = getZpayConfig();
  const sign = (params.sign || '').toLowerCase();
  if (!sign) return false;
  const computed = signZpayParams(params, key).toLowerCase();
  try {
    return crypto.timingSafeEqual(Buffer.from(sign, 'utf8'), Buffer.from(computed, 'utf8'));
  } catch {
    return false;
  }
};

export const queryZpayOrder = async (outTradeNo: string): Promise<ZpayOrderQueryResult> => {
  const { baseUrl, pid, key } = getZpayConfig();
  const url = new URL(`${baseUrl}/api.php`);
  url.searchParams.set('act', 'order');
  url.searchParams.set('pid', pid);
  url.searchParams.set('key', key);
  url.searchParams.set('out_trade_no', outTradeNo);

  const resp = await fetch(url.toString(), { method: 'GET', cache: 'no-store' });
  const text = await resp.text().catch(() => '');
  if (!resp.ok) {
    throw new Error(text || `ZPAY query failed: ${resp.status}`);
  }
  try {
    return JSON.parse(text) as ZpayOrderQueryResult;
  } catch {
    throw new Error(text || 'ZPAY returned invalid JSON');
  }
};

