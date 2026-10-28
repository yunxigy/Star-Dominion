import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { animalPersonalityDefinition } from './assessment/definitions/animalPersonality';

const AnimalPersonalityTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={animalPersonalityDefinition} onClose={onClose} />
);

export default AnimalPersonalityTest;
