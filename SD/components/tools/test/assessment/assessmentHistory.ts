import type { AnswerMap, AssessmentVariantId } from './types';

export type AssessmentHistoryStatus = 'in-progress' | 'completed';

export interface AssessmentHistoryRecord {
  id: string;
  definitionId: string;
  variantId: AssessmentVariantId;
  status: AssessmentHistoryStatus;
  currentIndex: number;
  totalQuestions: number;
  answers: AnswerMap;
  resultLabel?: string;
  secondaryResultLabel?: string;
  mbtiType?: string;
  overallPercentage?: number;
  updatedAt: number;
}

export interface AssessmentProgressInput {
  definitionId: string;
  variantId: AssessmentVariantId;
  currentIndex: number;
  totalQuestions: number;
  answers: AnswerMap;
}

export interface AssessmentResultInput {
  definitionId: string;
  variantId: AssessmentVariantId;
  totalQuestions: number;
  answers: AnswerMap;
  resultLabel?: string;
  secondaryResultLabel?: string;
  mbtiType?: string;
  overallPercentage?: number;
}

export const ASSESSMENT_HISTORY_EVENT = 'sd-assessment-history-change';

const STORAGE_KEY = 'sd-assessment-history';
const MAX_HISTORY_RECORDS = 32;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isAnswerMap(value: unknown): value is AnswerMap {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((answer) => answer === null || typeof answer === 'string');
}

function isHistoryRecord(value: unknown): value is AssessmentHistoryRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<AssessmentHistoryRecord>;
  return typeof record.id === 'string'
    && typeof record.definitionId === 'string'
    && (record.variantId === 'quick' || record.variantId === 'complete')
    && (record.status === 'in-progress' || record.status === 'completed')
    && typeof record.currentIndex === 'number'
    && typeof record.totalQuestions === 'number'
    && isAnswerMap(record.answers)
    && typeof record.updatedAt === 'number';
}

function readRecords(): AssessmentHistoryRecord[] {
  if (!canUseStorage()) return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isHistoryRecord)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_HISTORY_RECORDS);
  } catch {
    return [];
  }
}

function writeRecords(records: readonly AssessmentHistoryRecord[]): void {
  if (!canUseStorage()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(
      [...records]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_HISTORY_RECORDS),
    ));
    window.dispatchEvent(new Event(ASSESSMENT_HISTORY_EVENT));
  } catch {
    // 隐私模式或浏览器禁用存储时，不影响测评当前流程。
  }
}

export function getAssessmentHistory(): AssessmentHistoryRecord[] {
  return readRecords();
}

export function getAssessmentProgress(
  definitionId: string,
  variantId: AssessmentVariantId,
): AssessmentHistoryRecord | null {
  return readRecords().find((record) => (
    record.status === 'in-progress'
    && record.definitionId === definitionId
    && record.variantId === variantId
  )) ?? null;
}

export function saveAssessmentProgress(input: AssessmentProgressInput): void {
  const records = readRecords().filter((record) => !(
    record.status === 'in-progress'
    && record.definitionId === input.definitionId
    && record.variantId === input.variantId
  ));
  const now = Date.now();
  writeRecords([
    ...records,
    {
      id: `progress:${input.definitionId}:${input.variantId}`,
      definitionId: input.definitionId,
      variantId: input.variantId,
      status: 'in-progress',
      currentIndex: Math.max(0, Math.floor(input.currentIndex)),
      totalQuestions: Math.max(1, Math.floor(input.totalQuestions)),
      answers: { ...input.answers },
      updatedAt: now,
    },
  ]);
}

export function removeAssessmentProgress(
  definitionId: string,
  variantId: AssessmentVariantId,
): void {
  writeRecords(readRecords().filter((record) => !(
    record.status === 'in-progress'
    && record.definitionId === definitionId
    && record.variantId === variantId
  )));
}

export function saveAssessmentResult(input: AssessmentResultInput): void {
  const records = readRecords().filter((record) => !(
    record.status === 'in-progress'
    && record.definitionId === input.definitionId
    && record.variantId === input.variantId
  ));
  const now = Date.now();
  writeRecords([
    {
      id: `completed:${input.definitionId}:${input.variantId}:${now}`,
      definitionId: input.definitionId,
      variantId: input.variantId,
      status: 'completed',
      currentIndex: input.totalQuestions,
      totalQuestions: Math.max(1, Math.floor(input.totalQuestions)),
      answers: { ...input.answers },
      resultLabel: input.resultLabel,
      secondaryResultLabel: input.secondaryResultLabel,
      mbtiType: input.mbtiType,
      overallPercentage: input.overallPercentage,
      updatedAt: now,
    },
    ...records,
  ]);
}

export function clearAssessmentHistory(): void {
  writeRecords([]);
}
