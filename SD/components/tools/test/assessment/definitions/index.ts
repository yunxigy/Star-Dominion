import type { AssessmentDefinition } from '../types';

export const ASSESSMENT_DEFINITIONS: Record<string, AssessmentDefinition> = {};

export const getAssessmentDefinition = (id: string) => ASSESSMENT_DEFINITIONS[id];
