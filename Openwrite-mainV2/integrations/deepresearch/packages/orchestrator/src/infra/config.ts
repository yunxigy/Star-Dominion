import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RuntimeProfile } from "@deepresearch/contracts";

export function loadDefaultRuntimeProfile(rootDir = process.cwd()): RuntimeProfile {
  const configPath = findConfigPath(rootDir);
  if (!configPath) return structuredClone(DEFAULT_RUNTIME_PROFILE);
  const raw = readFileSync(configPath, "utf8");
  return JSON.parse(raw) as RuntimeProfile;
}

export function mergeRuntimeProfile(base: RuntimeProfile, override?: Partial<RuntimeProfile>): RuntimeProfile {
  if (!override) return structuredClone(base);
  return {
    ...structuredClone(base),
    ...override,
    llm: { ...base.llm, ...override.llm },
    phases: { ...base.phases, ...override.phases },
    agents: { ...base.agents, ...override.agents },
    tools: { ...base.tools, ...override.tools },
    providers: { ...base.providers, ...override.providers },
    evidenceQuality: { ...base.evidenceQuality, ...override.evidenceQuality },
  };
}

function findConfigPath(startDir: string): string | undefined {
  let current = resolve(startDir);
  while (true) {
    const candidate = resolve(current, "configs/runtime/default.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

const DEFAULT_RUNTIME_PROFILE: RuntimeProfile = {
  hilMode: "auto_accept",
  artifactDir: "artifacts",
  reportFormat: "markdown",
  includeEvidenceIndex: true,
  traceLevel: "summary",
  evidenceQuality: {
    mode: "balanced",
    minSourcesPerLeaf: 2,
    minIndependentDomainsPerLeaf: 2,
    minPrimaryOrOfficialSourcesPerLeaf: 1,
    minAverageQualityScore: 0.6,
    requireFetchedSourcePerLeaf: true,
    minReportCitationCoverage: 0.8,
  },
  llm: {
    rubric: { model: "default", maxTokens: 6144, temperature: 0.2, timeoutMs: 60000 },
    scout: { model: "default", maxTokens: 6144, temperature: 0.3, timeoutMs: 90000 },
    architect: { model: "default", maxTokens: 6144, temperature: 0.2, timeoutMs: 60000 },
    evidence: { model: "default", maxTokens: 12288, temperature: 0.2, timeoutMs: 180000 },
    reflection: { model: "default", maxTokens: 8192, temperature: 0.2, timeoutMs: 120000 },
    structureReview: { model: "default", maxTokens: 8192, temperature: 0.2, timeoutMs: 120000 },
    report: { model: "default", maxTokens: 49152, temperature: 0.2, timeoutMs: 300000 },
    publishGate: { model: "default", maxTokens: 8192, temperature: 0.2, timeoutMs: 120000 },
  },
  phases: {
    parse: { enabled: true, contextTokenLimit: 4000 },
    rubric: { enabled: true, maxLlmCalls: 3, contextTokenLimit: 16000 },
    initRoot: { enabled: true, contextTokenLimit: 4000 },
    scout: { enabled: true, maxReactSteps: 24, maxSearchCalls: 8, maxFetchCalls: 8, contextTokenLimit: 24000, maxOutputItems: 6 },
    architectTree: { enabled: true, maxLlmCalls: 1, contextTokenLimit: 32000 },
    dispatchEvidence: { enabled: true, maxCycles: 72, maxParallelAgents: 48, maxConcurrentAgents: 8, contextTokenLimit: 64000, maxOutputItems: 24 },
    cycleReflection: { enabled: true, maxLlmCalls: 1, contextTokenLimit: 48000 },
    structureReview: { enabled: true, maxLlmCalls: 60, maxOutputItems: 60, contextTokenLimit: 48000 },
    completionGate: { enabled: true, maxCycles: 1, contextTokenLimit: 24000 },
    report: { enabled: true, maxLlmCalls: 240, maxConcurrentAgents: 4, contextTokenLimit: 192000 },
    publishGate: { enabled: true, maxCycles: 3, maxLlmCalls: 1, contextTokenLimit: 64000 },
  },
  agents: {
    evidence: {
      targetReactSteps: 12,
      maxReactSteps: 24,
      targetToolCalls: 11,
      maxToolCalls: 23,
      targetSearchCalls: 4,
      maxSearchCalls: 8,
      targetFetchCalls: 4,
      maxFetchCalls: 8,
      outputRepairAttempts: 2,
      allowToolEscalationRequest: false,
    },
    reflection: {
      targetReactSteps: 12,
      maxReactSteps: 24,
      targetToolCalls: 18,
      maxToolCalls: 36,
      outputRepairAttempts: 1,
      allowToolEscalationRequest: false,
    },
    structureReview: {
      targetReactSteps: 12,
      maxReactSteps: 24,
      targetToolCalls: 18,
      maxToolCalls: 36,
      outputRepairAttempts: 1,
      allowToolEscalationRequest: false,
    },
    writer: {
      targetReactSteps: 18,
      maxReactSteps: 36,
      targetToolCalls: 36,
      maxToolCalls: 72,
      targetFetchCalls: 16,
      maxFetchCalls: 32,
      outputRepairAttempts: 1,
      allowToolEscalationRequest: false,
    },
  },
  tools: {
    web_search: { topK: 20, timeoutMs: 45000, retry: 4 },
    fetch_page: { timeoutMs: 60000, maxChars: 60000, retry: 4 },
    report_source: { timeoutMs: 60000, maxChars: 120000, retry: 4 },
    save_knowledge_node: { timeoutMs: 5000, retry: 0 },
    link_evidence: { timeoutMs: 5000, retry: 0 },
    arxiv_search: { topK: 20, timeoutMs: 30000, retry: 2 },
  },
  providers: {
    default_llm: {
      maxCostUsd: 40,
      maxRequests: 8000,
      maxTotalTokens: 20_000_000,
      inputCostPerMillionTokensUsd: 2,
      outputCostPerMillionTokensUsd: 8,
      timeoutMs: 240000,
    },
    default_search: { maxRequests: 5000, costPerRequestUsd: 0.01 },
    default_fetch: { maxRequests: 10000 },
    episode: { maxCostUsd: 50, maxRequests: 20000, maxTotalTokens: 20_000_000 },
  },
  adaptiveBudget: {
    enabled: true,
    minDispatchCycles: 3,
    plateauWindow: 2,
    minKnowledgeNodeGain: 1,
    minEvidenceLinkGain: 1,
    minQualityScoreGain: 0.5,
  },
};
