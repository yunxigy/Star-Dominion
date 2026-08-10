import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { emotionalIntelligenceDefinition } from './assessment/definitions/emotionalIntelligence';

const EmotionalIntelligenceTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={emotionalIntelligenceDefinition} onClose={onClose} />
);
export default EmotionalIntelligenceTest;
