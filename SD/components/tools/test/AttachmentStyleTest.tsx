import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { attachmentStyleDefinition } from './assessment/definitions/legacyDefinitions';

const AttachmentStyleTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={attachmentStyleDefinition} onClose={onClose} />
);

export default AttachmentStyleTest;
