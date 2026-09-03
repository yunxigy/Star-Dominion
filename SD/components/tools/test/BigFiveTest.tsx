import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { bigFiveDefinition } from './assessment/definitions/legacyDefinitions';

const BigFiveTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={bigFiveDefinition} onClose={onClose} />
);

export default BigFiveTest;
