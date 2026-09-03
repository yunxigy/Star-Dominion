import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { brainPowerDefinition } from './assessment/definitions/cognitiveDefinitions';

const BrainPowerTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={brainPowerDefinition} onClose={onClose} />
);

export default BrainPowerTest;
