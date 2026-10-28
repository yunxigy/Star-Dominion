import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { intimacyBoundariesDefinition } from './assessment/definitions/intimacyBoundaries';

const IntimacyBoundariesTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={intimacyBoundariesDefinition} onClose={onClose} />
);
export default IntimacyBoundariesTest;
