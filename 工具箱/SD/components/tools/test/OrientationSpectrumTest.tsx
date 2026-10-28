import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { orientationSpectrumDefinition } from './assessment/definitions/orientationSpectrum';

const OrientationSpectrumTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={orientationSpectrumDefinition} onClose={onClose} />
);
export default OrientationSpectrumTest;
