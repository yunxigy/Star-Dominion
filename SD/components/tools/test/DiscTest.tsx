import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { discDefinition } from './assessment/definitions/legacyDefinitions';

const DiscTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={discDefinition} onClose={onClose} />
);

export default DiscTest;
