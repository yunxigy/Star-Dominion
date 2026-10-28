import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { romanticOrientationDefinition } from './assessment/definitions/romanticOrientation';

const RomanticOrientationTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={romanticOrientationDefinition} onClose={onClose} />
);
export default RomanticOrientationTest;
