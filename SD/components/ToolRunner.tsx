import React, { createContext, useContext } from 'react';

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
  const openTool = (id: string) => {
    // 在新标签页中打开工具
    window.open(`/tool/${id}`, '_blank');
  };

  const closeTool = () => {
    // 新标签页模式下，closeTool 由 ToolWindow 组件内部处理
  };

  return (
    <ToolRunnerContext.Provider value={{ openTool, closeTool }}>
      {children}
    </ToolRunnerContext.Provider>
  );
};
