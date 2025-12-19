import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'ry_session';
const SESSION_TTL_DAYS = 30;

type JwtHeader = {
  alg: 'HS256';
  typ: 'JWT';
};

type SessionPayload = {
  v: 1;
  sub: string; // userId
  iat: number; // seconds
  exp: number; // seconds
};

const base64UrlEncode = (input: Buffer | string) => {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

const base64UrlDecode = (input: string) => {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
};

const getAuthSecret = () => {
  return process.env.AUTH_SECRET || process.env.LINGYAAI_API_KEY || process.env.API_KEY || 'dev-insecure-secret';
};

const sign = (data: string) => {
  const mac = crypto.createHmac('sha256', getAuthSecret()).update(data).digest();
  return base64UrlEncode(mac);
};

const getCookieSecure = (req?: NextRequest) => {
  if (typeof process.env.COOKIE_SECURE === 'string') return process.env.COOKIE_SECURE === '1';
  const forwardedProto = req?.headers.get('x-forwarded-proto') || '';
  if (forwardedProto) return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
  const proto = req?.nextUrl?.protocol || '';
  if (proto) return proto === 'https:';
  return false;
};

export const createSessionToken = (userId: string) => {
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: 1,
    sub: userId,
    iat: nowSec,
    exp: nowSec + SESSION_TTL_DAYS * 24 * 60 * 60,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const toSign = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(toSign);
  return `${toSign}.${signature}`;
};

export const verifySessionToken = (token: string): SessionPayload | null => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const toSign = `${encodedHeader}.${encodedPayload}`;
  const expected = sign(toSign);
  try {
    if (
      expected.length !== signature.length ||
      !crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'))
    ) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payloadRaw = base64UrlDecode(encodedPayload).toString('utf8');
    const payload = JSON.parse(payloadRaw) as SessionPayload;
    if (!payload || typeof payload !== 'object') return null;
    if (payload.v !== 1) return null;
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= 0) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
};

export const getUserIdFromRequest = (req: NextRequest): string | null => {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token);
  return payload?.sub || null;
};

export const setSessionCookie = (res: NextResponse, userId: string, req?: NextRequest) => {
  const token = createSessionToken(userId);
  const secure = getCookieSecure(req);
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
};

export const clearSessionCookie = (res: NextResponse, req?: NextRequest) => {
  const secure = getCookieSecure(req);
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
  });
};
