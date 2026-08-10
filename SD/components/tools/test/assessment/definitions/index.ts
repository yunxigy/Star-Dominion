import type { AssessmentDefinition } from '../types';
import { animalPersonalityDefinition } from './animalPersonality';
import { colorPersonalityDefinition } from './colorPersonality';
import { communicationStyleDefinition } from './communicationStyle';
import { coreValuesDefinition } from './coreValues';
import { emotionalIntelligenceDefinition } from './emotionalIntelligence';
import { lifeEnergyDefinition } from './lifeEnergy';
import { intimacyBoundariesDefinition } from './intimacyBoundaries';
import { orientationSpectrumDefinition } from './orientationSpectrum';
import { romanticOrientationDefinition } from './romanticOrientation';

export const ASSESSMENT_DEFINITIONS: Record<string, AssessmentDefinition> = {
  [animalPersonalityDefinition.id]: animalPersonalityDefinition,
  [colorPersonalityDefinition.id]: colorPersonalityDefinition,
  [communicationStyleDefinition.id]: communicationStyleDefinition,
  [emotionalIntelligenceDefinition.id]: emotionalIntelligenceDefinition,
  [coreValuesDefinition.id]: coreValuesDefinition,
  [lifeEnergyDefinition.id]: lifeEnergyDefinition,
  [orientationSpectrumDefinition.id]: orientationSpectrumDefinition,
  [romanticOrientationDefinition.id]: romanticOrientationDefinition,
  [intimacyBoundariesDefinition.id]: intimacyBoundariesDefinition,
};

export const getAssessmentDefinition = (id: string) => ASSESSMENT_DEFINITIONS[id];
