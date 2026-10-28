import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { careerInterestDefinition } from './assessment/definitions/legacyDefinitions';

const CareerInterestTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={careerInterestDefinition} onClose={onClose} />
);

export default CareerInterestTest;
