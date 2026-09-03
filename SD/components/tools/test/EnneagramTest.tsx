import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { enneagramDefinition } from './assessment/definitions/legacyDefinitions';

const EnneagramTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={enneagramDefinition} onClose={onClose} />
);

export default EnneagramTest;
