import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Shield, Zap, Globe } from 'lucide-react';
import { CATEGORIES, TOOLS, getToolsByCategory } from '../tools/registry';
import { getIcon } from '../lib/iconMap';
import { ToolLink } from '../components/ToolLink';
import { CATEGORY_CONTENT } from '../seo/categoryContent';
import { PageSeo } from '../components/PageSeo';
import { buildCategoryMetadata } from '../seo/pageMetadata';
import { TOOL_CARD_SURFACE_CLASS } from './toolCardLayout';

export const CategoryPage: React.FC = () => {
  const { categoryId } = useParams<{ categoryId: string }>();

  const category = useMemo(() => CATEGORIES.find(c => c.id === categoryId), [categoryId]);
  const tools = useMemo(() => categoryId ? getToolsByCategory(categoryId) : [], [categoryId]);
  const desc = categoryId ? CATEGORY_CONTENT[categoryId] : undefined;

  if (!category || !desc) {
    return (
      <div className="min-h-screen mesh-bg flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#2f241b] mb-4">分类不存在</h1>
          <Link to="/gj" className="text-[#8a4b1f] hover:underline">返回工具箱</Link>
        </div>
      </div>
    );
  }

  const CatIcon = getIcon(category.icon);

  return (
    <>
      <PageSeo metadata={buildCategoryMetadata(category)} />
      <div className="min-h-screen mesh-bg">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <div className={`inline-flex p-4 rounded-2xl bg-gradient-to-br ${category.gradient} mb-6 shadow-lg shadow-[#9a5a28]/15`}>
            <CatIcon className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-5xl font-black text-[#2f241b] mb-4">{category.name}大全</h1>
           <p className="text-lg text-[#6d5a47] max-w-2xl mx-auto leading-relaxed">{desc.description}</p>
        </motion.div>

        {/* Features */}
        {desc.features.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
            {desc.features.map((f, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
                className="glass-card rounded-xl p-4 text-center">
                <p className="text-base font-semibold text-[#5c4937]">{f}</p>
              </motion.div>
            ))}
          </div>
        )}

        {/* Tools Grid */}
        <div className="mb-12">
          <h2 className="text-3xl font-black text-[#2f241b] mb-6">全部{category.name}工具</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {tools.map((tool, index) => {
              const ToolIcon = getIcon(tool.icon);
              return (
                <motion.div key={tool.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.05, 0.5) }}
                  className="h-full"
                >
                  <ToolLink
                    toolId={tool.id}
                    aria-label={`打开${tool.name}`}
                    className={TOOL_CARD_SURFACE_CLASS}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`tool-icon p-2.5 rounded-lg bg-gradient-to-br ${tool.gradient} shadow-lg shrink-0`}>
                        <ToolIcon className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-bold text-[#2f241b] group-hover:text-[#6f3714] transition-colors truncate">{tool.name}</h3>
                        <p className="text-base text-[#6d5a47] mt-1 line-clamp-2">{tool.description}</p>
                      </div>
                    </div>
                  </ToolLink>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* FAQ */}
        {desc.faq.length > 0 && (
          <div className="glass-card rounded-2xl p-8 mb-12">
            <h2 className="text-3xl font-black text-[#2f241b] mb-6">常见问题</h2>
            <div className="space-y-6">
              {desc.faq.map((faq, i) => (
                <div key={i} className="border-b border-[#dcc2a3] pb-6 last:border-0 last:pb-0">
                  <h3 className="text-lg font-bold text-[#2f241b] mb-2">{faq.question}</h3>
                  <p className="text-base text-[#6d5a47]">{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Back */}
        <div className="text-center">
          <Link to="/gj" className="inline-flex items-center gap-2 text-[#8a4b1f] hover:text-[#5f3214] transition-colors font-semibold">
            <ArrowRight className="w-4 h-4 rotate-180" />
            返回工具箱
          </Link>
        </div>
      </div>
      </div>
    </>
  );
};

export default CategoryPage;
