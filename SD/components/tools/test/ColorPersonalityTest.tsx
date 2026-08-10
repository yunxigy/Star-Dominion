import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { colorPersonalityDefinition } from './assessment/definitions/colorPersonality';

const ColorPersonalityTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={colorPersonalityDefinition} onClose={onClose} />
);

export default ColorPersonalityTest;
