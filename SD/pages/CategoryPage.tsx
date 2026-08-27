import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Shield, Zap, Globe } from 'lucide-react';
import { CATEGORIES, TOOLS, getToolsByCategory } from '../tools/registry';
import { getIcon } from '../lib/iconMap';
import { ToolLink } from '../components/ToolLink';

const CATEGORY_DESCRIPTIONS: Record<string, { long: string; features: string[]; faq: { q: string; a: string }[] }> = {
  pdf: {
    long: '提供全面的 PDF 处理工具，包括合并、拆分、压缩、转图片、加水印、加密等功能。所有工具在浏览器本地处理，保障文件安全。',
    features: ['支持批量处理', '保留原始质量', '无需安装软件', '完全免费使用'],
    faq: [
      { q: 'PDF 工具是否安全？', a: '是的，所有 PDF 处理都在浏览器本地完成，文件不会上传到任何服务器。' },
      { q: '支持多大的 PDF 文件？', a: '建议单个文件不超过 100MB，过大的文件可能导致浏览器内存不足。' },
    ],
  },
  image: {
    long: '提供图片压缩、裁剪、改尺寸、加水印、Base64 转换、取色器等功能。支持 JPG、PNG、WebP 等常见格式。',
    features: ['实时预览效果', '批量处理支持', '保留 EXIF 信息', '多种输出格式'],
    faq: [
      { q: '压缩图片会降低质量吗？', a: '压缩是有损的，但 80% 质量通常肉眼无法分辨，可以大幅减小文件体积。' },
      { q: '支持哪些图片格式？', a: '支持 JPG、PNG、WebP、BMP、GIF 等常见格式，部分工具还支持 SVG 和 HEIC。' },
    ],
  },
  converter: {
    long: '提供 JPG、PNG、WebP、SVG、BMP、HEIC、ICO 等格式之间的相互转换，满足不同场景的格式需求。',
    features: ['支持 10+ 种格式', '批量转换', '保留透明通道', '自定义质量'],
    faq: [
      { q: '转换会损失质量吗？', a: '无损格式之间转换（如 PNG↔BMP）不会损失质量，有损格式转换可能有轻微损失。' },
    ],
  },
  dev: {
    long: '提供 JSON、XML、HTML、CSS、SQL 格式化，正则测试，时间戳转换，编码解码，哈希生成，二维码生成等开发者常用工具。',
    features: ['语法高亮', '实时校验', '一键复制', '支持多种格式'],
    faq: [
      { q: '格式化会修改数据内容吗？', a: '不会，格式化只改变代码的排版和缩进，不修改实际数据。' },
    ],
  },
  test: {
    long: '提供 MBTI、大五人格、九型人格、DISC、恋爱依恋类型、职业兴趣等专业心理测评工具。',
    features: ['专业测评量表', '详细结果分析', '性格/职业建议', '可分享结果'],
    faq: [
      { q: '测试结果准确吗？', a: '测试基于心理学量表设计，结果仅供参考，帮助了解自己的性格倾向。' },
      { q: '测试数据会保存吗？', a: '所有测试数据在浏览器本地处理，不会上传服务器。' },
    ],
  },
  tarot: {
    long: '提供每日塔罗、三张牌塔罗、星座配对、每日运势、生命灵数、梦境解析等塔罗星座工具。',
    features: ['每日更新运势', '多种牌阵', '详细解读', '可分享结果'],
    faq: [
      { q: '塔罗牌结果可信吗？', a: '塔罗牌是一种自我探索工具，结果仅供参考和娱乐。' },
    ],
  },
};

export const CategoryPage: React.FC = () => {
  const { categoryId } = useParams<{ categoryId: string }>();

  const category = useMemo(() => CATEGORIES.find(c => c.id === categoryId), [categoryId]);
  const tools = useMemo(() => categoryId ? getToolsByCategory(categoryId) : [], [categoryId]);
  const desc = CATEGORY_DESCRIPTIONS[categoryId || ''] || { long: '', features: [], faq: [] };

  if (!category) {
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
    <div className="min-h-screen mesh-bg">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <div className={`inline-flex p-4 rounded-2xl bg-gradient-to-br ${category.gradient} mb-6 shadow-lg shadow-[#9a5a28]/15`}>
            <CatIcon className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-5xl font-black text-[#2f241b] mb-4">{category.name}大全</h1>
          <p className="text-lg text-[#6d5a47] max-w-2xl mx-auto leading-relaxed">{desc.long || `提供${tools.length}个${category.name}工具，满足您的各种需求。`}</p>
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
                >
                  <ToolLink
                    toolId={tool.id}
                    aria-label={`打开${tool.name}`}
                    className="block w-full text-left group tool-card-enhanced glass-card rounded-2xl p-5"
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
                  <h3 className="text-lg font-bold text-[#2f241b] mb-2">{faq.q}</h3>
                  <p className="text-base text-[#6d5a47]">{faq.a}</p>
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
  );
};

export default CategoryPage;
