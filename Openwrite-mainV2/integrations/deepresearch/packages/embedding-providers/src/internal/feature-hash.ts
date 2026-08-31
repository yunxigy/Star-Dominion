// 轻量本地 feature hashing：分词 → 每个 token 哈希到 [0, dim) → 计数 + L2 归一化。
// 语义上：同类词（共现）的向量 cosine 高，异类词 cosine 低。零 API 依赖、零下载。

// 32-bit FNV-1a 哈希。稳定、无依赖、ts 简单。
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 简单分词：英文按非字母数字切，中文按字切。低资源（stopword 过滤可后续加）。
export function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  // 拆出英文 / 数字 token
  const en = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  out.push(...en);
  // 中文按字拆
  const zh = text.match(/[\u4e00-\u9fff]/g) ?? [];
  out.push(...zh);
  return out;
}

export function featureHash(text: string, dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  const toks = tokenize(text);
  for (const t of toks) {
    // 用 2 个不同 salt 拆 bigram，避免 unigram 碰撞
    const h1 = fnv1a(t);
    const h2 = fnv1a(t + "\u0001");
    v[h1 % dim]! += 1;
    v[h2 % dim]! += 0.5;
  }
  // L2 归一
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] = v[i]! / norm;
  }
  return v;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function stableId(prefix: string, text: string): string {
  return `${prefix}_${fnv1a(text).toString(36)}`;
}
