import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { socialAnxietyDefinition } from './assessment/definitions/legacyDefinitions';

const SocialAnxietyTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={socialAnxietyDefinition} onClose={onClose} />
);

export default SocialAnxietyTest;
