import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { learningStyleDefinition } from './assessment/definitions/legacyDefinitions';

const LearningStyleTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={learningStyleDefinition} onClose={onClose} />
);

export default LearningStyleTest;
