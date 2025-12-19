import { getUserRecordById } from '@/lib/userStore';

export const isGodUserId = async (userId: string): Promise<boolean> => {
  const u = await getUserRecordById(userId);
  return !!u && !u.bannedAt && String(u.username).toLowerCase() === 'admire';
};

export const requireAdminTokenIfConfigured = (headers: Headers) => {
  const required = process.env.ADMIN_DELETE_TOKEN;
  if (!required) return;
  const provided = headers.get('x-admin-token') || '';
  if (!provided || provided !== required) throw new Error('ADMIN_TOKEN_REQUIRED');
};

