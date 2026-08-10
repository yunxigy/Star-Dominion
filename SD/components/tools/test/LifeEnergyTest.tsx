import type { FC } from 'react';
import { AssessmentRunner } from './assessment/AssessmentRunner';
import { lifeEnergyDefinition } from './assessment/definitions/lifeEnergy';

const LifeEnergyTest: FC<{ onClose: () => void }> = ({ onClose }) => (
  <AssessmentRunner definition={lifeEnergyDefinition} onClose={onClose} />
);

export default LifeEnergyTest;
