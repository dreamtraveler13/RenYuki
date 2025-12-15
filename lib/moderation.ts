export type ModerationHit = {
  matched: string;
  category: 'cn_political_sensitive';
};

const normalizeText = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
};

const KEYWORDS: Array<{ keyword: string; category: ModerationHit['category'] }> = [
  { keyword: '习近平', category: 'cn_political_sensitive' },
  { keyword: '中共', category: 'cn_political_sensitive' },
  { keyword: '共产党', category: 'cn_political_sensitive' },
  { keyword: '天安门', category: 'cn_political_sensitive' },
  { keyword: '六四', category: 'cn_political_sensitive' },
  { keyword: '64', category: 'cn_political_sensitive' },
  { keyword: '法轮功', category: 'cn_political_sensitive' },
  { keyword: '台独', category: 'cn_political_sensitive' },
  { keyword: '台湾独立', category: 'cn_political_sensitive' },
  { keyword: '港独', category: 'cn_political_sensitive' },
  { keyword: '西藏独立', category: 'cn_political_sensitive' },
  { keyword: '新疆独立', category: 'cn_political_sensitive' },
  { keyword: '民运', category: 'cn_political_sensitive' },
];

export const detectPoliticalSensitiveContent = (inputs: unknown[]): ModerationHit | null => {
  const text = inputs.map(normalizeText).filter(Boolean).join('\n');
  if (!text) return null;

  const lowered = text.toLowerCase();
  for (const item of KEYWORDS) {
    const k = item.keyword;
    if (!k) continue;
    const hit = k.toLowerCase();
    if (lowered.includes(hit)) {
      return { matched: item.keyword, category: item.category };
    }
  }
  return null;
};

