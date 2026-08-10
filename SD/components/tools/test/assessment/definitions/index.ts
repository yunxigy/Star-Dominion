import type { AssessmentDefinition } from '../types';
import { animalPersonalityDefinition } from './animalPersonality';
import { colorPersonalityDefinition } from './colorPersonality';
import { communicationStyleDefinition } from './communicationStyle';
import { coreValuesDefinition } from './coreValues';
import { emotionalIntelligenceDefinition } from './emotionalIntelligence';
import { lifeEnergyDefinition } from './lifeEnergy';

export const ASSESSMENT_DEFINITIONS: Record<string, AssessmentDefinition> = {
  [animalPersonalityDefinition.id]: animalPersonalityDefinition,
  [colorPersonalityDefinition.id]: colorPersonalityDefinition,
  [communicationStyleDefinition.id]: communicationStyleDefinition,
  [emotionalIntelligenceDefinition.id]: emotionalIntelligenceDefinition,
  [coreValuesDefinition.id]: coreValuesDefinition,
  [lifeEnergyDefinition.id]: lifeEnergyDefinition,
};

export const getAssessmentDefinition = (id: string) => ASSESSMENT_DEFINITIONS[id];
