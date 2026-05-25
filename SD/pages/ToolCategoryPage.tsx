import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import * as Icons from 'lucide-react';
import { getToolsByCategory, CATEGORIES } from '../tools/registry';
import { useToolRunner } from '../components/ToolRunner';

export const ToolCategoryPage: React.FC = () => {
  const { categoryId } = useParams<{ categoryId: string }>();
  const { openTool } = useToolRunner();

  const cat = CATEGORIES.find(c => c.id === categoryId);
  const tools = categoryId ? getToolsByCategory(categoryId) : [];

  if (!cat) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-400 text-lg">分类不存在</p>
        <Link to="/gj" className="text-cyan-400 hover:underline mt-4 inline-block">返回工具箱</Link>
      </div>
    );
  }

  const CatIcon = (Icons as any)[cat.icon] || Icons.Star;

  return (
    <div>
      {/* Hero */}
      <div className="mb-10 flex items-center gap-4">
        <Link to="/gj" className="text-slate-400 hover:text-white transition-colors">
          <Icons.ArrowLeft className="w-5 h-5" />
        </Link>
        <div className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${cat.gradient} shadow-lg`}>
          <CatIcon className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white">{cat.name}</h1>
          <p className="text-slate-400">{cat.description}</p>
        </div>
      </div>

      {/* Tool grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {tools.map((tool, index) => {
          const ToolIcon = (Icons as any)[tool.icon] || Icons.Star;
          return (
            <motion.div
              key={tool.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <button
                onClick={() => openTool(tool.id)}
                className="w-full text-left group relative p-5 rounded-2xl border border-slate-700/50 bg-slate-900/40 backdrop-blur-sm overflow-hidden transition-all duration-500 hover:border-slate-500/50 hover:shadow-[0_0_30px_var(--glow)] hover:-translate-y-1"
                style={{ '--glow': tool.glow } as React.CSSProperties}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${tool.gradient} opacity-0 group-hover:opacity-[0.08] transition-opacity duration-500`} />
                <div className={`relative mb-3 inline-flex p-2.5 rounded-xl bg-gradient-to-br ${tool.gradient} shadow-lg`}>
                  <ToolIcon className="w-6 h-6 text-white" />
                </div>
                <h3 className="relative text-lg font-bold text-slate-100 group-hover:text-white transition-colors mb-1">
                  {tool.name}
                </h3>
                <p className="relative text-sm text-slate-400 group-hover:text-slate-300 transition-colors">
                  {tool.description}
                </p>
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default ToolCategoryPage;
