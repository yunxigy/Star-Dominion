import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { loveLanguageDefinition } from './assessment/definitions/legacyDefinitions';

const LoveLanguageTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={loveLanguageDefinition} onClose={onClose} />
);

export default LoveLanguageTest;
