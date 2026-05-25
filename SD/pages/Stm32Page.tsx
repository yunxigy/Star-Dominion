import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Stm32ConsoleModal } from '../components/Stm32ConsoleModal';

export const Stm32Page: React.FC = () => {
  const navigate = useNavigate();

  return <Stm32ConsoleModal isOpen={true} onClose={() => navigate('/')} />;
};
