import type { ResearchRequirement } from "@deepresearch/contracts";

/**
 * Structured policy is authoritative. The text fallback exists only for old
 * checkpoints and externally-built rubrics that predate failurePolicy.
 */
export function requirementFailurePolicy(requirement: ResearchRequirement): "degrade" | "block" {
  if (legacyNonWaivableConstraint(requirement.description)) return "block";
  if (requirement.failurePolicy === "block" || requirement.failurePolicy === "degrade") {
    return requirement.failurePolicy;
  }
  return "degrade";
}

export function isNonWaivableRequirement(requirement: ResearchRequirement): boolean {
  return requirementFailurePolicy(requirement) === "block";
}

export function inferRequirementFailurePolicy(
  declared: unknown,
  description: string,
): "degrade" | "block" {
  if (legacyNonWaivableConstraint(description)) return "block";
  if (declared === "block" || declared === "degrade") return declared;
  return "degrade";
}

export function requirementVisibility(requirement: ResearchRequirement): "reader" | "internal" {
  if (legacyNonWaivableConstraint(requirement.description)) return "internal";
  if (requirement.visibility === "reader" || requirement.visibility === "internal") return requirement.visibility;
  return "reader";
}

export function inferRequirementVisibility(declared: unknown, description: string): "reader" | "internal" {
  // Safety wins over malformed legacy/model output for a recognizable source prohibition.
  if (legacyNonWaivableConstraint(description)) return "internal";
  return declared === "internal" ? "internal" : "reader";
}

export function isReaderHiddenRequirement(requirement: ResearchRequirement): boolean {
  return requirementVisibility(requirement) === "internal";
}

function legacyNonWaivableConstraint(description: string): boolean {
  return /\b(?:do not|never|must not)\b.{0,80}\b(?:search|open|view|save|cite|quote|use)\b|\b(?:blocked|forbidden|source-guarded)\b.{0,80}\b(?:reference|source|article|url)|不得.{0,80}(?:搜索|打开|访问|保存|引用|使用)|禁止.{0,80}(?:来源|文章|网址|链接)/iu.test(description);
}
