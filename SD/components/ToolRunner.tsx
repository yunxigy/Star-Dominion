import React, { createContext, useContext, useState, Suspense, Component, type ReactNode } from 'react';
import { getToolById } from '../tools/registry';
import { BaseModal } from './BaseModal';
import { getIcon } from '../lib/iconMap';

class ToolErrorBoundary extends Component<{ children: ReactNode; onClose: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 text-center">
          <p className="text-red-400 mb-3">工具加载失败</p>
          <p className="text-sm text-slate-500 mb-4">{this.state.error.message}</p>
          <button onClick={() => { this.setState({ error: null }); this.props.onClose(); }}
            className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm">关闭</button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface ToolRunnerContextType {
  openTool: (id: string) => void;
  closeTool: () => void;
}

const ToolRunnerContext = createContext<ToolRunnerContextType>({
  openTool: () => {},
  closeTool: () => {},
});

export const useToolRunner = () => useContext(ToolRunnerContext);

const COLOR_MAP: Record<'red' | 'emerald' | 'violet' | 'amber' | 'cyan' | 'pink' | 'blue' | 'lime', { text: string; border: string; bg: string }> = {
  red:     { text: 'text-red-400',     border: 'border-red-500/30',     bg: 'bg-red-500/5' },
  emerald: { text: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/5' },
  violet:  { text: 'text-violet-400',  border: 'border-violet-500/30',  bg: 'bg-violet-500/5' },
  amber:   { text: 'text-amber-400',   border: 'border-amber-500/30',   bg: 'bg-amber-500/5' },
  cyan:    { text: 'text-cyan-400',    border: 'border-cyan-500/30',    bg: 'bg-cyan-500/5' },
  pink:    { text: 'text-pink-400',    border: 'border-pink-500/30',    bg: 'bg-pink-500/5' },
  blue:    { text: 'text-blue-400',    border: 'border-blue-500/30',    bg: 'bg-blue-500/5' },
  lime:    { text: 'text-lime-400',    border: 'border-lime-500/30',    bg: 'bg-lime-500/5' },
};

export const ToolRunnerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeToolId, setActiveToolId] = useState<string | null>(null);

  const openTool = (id: string) => setActiveToolId(id);
  const closeTool = () => setActiveToolId(null);

  const tool = activeToolId ? getToolById(activeToolId) : null;
  const IconComp = tool ? getIcon(tool.icon) : null;
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
          <ToolErrorBoundary onClose={closeTool}>
            <Suspense fallback={
              <div className="flex items-center justify-center p-12">
                <div className="animate-spin w-8 h-8 border-2 border-slate-600 border-t-slate-300 rounded-full" />
              </div>
            }>
              <tool.component onClose={closeTool} />
            </Suspense>
          </ToolErrorBoundary>
        </BaseModal>
      )}
    </ToolRunnerContext.Provider>
  );
};
