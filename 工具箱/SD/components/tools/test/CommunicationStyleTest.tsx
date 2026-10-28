import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { communicationStyleDefinition } from './assessment/definitions/communicationStyle';

const CommunicationStyleTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={communicationStyleDefinition} onClose={onClose} />
);
export default CommunicationStyleTest;
