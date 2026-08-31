export interface SourceQualityInput {
  title?: string;
  url?: string;
  snippet?: string;
  description?: string;
  content?: string;
}

export interface SourceQualityAssessment {
  usable: boolean;
  reason?: string;
}

export type InferredSourceTier = "official" | "primary" | "secondary" | "unknown" | (string & {});

interface SourceHostQualityPolicy {
  domains: string[];
  forcedTier: "secondary" | "unknown";
  maxQualityScore: number;
  signal: string;
}

/** These hosts can contain useful material, but the host itself is not the
 * original publisher or an authoritative record. Keep them usable for leads
 * and corroboration while preventing agent-declared authority from turning
 * them into primary evidence. */
const SOURCE_HOST_QUALITY_POLICIES: SourceHostQualityPolicy[] = [
  {
    domains: ["researchgate.net", "academia.edu"],
    forcedTier: "secondary",
    maxQualityScore: 0.55,
    signal: "research_repository_or_profile_domain",
  },
  {
    domains: ["sohu.com"],
    forcedTier: "secondary",
    maxQualityScore: 0.55,
    signal: "reposted_content_domain",
  },
  {
    domains: ["medium.com", "substack.com", "blogspot.com", "wordpress.com", "csdn.net"],
    forcedTier: "secondary",
    maxQualityScore: 0.6,
    signal: "community_publishing_domain",
  },
];

const BLOCKED_PATTERNS = [
  /安全验证/i,
  /人机验证/i,
  /验证码/i,
  /just a moment/i,
  /enable javascript/i,
  /checking your browser/i,
  /access denied/i,
  /403 forbidden/i,
  /captcha/i,
  /404 not found/i,
  /^page not found\b/i,
  /^not found\b/i,
  /page not found \|/i,
  /powered by discuz/i,
  /世界杯导航/i,
  /博彩|彩票|赌球|投注平台/i,
  /bet体育|beat365|365bet体育|365平台|365体育|365.*存款/i,
  /网站正在维护/i,
  /内容正在升级中/i,
  /service unavailable/i,
  /豆丁网|docin/i,
  /淘豆网|taodocs/i,
  /道客巴巴|doc88/i,
  /学科网|zxxk/i,
  /考试资料网|无忧题库|业百科|今日头条/i,
  /(?:题库|考试试题|找答案|选择题|论述题|答案解析)/i,
  /(?:免费全文阅读|文档格式|下载积分|下载此文档|浏览次数|文档列表|文档介绍)/i,
  /(?:课件|ppt|PPT|同步课堂|历史必修).{0,24}(?:下载|word|Word|学科网)/i,
  /(?:思维导图|树形表格).{0,40}(?:讲述了|相关故事|如果你对)/i,
];

const BLOCKED_HOSTS = [
  "wikipedia.org",
  "baike.baidu.com",
  "baike.com",
  "wenxuecity.com",
  "airsplu.cn",
  "zhihu.com",
  "semanticscholar.org",
  "docin.com",
  "taodocs.com",
  "doc88.com",
  "book118.com",
  "zxxk.com",
  "edrawsoft.cn",
  "guandang.net",
  "ppkao.com",
  "freetiku.com",
  "yebaike.com",
  "toutiao.com",
  "mbalib.com",
];

const RESERVED_PLACEHOLDER_HOSTS = [
  "example.com",
  "example.org",
  "example.net",
];

export function assessSourceQuality(input: SourceQualityInput): SourceQualityAssessment {
  const title = clean(input.title);
  const url = clean(input.url);
  const snippet = clean(input.snippet);
  const description = clean(input.description);
  const content = clean(input.content);
  const combined = [title, snippet, description, content.slice(0, 1200)].filter(Boolean).join("\n");

  const policy = assessSourceUrlPolicy(url);
  if (!policy.usable) return policy;
  if (!title && !snippet && !content) return { usable: false, reason: "empty_source" };
  if (title && !snippet && !description && !content) return { usable: false, reason: "title_only_source" };
  if (/^URL Source:\s*https?:\/\//i.test(title) && content.replace(/\s+/g, "").length < 1000) {
    return { usable: false, reason: "empty_reader_output" };
  }
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(combined))) return { usable: false, reason: "blocked_or_verification_page" };
  if (looksLikeMojibake(title) || looksLikeMojibake(content.slice(0, 2000))) return { usable: false, reason: "mojibake_content" };

  if (content) {
    const compact = content.replace(/\s+/g, "");
    if (looksLikeEmptyJinaReaderOutput(content)) return { usable: false, reason: "empty_reader_output" };
    if (compact.length < 50) return { usable: false, reason: "too_short_fetched_content" };
  }

  return { usable: true };
}

export function assessSourceUrlPolicy(value: string | undefined): SourceQualityAssessment {
  const url = clean(value);
  if (!url) return { usable: true };
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const placeholder = RESERVED_PLACEHOLDER_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
    if (placeholder) return { usable: false, reason: "placeholder_source_policy" };
    const blocked = BLOCKED_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
    if (blocked) return { usable: false, reason: "blocked_source_policy" };
  } catch {
    return { usable: false, reason: "invalid_source_url" };
  }
  return { usable: true };
}

/** Infer only high-confidence authority signals; academic hosting alone does not
 * prove that a page is original research. */
export function inferSourceTier(url: string | undefined, declared: InferredSourceTier = "secondary"): InferredSourceTier {
  const host = sourceHost(url);
  if (!host) return declared;
  const hostPolicy = sourceHostQualityPolicy(host);
  if (hostPolicy) return hostPolicy.forcedTier;
  if (isOfficialHost(host)) return "official";
  return declared;
}

export function calibrateSourceQualityScore(input: {
  url?: string;
  declaredTier?: InferredSourceTier;
  declaredScore: number;
  fetched: boolean;
}): { sourceTier: InferredSourceTier; qualityScore: number; signals: string[] } {
  const host = sourceHost(input.url);
  const hostPolicy = host ? sourceHostQualityPolicy(host) : undefined;
  const sourceTier = inferSourceTier(input.url, input.declaredTier ?? "secondary");
  const signals: string[] = [];
  let floor = 0;
  if (sourceTier === "official") {
    floor = input.fetched ? 0.85 : 0.75;
    signals.push("official_domain");
  } else if (sourceTier === "primary") {
    floor = input.fetched ? 0.8 : 0.7;
    signals.push("declared_primary_source");
  }
  if (input.fetched) signals.push("full_content_fetched");
  const declared = Math.min(1, Math.max(0, Number.isFinite(input.declaredScore) ? input.declaredScore : 0));
  let qualityScore = Math.max(declared, floor);
  if (hostPolicy) {
    qualityScore = Math.min(qualityScore, hostPolicy.maxQualityScore);
    signals.push(hostPolicy.signal, `quality_score_capped_${hostPolicy.maxQualityScore}`);
  }
  return { sourceTier, qualityScore, signals };
}

function clean(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function sourceHost(value: string | undefined): string | undefined {
  const url = clean(value);
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function sourceHostQualityPolicy(host: string): SourceHostQualityPolicy | undefined {
  return SOURCE_HOST_QUALITY_POLICIES.find((policy) => (
    policy.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  ));
}

function isOfficialHost(host: string): boolean {
  if (/(^|\.)gov(?:\.[a-z]{2,})+$/i.test(host) || /(^|\.)gov$/i.test(host)) return true;
  if (/(^|\.)(?:go|gouv|gob|gc)\.[a-z]{2,}(?:\.[a-z]{2,})?$/i.test(host)) return true;
  return [
    "europa.eu",
    "un.org",
    "who.int",
    "worldbank.org",
    "oecd.org",
    "imf.org",
    "wto.org",
    "bis.org",
    "acm.nl",
    "ofcom.org.uk",
    "autoritedelaconcurrence.fr",
    "bundeskartellamt.de",
    "agcm.it",
    "cnmc.es",
  ].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function looksLikeEmptyJinaReaderOutput(content: string): boolean {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact.startsWith("URL Source:")) return false;
  if (compact.length < 500) return true;
  return !/Markdown Content:/i.test(compact) && compact.length < 900;
}

function looksLikeMojibake(value: string): boolean {
  if (!value) return false;
  const replacementChars = (value.match(/�/g) ?? []).length;
  if (replacementChars >= 2) return true;
  const suspicious = (value.match(/锟斤拷|涔|犺|繎|骞|€|讳功|壎璐|閲嶈|瑕侀椈|捣甯|斂搴/g) ?? []).length;
  return suspicious >= 3;
}
