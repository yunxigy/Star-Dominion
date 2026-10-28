import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { coreValuesDefinition } from './assessment/definitions/coreValues';

const CoreValuesTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={coreValuesDefinition} onClose={onClose} />
);
export default CoreValuesTest;
