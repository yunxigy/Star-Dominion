import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { intelligenceDefinition } from './assessment/definitions/cognitiveDefinitions';

const IntelligenceTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={intelligenceDefinition} onClose={onClose} />
);

export default IntelligenceTest;
