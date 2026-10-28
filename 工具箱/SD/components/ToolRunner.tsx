import React, { createContext, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { recordToolUse } from '../lib/userTools';

interface ToolRunnerContextType {
  openTool: (id: string) => void;
  closeTool: () => void;
}

const ToolRunnerContext = createContext<ToolRunnerContextType>({
  openTool: () => {},
  closeTool: () => {},
});

export const useToolRunner = () => useContext(ToolRunnerContext);

export const ToolRunnerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();

  const openTool = (id: string) => {
    recordToolUse(id);
    navigate(`/tool/${encodeURIComponent(id)}`);
  };

  const closeTool = () => {
    navigate(-1);
  };

  return (
    <ToolRunnerContext.Provider value={{ openTool, closeTool }}>
      {children}
    </ToolRunnerContext.Provider>
  );
};
