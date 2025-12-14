import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

type UsageRecord = {
  date: string; // YYYY-MM-DD
};

const COOKIE_NAME = 'aigg_uid';
const usageMap = new Map<string, UsageRecord>();

const scheduleReset = (userId: string, date: string) => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const delay = midnight.getTime() - now.getTime();

  setTimeout(() => {
    const current = usageMap.get(userId);
    if (current?.date === date) usageMap.delete(userId);
  }, delay).unref?.();
};

const normalizeDate = (d = new Date()) => d.toISOString().slice(0, 10);

const getUserId = (req: NextRequest) => {
  const cookieId = req.cookies.get(COOKIE_NAME)?.value;
  if (cookieId) return { userId: cookieId, needsCookie: false };

  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || req.ip || 'unknown-ip';
  const ua = req.headers.get('user-agent') || 'unknown-ua';
  const hashed = crypto.createHash('sha256').update(`${ip}-${ua}`).digest('hex');
  return { userId: hashed, needsCookie: true };
};

export const enforceDailyGenerationLimit = (req: NextRequest) => {
  const disabled =
    process.env.DISABLE_DAILY_LIMIT === '1' ||
    process.env.DISABLE_DAILY_LIMIT === 'true' ||
    process.env.DISABLE_DAILY_LIMIT === 'yes';
  if (disabled) {
    return { blocked: false, cookieName: COOKIE_NAME, cookieToSet: undefined };
  }

  const today = normalizeDate();
  const { userId, needsCookie } = getUserId(req);
  const record = usageMap.get(userId);

  if (record?.date === today) {
    const res = NextResponse.json(
      { error: 'Daily limit reached: each user can generate once per day.' },
      { status: 429 }
    );
    if (needsCookie) {
      res.cookies.set(COOKIE_NAME, userId, { path: '/', maxAge: 60 * 60 * 24 * 30, httpOnly: true });
    }
    return { blocked: true, response: res };
  }

  usageMap.set(userId, { date: today });
  scheduleReset(userId, today);

  return {
    blocked: false,
    cookieName: COOKIE_NAME,
    cookieToSet: needsCookie ? userId : undefined,
  };
};
