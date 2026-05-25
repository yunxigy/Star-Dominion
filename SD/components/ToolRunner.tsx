import React, { createContext, useContext, useState, Suspense } from 'react';
import { getToolById } from '../tools/registry';
import { BaseModal } from './BaseModal';
import * as Icons from 'lucide-react';

interface ToolRunnerContextType {
  openTool: (id: string) => void;
  closeTool: () => void;
}

const ToolRunnerContext = createContext<ToolRunnerContextType>({
  openTool: () => {},
  closeTool: () => {},
});

export const useToolRunner = () => useContext(ToolRunnerContext);

const COLOR_MAP: Record<string, { text: string; border: string; bg: string }> = {
  red:     { text: 'text-red-400',     border: 'border-red-500/30',     bg: 'bg-red-500/5' },
  emerald: { text: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/5' },
  violet:  { text: 'text-violet-400',  border: 'border-violet-500/30',  bg: 'bg-violet-500/5' },
  amber:   { text: 'text-amber-400',   border: 'border-amber-500/30',   bg: 'bg-amber-500/5' },
  cyan:    { text: 'text-cyan-400',    border: 'border-cyan-500/30',    bg: 'bg-cyan-500/5' },
};

export const ToolRunnerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeToolId, setActiveToolId] = useState<string | null>(null);

  const openTool = (id: string) => setActiveToolId(id);
  const closeTool = () => setActiveToolId(null);

  const tool = activeToolId ? getToolById(activeToolId) : null;
  const IconComp = tool ? ((Icons as any)[tool.icon] || Icons.Star) : null;
  const colors = tool ? (COLOR_MAP[tool.color] || COLOR_MAP.violet) : COLOR_MAP.violet;

  return (
    <ToolRunnerContext.Provider value={{ openTool, closeTool }}>
      {children}

      {tool && (
        <BaseModal
          isOpen={true}
          onClose={closeTool}
          title={tool.name}
          icon={IconComp ? <IconComp className="w-6 h-6" /> : null}
          colorClass={colors.text}
          borderColor={colors.border}
          headerBg={colors.bg}
        >
          <Suspense fallback={
            <div className="flex items-center justify-center p-12">
              <div className="animate-spin w-8 h-8 border-2 border-slate-600 border-t-slate-300 rounded-full" />
            </div>
          }>
            <tool.component onClose={closeTool} />
          </Suspense>
        </BaseModal>
      )}
    </ToolRunnerContext.Provider>
  );
};
