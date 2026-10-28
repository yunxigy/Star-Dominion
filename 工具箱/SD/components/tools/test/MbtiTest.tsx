import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { mbtiDefinition } from './assessment/definitions/mbti';

const MbtiTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={mbtiDefinition} onClose={onClose} />
);

export default MbtiTest;
