const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6,
  七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12,
};

/** Conservatively recover an explicit 2-12 Markdown-table count, never a column count or maximum. */
export function explicitTableCount(value: string): number | undefined {
  const candidates: number[] = [];
  const englishNumber = "(?:2|3|4|5|6|7|8|9|10|11|12|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
  for (const match of value.matchAll(new RegExp(`\\b(${englishNumber})\\s+(?:(?:separate|independent|distinct|individual)\\s+)?(?:markdown\\s+)?tables?\\b`, "giu"))) {
    const prefix = value.slice(Math.max(0, (match.index ?? 0) - 20), match.index ?? 0);
    if (/(?:at\s+most|no\s+more\s+than|(?:do\s+)?not\s+exceed|up\s+to|maximum(?:\s+of)?)\s*$/iu.test(prefix)) continue;
    const count = boundedCount(match[1] ?? "");
    if (count !== undefined) candidates.push(count);
  }
  for (const match of value.matchAll(/([二两三四五六七八九十\d]{1,2})\s*(?:个|张|份)?\s*(?:(?:独立|分开|单独|不同)\s*的?\s*)?(?:Markdown\s*)?表格/giu)) {
    const prefix = value.slice(Math.max(0, (match.index ?? 0) - 8), match.index ?? 0);
    if (/(?:最多|不超过|至多|第)\s*$/u.test(prefix)) continue;
    const count = boundedCount(match[1] ?? "");
    if (count !== undefined) candidates.push(count);
  }
  const ordinalNumbers = new Set<number>();
  const englishOrdinals: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
    seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  };
  for (const match of value.matchAll(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+(?:(?:separate|independent|distinct)\s+)?table\b/giu)) {
    const count = englishOrdinals[(match[1] ?? "").toLowerCase()];
    if (count !== undefined) ordinalNumbers.add(count);
  }
  for (const match of value.matchAll(/第\s*([一二三四五六七八九十\d]{1,2})\s*(?:个|张|份)?\s*(?:独立的?)?表格/gu)) {
    const count = boundedCount(match[1] ?? "", 1);
    if (count !== undefined) ordinalNumbers.add(count);
  }
  const ordinalCount = Math.max(0, ...ordinalNumbers);
  if (ordinalCount >= 2 && Array.from({ length: ordinalCount }, (_, index) => index + 1).every((number) => ordinalNumbers.has(number))) {
    candidates.push(ordinalCount);
  }
  return candidates.length > 0 ? Math.max(...candidates) : undefined;
}

/** Recover one unambiguous, explicitly enumerated table-header sequence. */
export function explicitTableColumns(value: string): string[] | undefined {
  const candidates: string[][] = [];
  const patterns = [
    /\b(?:columns?|headers?)\b[^:.\n]{0,100}[:：]\s*([^.;\n]{3,800})/giu,
    /(?:列|栏)[^:：。\n]{0,80}[:：]\s*([^。；;\n]{3,800})/gu,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const parsed = explicitSchemaItems(match[1] ?? "");
      if (parsed) candidates.push(parsed);
    }
  }
  const unique = candidates.filter((candidate, index) => (
    candidates.findIndex((other) => sameSchema(candidate, other)) === index
  ));
  return unique.length === 1 ? unique[0] : undefined;
}

/** Recover an explicitly numbered comparison-dimension list, expanding named security subdimensions. */
export function explicitComparisonDimensions(value: string): string[] | undefined {
  const candidates: string[][] = [];
  const leadIns = [
    /\b(?:following|below)\s+(?:comparison\s+)?(?:dimensions?|criteria|fields?|attributes?)\s*[:：]/giu,
    /(?:以下|下列)(?:对比|比较)?(?:维度|指标|字段|属性)\s*[:：]/gu,
  ];
  for (const leadIn of leadIns) {
    for (const match of value.matchAll(leadIn)) {
      const dimensions = consecutiveNamedDimensions(value.slice((match.index ?? 0) + match[0].length));
      if (dimensions) candidates.push(dimensions);
    }
  }
  const unique = candidates.filter((candidate, index) => (
    candidates.findIndex((other) => sameSchema(candidate, other)) === index
  ));
  return unique.length === 1 ? unique[0] : undefined;
}

/** Recover exactly two explicitly named table partitions. */
export function explicitTablePartitionLabels(value: string): string[] | undefined {
  const candidates: string[][] = [];
  for (const match of value.matchAll(/(?:labeled\s+)?(?:markdown\s+)?table\s+partitions?\s*[:：]\s*([^\n.。]{3,600})/giu)) {
    const parsed = explicitSchemaItems(match[1] ?? "");
    if (parsed?.length === 2) candidates.push(parsed);
  }
  const chinesePair = /(?:一个|第一(?:个|张)?(?:表格)?)[^，,。；;\n]{0,32}?(?:用于|用来)\s*(?:对比|比较|展示|整理|列出)?\s*([^，,。；;\n]{2,120})[，,；;]\s*(?:另一个|第二(?:个|张)?(?:表格)?)[^。；;\n]{0,32}?(?:用于|用来)\s*(?:对比|比较|展示|整理|列出)?\s*([^。；;\n]{2,120})/gu;
  for (const match of value.matchAll(chinesePair)) {
    const parsed = [cleanPartitionLabel(match[1] ?? ""), cleanPartitionLabel(match[2] ?? "")].filter(Boolean);
    if (parsed.length === 2) candidates.push(parsed);
  }
  const englishPair = /\bone\s+(?:table\s+)?(?:for|to\s+(?:compare|show|list))\s+([^,;.\n]{2,120})[,;]\s*(?:the\s+)?(?:other|another|second)\s+(?:table\s+)?(?:for|to\s+(?:compare|show|list))\s+([^;.\n]{2,120})/giu;
  for (const match of value.matchAll(englishPair)) {
    const parsed = [cleanPartitionLabel(match[1] ?? ""), cleanPartitionLabel(match[2] ?? "")].filter(Boolean);
    if (parsed.length === 2) candidates.push(parsed);
  }
  const unique = candidates.filter((candidate, index) => (
    candidates.findIndex((other) => sameSchema(candidate, other)) === index
  ));
  return unique.length === 1 ? unique[0] : undefined;
}

function consecutiveNamedDimensions(value: string): string[] | undefined {
  const matches = Array.from(value.matchAll(/(?:^|\n)[ \t]{0,3}(\d{1,2})[.)、．][ \t]+(?:\*\*|__)([^*_\n]{2,160})(?:\*\*|__)\s*[：:]?\s*([^\n]*)/gu));
  const start = matches.findIndex((match) => Number(match[1]) === 0 || Number(match[1]) === 1);
  if (start < 0) return undefined;
  let expected = Number(matches[start]?.[1]);
  const dimensions: string[] = [];
  for (const match of matches.slice(start)) {
    if (Number(match[1]) !== expected) break;
    const heading = cleanSchemaItem(match[2] ?? "");
    if (!heading) return undefined;
    const subdimensions = /\bsecurity\b|安全支持/iu.test(heading)
      ? explicitSecuritySubdimensions(match[3] ?? "")
      : undefined;
    dimensions.push(...(subdimensions ?? [heading]));
    expected += 1;
    if (dimensions.length > 64) return undefined;
  }
  const unique = Array.from(new Set(dimensions));
  return unique.length >= 2 ? unique : undefined;
}

function explicitSecuritySubdimensions(value: string): string[] | undefined {
  const match = value.match(/(?:attacks?|threats?|攻击)[^:.。\n]{0,100}[:：]\s*([^。.\n]{3,500})/iu);
  if (!match?.[1]) return undefined;
  const items = match[1]
    .replace(/\s*,?\s+and\s+/giu, ",")
    .replace(/\s*(?:、|，|,|；|;)\s*/gu, ",")
    .split(",")
    .map(cleanSchemaItem)
    .filter((item) => item.length >= 2 && item.length <= 80);
  return items.length >= 2 && items.length <= 12 ? Array.from(new Set(items)) : undefined;
}

function cleanPartitionLabel(value: string): string {
  return cleanSchemaItem(value)
    .replace(/^(?:the\s+)?(?:comparison\s+of|comparison|compare|show|list)\s+/iu, "")
    .replace(/^(?:对比|比较|展示|整理|列出)\s*/u, "")
    .trim();
}

/** Recover one unambiguous ordered list of explicitly named top-level sections. */
export function explicitTopLevelSectionNames(value: string): string[] | undefined {
  const englishCount = "(?:2|3|4|5|6|7|8|9|10|11|12|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
  const explicitOutputCandidates: string[][] = [];
  const explicitOutputPattern = new RegExp(`\\b(?:divide|split|organize|organise|structure)\\s+(?:the\\s+)?(?:report|answer|response)\\s+(?:into|as)\\s+(?:the\\s+)?(?:following\\s+)?(?:(${englishCount})\\s+)?(?:main\\s+|top[- ]level\\s+)?(?:sections?|parts?)\\s*[:：]\\s*([^.\\n]{3,1200})`, "giu");
  for (const match of value.matchAll(explicitOutputPattern)) {
    const parsed = explicitSchemaItems(match[2] ?? "");
    const declaredCount = match[1] ? boundedCount(match[1]) : undefined;
    if (parsed && (declaredCount === undefined || declaredCount === parsed.length)) explicitOutputCandidates.push(parsed);
  }
  const uniqueExplicitOutputCandidates = explicitOutputCandidates.filter((candidate, index) => (
    explicitOutputCandidates.findIndex((other) => sameSchema(candidate, other)) === index
  ));
  if (uniqueExplicitOutputCandidates.length === 1) return uniqueExplicitOutputCandidates[0];

  const candidates: string[][] = [];
  for (const match of value.matchAll(/\btop[- ]level\s+sections?\b[^:.\n]{0,120}[:：]\s*([^\n]{3,1200})/giu)) {
    const parsed = explicitSchemaItems(match[1] ?? "");
    if (parsed) candidates.push(parsed);
  }
  const leadIns = [
    new RegExp(`(?:report|answer|response)[^.!?\\n:：]{0,120}(?:include|contain|comprise|cover|consist\\s+of)[^.!?\\n:：]{0,80}\\b(?:the\\s+)?following\\s+(?:(${englishCount})\\s+)?(?:(?:main|core|major|key)\\s+)?(?:sections?|parts?|areas?)\\s*[:：]`, "giu"),
    /(?:报告|回答|答复)[^。！？\n:：]{0,120}(?:包含|包括|分为|分成)[^。！？\n:：]{0,60}以下\s*(?:([二两三四五六七八九十\d]{1,2})\s*个?)?(?:章节|部分|方面)\s*[:：]/gu,
    /(?:整理|梳理|组织|列出|介绍|涵盖|覆盖)[^。！？\n:：]{0,80}以下\s*(?:([二两三四五六七八九十\d]{1,2})\s*个?)?(?:几\s*(?:个|块)?)?(?:块)?(?:内容|要点|板块|主题)\s*[:：]/gu,
  ];
  for (const leadIn of leadIns) {
    for (const match of value.matchAll(leadIn)) {
      const names = consecutiveNamedSections(value.slice((match.index ?? 0) + match[0].length));
      const declaredCount = match[1] ? boundedCount(match[1]) : undefined;
      if (names && (declaredCount === undefined || declaredCount === names.length)) candidates.push(names);
    }
  }
  const unique = candidates.filter((candidate, index) => (
    candidates.findIndex((other) => sameSchema(candidate, other)) === index
  ));
  return unique.length === 1 ? unique[0] : undefined;
}

export interface ExplicitNestedSectionGroup {
  parent: string;
  children: Array<{ heading: string; instruction: string }>;
}

/**
 * Recover bold, indented child headings owned by a numbered parent section.
 * The parent must explicitly introduce subsections/categories, so an ordinary
 * nested bullet list is not promoted into a report-structure contract.
 */
export function explicitNestedSectionGroups(value: string): ExplicitNestedSectionGroup[] {
  const lines = value.split(/\r?\n/gu);
  const groups: ExplicitNestedSectionGroup[] = [];
  const parentPattern = /^([ \t]{0,3})(?:\(?([0-9]{1,2}|[一二两三四五六七八九十]{1,2})\)?[.)、．]|（([0-9]{1,2}|[一二两三四五六七八九十]{1,2})）)\s*(?:\*\*|__)([^*_\n]{2,160})(?:\*\*|__)\s*[:：]\s*(.*)$/u;
  const childPattern = /^([ \t]+)[*+-]\s+(?:\*\*|__)([^*_\n]{2,160})(?:\*\*|__)\s*[:：]\s*(.*)$/u;
  for (let index = 0; index < lines.length; index += 1) {
    const parentMatch = lines[index]?.match(parentPattern);
    if (!parentMatch) continue;
    const parentIndent = indentationWidth(parentMatch[1] ?? "");
    const parent = cleanSchemaItem(parentMatch[4] ?? "");
    if (!parent) continue;
    const children: ExplicitNestedSectionGroup["children"] = [];
    const leadLines = [parentMatch[5] ?? ""];
    for (let childIndex = index + 1; childIndex < lines.length; childIndex += 1) {
      const line = lines[childIndex] ?? "";
      const nextParent = line.match(parentPattern);
      if (nextParent && indentationWidth(nextParent[1] ?? "") <= parentIndent) break;
      const childMatch = line.match(childPattern);
      if (!childMatch || indentationWidth(childMatch[1] ?? "") <= parentIndent) {
        if (children.length === 0) leadLines.push(line);
        continue;
      }
      const heading = cleanSchemaItem(childMatch[2] ?? "");
      const instruction = (childMatch[3] ?? "").replace(/\s+/gu, " ").trim();
      if (heading) children.push({ heading, instruction });
    }
    if (children.length < 2 || children.length > 12) continue;
    const leadIn = leadLines.join(" ").replace(/\s+/gu, " ").trim();
    if (!explicitNestedSectionLeadIn(leadIn)) continue;
    const declaredCount = explicitNestedSectionCount(leadIn);
    if (declaredCount !== undefined && declaredCount !== children.length) continue;
    const headings = children.map((child) => child.heading);
    if (new Set(headings.map((heading) => heading.normalize("NFKC").toLocaleLowerCase())).size !== headings.length) continue;
    groups.push({ parent, children });
  }
  return groups.filter((group, index) => groups.findIndex((other) => (
    other.parent.normalize("NFKC").toLocaleLowerCase() === group.parent.normalize("NFKC").toLocaleLowerCase()
      && sameSchema(other.children.map((child) => child.heading), group.children.map((child) => child.heading))
  )) === index);
}

function explicitNestedSectionLeadIn(value: string): boolean {
  return /\b(?:divide|split|organize|organise|group|classify|include|contain|cover)[^.!?\n]{0,80}\b(?:into|as|the\s+following)[^.!?\n]{0,50}\b(?:subsections?|subcategories|categories|classes|topics|headings?)\b/iu.test(value)
    || /\b(?:following|below)\s+(?:named\s+|clear\s+)?(?:subsections?|subcategories|categories|classes|topics|headings?)\b/iu.test(value)
    || /(?:分为|分成|划分为|包括|包含|下列|以下)[^。！？\n]{0,36}(?:小类|子类|小节|子主题|类别|方面)/u.test(value);
}

function explicitNestedSectionCount(value: string): number | undefined {
  const english = value.match(/\b(2|3|4|5|6|7|8|9|10|11|12|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:named\s+|clear\s+)?(?:subsections?|subcategories|categories|classes|topics|headings?)\b/iu);
  const chinese = value.match(/([二两三四五六七八九十\d]{1,2})\s*个?(?:小类|子类|小节|子主题|类别|方面)/u);
  return boundedCount(english?.[1] ?? chinese?.[1] ?? "");
}

function indentationWidth(value: string): number {
  return Array.from(value).reduce((total, character) => total + (character === "\t" ? 4 : 1), 0);
}

function consecutiveNamedSections(value: string): string[] | undefined {
  const matches = value.matchAll(/(?:^|\n)\s*(?:\(?([0-9]{1,2}|[一二两三四五六七八九十]{1,2})\)?[.)、．]|（([0-9]{1,2}|[一二两三四五六七八九十]{1,2})）)\s*(?:\*{1,2})?([^:：\n*]{2,160})(?:\*{1,2})?\s*[:：]/gu);
  const names: string[] = [];
  let expected = 1;
  for (const match of matches) {
    const number = boundedCount(match[1] ?? match[2] ?? "", 1);
    if (number !== expected) {
      if (names.length > 0) break;
      continue;
    }
    const name = cleanSchemaItem(match[3] ?? "");
    if (!name) return undefined;
    names.push(name);
    expected += 1;
    if (names.length > 12) return undefined;
  }
  return names.length >= 2 ? names : undefined;
}

function explicitSchemaItems(value: string): string[] | undefined {
  const bracketed = Array.from(value.matchAll(/(?:\[([^\]\n]{1,120})\]|【([^】\n]{1,120})】|`([^`\n]{1,120})`)/gu))
    .map((match) => cleanSchemaItem(match[1] ?? match[2] ?? match[3] ?? ""))
    .filter(Boolean);
  const quoted = Array.from(value.matchAll(/(?:'([^'\n]{1,120})'|"([^"\n]{1,120})"|“([^”\n]{1,120})”|‘([^’\n]{1,120})’)/gu))
    .map((match) => cleanSchemaItem(match[1] ?? match[2] ?? match[3] ?? match[4] ?? ""))
    .filter(Boolean);
  const items = bracketed.length >= 2
    ? bracketed
    : quoted.length >= 2
      ? quoted
    : value
      .replace(/\s*,?\s+and\s+/giu, ",")
      .replace(/\s*,?\s+or\s+/giu, ",")
      .split(/\s*[,;，；、|]\s*/gu)
      .map(cleanSchemaItem)
      .filter(Boolean);
  if (items.length < 2 || items.length > 12) return undefined;
  if (items.some((item) => item.length > 120 || /[.!?。！？]/u.test(item))) return undefined;
  const unique = Array.from(new Set(items));
  return unique.length >= 2 ? unique : undefined;
}

function cleanSchemaItem(value: string): string {
  return value
    .replace(/^[\s*_~"'“”‘’[\]【】]+|[\s*_~"'“”‘’[\]【】]+$/gu, "")
    .replace(/^(?:and|or)\s+/iu, "")
    .trim();
}

function sameSchema(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => (
    item.toLocaleLowerCase() === right[index]?.toLocaleLowerCase()
  ));
}

function boundedCount(value: string, minimum = 2): number | undefined {
  const normalized = value.trim().toLowerCase();
  const count = COUNT_WORDS[normalized] ?? Number(normalized);
  return Number.isSafeInteger(count) && count >= minimum && count <= 12 ? count : undefined;
}
