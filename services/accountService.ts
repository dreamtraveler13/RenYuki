'use client';

import type { AccountUser, CoinPackId, PayType, PaymentOrder } from '../types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';

const withBase = (path: string) => `${API_BASE}${path}`;

const requestJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const resp = await fetch(withBase(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const contentType = resp.headers.get('content-type') || '';
  let data: any = null;
  let text: string | null = null;

  try {
    if (contentType.includes('application/json')) {
      data = await resp.json();
    } else {
      text = await resp.text();
      try {
        data = JSON.parse(text);
      } catch {}
    }
  } catch {}

  const errorMessage =
    (data && typeof data === 'object' && typeof (data as any).error === 'string' && (data as any).error) ||
    (text && text.trim().length > 0 ? text.trim() : null) ||
    `Request failed: ${resp.status}`;

  if (!resp.ok || (data && typeof data === 'object' && (data as any).error)) {
    throw new Error(errorMessage);
  }

  return data as T;
};

export const authMe = async (): Promise<AccountUser> => {
  const data = await requestJson<{ user: AccountUser }>('/api/auth/me', { method: 'GET' });
  return data.user;
};

export const authLogin = async (params: { username: string; password: string }): Promise<AccountUser> => {
  const data = await requestJson<{ user: AccountUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.user;
};

export const authRegister = async (params: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<AccountUser> => {
  const data = await requestJson<{ user: AccountUser }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.user;
};

export const authLogout = async (): Promise<void> => {
  await requestJson<{ ok: true }>('/api/auth/logout', { method: 'POST', body: '{}' });
};

export const walletBalance = async (): Promise<number> => {
  const data = await requestJson<{ coins: number }>('/api/wallet/balance', { method: 'GET' });
  return data.coins;
};

export const createPayOrder = async (params: {
  packId: CoinPackId;
  payType: PayType;
}): Promise<{ order: PaymentOrder; payUrl: string }> => {
  return await requestJson<{ order: PaymentOrder; payUrl: string }>('/api/pay/create', {
    method: 'POST',
    body: JSON.stringify(params),
  });
};

export const syncPayOrder = async (params: {
  outTradeNo: string;
}): Promise<{ ok: boolean; paid: boolean; order: PaymentOrder; coins?: number }> => {
  return await requestJson<{ ok: boolean; paid: boolean; order: PaymentOrder; coins?: number }>('/api/pay/sync', {
    method: 'POST',
    body: JSON.stringify(params),
  });
};
