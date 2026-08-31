import type { ResearchRequirement } from "@deepresearch/contracts";

const GLOBAL_SOURCE_PUBLICATION_RULE = /(?:limit|restrict|confine)\s+(?:(?:all|the|this|your|our)\s+)?(?:research|survey|review|report)|(?:use|include|cite)\s+only|all\s+(?:cited\s+)?(?:sources?|stud(?:y|ies)|papers?|literature|academic\s+perspectives?)|throughout\s+the\s+(?:research|survey|review|report)|(?:(?:the|this|entire|overall)\s+report|report\s+content|(?:overall|entire)\s+(?:research|survey|review))[^.!?\n]{0,100}(?:based\s+on\s+)?publicly\s+available\s+(?:research(?:\s+results?)?|literature|stud(?:y|ies)|papers?|sources?)|(?:本次|本研究|本报告|全文)[^。！？\n]{0,30}(?:仅限|限制|不得超过)|(?:所有|全部|仅限)(?:引用的|纳入的)?(?:来源|研究|文献|论文|学术观点)/iu;
const MONTH_NAME = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const QUALIFIED_YEAR = "(?:(?:early|mid(?:dle)?|late)\\s*[-–—]?\\s*(?:19|20)\\d{2}|(?:beginning|start|end)\\s+of\\s+(?:the\\s+)?(?:19|20)\\d{2}|q[1-4]\\s+(?:19|20)\\d{2}|(?:first|second|third|fourth)\\s+quarter\\s+(?:of\\s+)?(?:19|20)\\d{2}|(?:first|second)\\s+half\\s+(?:of\\s+)?(?:19|20)\\d{2}|h[12]\\s+(?:19|20)\\d{2})";
const CHINESE_QUALIFIED_YEAR = "(?:19|20)\\d{2}\\s*年\\s*(?:初|中期|第一季度|第二季度|第三季度|第四季度|上半年|年中|下半年|年底|年末)";
const GLOBAL_DATE = `(?:${MONTH_NAME}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+(?:19|20)\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_NAME}(?:,)?\\s+(?:19|20)\\d{2}|${MONTH_NAME}\\s+(?:19|20)\\d{2}|${QUALIFIED_YEAR}|${CHINESE_QUALIFIED_YEAR}|(?:19|20)\\d{2}(?:[-/]\\d{1,2}(?:[-/]\\d{1,2})?)?)`;
const GLOBAL_TEMPORAL_RULE = new RegExp([
  `(?:(?:the|this|overall|entire)\\s+)?report[^.!?\\n]{0,180}(?:time\\s+(?:range|window)|cutoff|as\\s+of|(?:through|up\\s+to)\\s+(?:the\\s+end\\s+of\\s+)?${GLOBAL_DATE})`,
  `(?:overall|entire)\\s+(?:research|survey|review)[^.!?\\n]{0,60}(?:cutoff|as\\s+of|through\\s+(?:the\\s+end\\s+of\\s+)?${GLOBAL_DATE})`,
  `(?:report\\s+content|both\\s+tables|all\\s+(?:included\\s+)?technologies|technologies\\s+included\\s+in\\s+(?:the\\s+report|both\\s+tables))[^.!?\\n]{0,100}(?:limit(?:ed)?|restrict(?:ed)?|publicly\\s+available|released|introduced)?[^.!?\\n]{0,40}(?:before|prior\\s+to|through|up\\s+to|as\\s+of|no\\s+later\\s+than)\\s+${GLOBAL_DATE}`,
  `(?:focus(?:ing)?|concentrat(?:e|ing))\\s+(?:primarily|mainly|chiefly)\\s+on\\s+(?:discoveries|findings|events|developments|research|evidence)[^.!?\\n]{0,40}(?:before|prior\\s+to|through|up\\s+to|as\\s+of)\\s+${GLOBAL_DATE}`,
  "(?:报告|本研究|本次调研|本综述)[^。！？\\n]{0,40}(?:时间范围|时间窗口|截至|截止|不晚于)[^。！？\\n]{0,30}(?:19|20)\\d{2}",
  "(?:报告内容|两张表|全部(?:纳入|收录)?(?:技术|资料))[^。！？\\n]{0,60}(?:仅限|限制|公开|发布|截至|截止|早于|之前)[^。！？\\n]{0,30}(?:19|20)\\d{2}",
  `(?:请)?以\\s*${GLOBAL_DATE}\\s*(?:之前|以前|前|截至)?\\s*的?(?:信息|资料|研究|文献|数据)[^。！？\\n]{0,20}为准`,
].join("|"), "iu");

export function isGlobalSourcePublicationText(value: string): boolean {
  return GLOBAL_SOURCE_PUBLICATION_RULE.test(value);
}

export function isGlobalTemporalText(value: string): boolean {
  return isGlobalSourcePublicationText(value) || GLOBAL_TEMPORAL_RULE.test(value);
}

export function isGlobalSourcePublicationRequirement(requirement: ResearchRequirement): boolean {
  return requirement.temporalScope?.basis === "source_publication"
    && explicitTemporalTexts(requirement).some(isGlobalSourcePublicationText);
}

export function isGlobalTemporalRequirement(requirement: ResearchRequirement): boolean {
  if (!requirement.temporalScope) return false;
  return isGlobalSourcePublicationRequirement(requirement)
    || explicitTemporalTexts(requirement).some((value) => GLOBAL_TEMPORAL_RULE.test(value));
}

function explicitTemporalTexts(requirement: ResearchRequirement): string[] {
  return [
    requirement.description,
    ...requirement.successCriteria.filter((criterion) => !/^(?:the\s+(?:final\s+)?report\s+explicitly\s+(?:answers?|addresses?)|报告明确(?:回答|处理))\s*:/iu.test(criterion.trim())),
  ];
}
