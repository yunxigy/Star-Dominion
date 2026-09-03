import type { AssessmentDefinition } from '../types';
import { animalPersonalityDefinition } from './animalPersonality';
import { colorPersonalityDefinition } from './colorPersonality';
import { communicationStyleDefinition } from './communicationStyle';
import {
  attachmentStyleDefinition,
  bigFiveDefinition,
  careerInterestDefinition,
  discDefinition,
  emotionalStabilityDefinition,
  enneagramDefinition,
  learningStyleDefinition,
  loveLanguageDefinition,
  procrastinationDefinition,
  socialAnxietyDefinition,
} from './legacyDefinitions';
import { coreValuesDefinition } from './coreValues';
import { brainPowerDefinition, intelligenceDefinition } from './cognitiveDefinitions';
import { emotionalIntelligenceDefinition } from './emotionalIntelligence';
import { lifeEnergyDefinition } from './lifeEnergy';
import { mbtiDefinition } from './mbti';
import { intimacyBoundariesDefinition } from './intimacyBoundaries';
import { orientationSpectrumDefinition } from './orientationSpectrum';
import { romanticOrientationDefinition } from './romanticOrientation';

export const ASSESSMENT_DEFINITIONS: Record<string, AssessmentDefinition> = {
  [bigFiveDefinition.id]: bigFiveDefinition,
  [enneagramDefinition.id]: enneagramDefinition,
  [attachmentStyleDefinition.id]: attachmentStyleDefinition,
  [loveLanguageDefinition.id]: loveLanguageDefinition,
  [careerInterestDefinition.id]: careerInterestDefinition,
  [discDefinition.id]: discDefinition,
  [procrastinationDefinition.id]: procrastinationDefinition,
  [socialAnxietyDefinition.id]: socialAnxietyDefinition,
  [learningStyleDefinition.id]: learningStyleDefinition,
  [emotionalStabilityDefinition.id]: emotionalStabilityDefinition,
  [animalPersonalityDefinition.id]: animalPersonalityDefinition,
  [colorPersonalityDefinition.id]: colorPersonalityDefinition,
  [communicationStyleDefinition.id]: communicationStyleDefinition,
  [emotionalIntelligenceDefinition.id]: emotionalIntelligenceDefinition,
  [coreValuesDefinition.id]: coreValuesDefinition,
  [lifeEnergyDefinition.id]: lifeEnergyDefinition,
  [mbtiDefinition.id]: mbtiDefinition,
  [orientationSpectrumDefinition.id]: orientationSpectrumDefinition,
  [romanticOrientationDefinition.id]: romanticOrientationDefinition,
  [intimacyBoundariesDefinition.id]: intimacyBoundariesDefinition,
  [brainPowerDefinition.id]: brainPowerDefinition,
  [intelligenceDefinition.id]: intelligenceDefinition,
};

export const getAssessmentDefinition = (id: string) => ASSESSMENT_DEFINITIONS[id];
