import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { procrastinationDefinition } from './assessment/definitions/legacyDefinitions';

const ProcrastinationTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={procrastinationDefinition} onClose={onClose} />
);

export default ProcrastinationTest;
