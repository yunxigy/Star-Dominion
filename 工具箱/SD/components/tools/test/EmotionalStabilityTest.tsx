import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { emotionalStabilityDefinition } from './assessment/definitions/legacyDefinitions';

const EmotionalStabilityTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={emotionalStabilityDefinition} onClose={onClose} />
);

export default EmotionalStabilityTest;
