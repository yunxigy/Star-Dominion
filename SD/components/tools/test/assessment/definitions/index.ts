import type { AssessmentDefinition } from '../types';
import { animalPersonalityDefinition } from './animalPersonality';
import { colorPersonalityDefinition } from './colorPersonality';
import { lifeEnergyDefinition } from './lifeEnergy';

export const ASSESSMENT_DEFINITIONS: Record<string, AssessmentDefinition> = {
  [animalPersonalityDefinition.id]: animalPersonalityDefinition,
  [colorPersonalityDefinition.id]: colorPersonalityDefinition,
  [lifeEnergyDefinition.id]: lifeEnergyDefinition,
};

export const getAssessmentDefinition = (id: string) => ASSESSMENT_DEFINITIONS[id];
