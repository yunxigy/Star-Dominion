import React, { Suspense, Component, type ReactNode, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { X, Loader2, Shield, HelpCircle, ArrowRight, BookOpen, Lightbulb } from 'lucide-react';
import { getToolById, getToolsByCategory, CATEGORIES } from '../tools/registry';
import { getIcon } from '../lib/iconMap';

class ToolErrorBoundary extends Component<
  { children: ReactNode; toolName: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  private getErrorHint(error: Error): string {
    const msg = error.message.toLowerCase();
    if (msg.includes('loading chunk') || msg.includes('failed to fetch dynamically imported module')) {
      return '这通常是网络问题或资源文件缺失。请检查网络连接后重试。';
    }
    if (msg.includes('cannot find module') || msg.includes('is not a function')) {
      return '工具依赖可能缺失，请联系管理员或刷新页面重试。';
    }
    return '工具运行时出现错误，请重试或联系管理员。';
  }

  render() {
    if (this.state.error) {
      const isChunkError = this.state.error.message.toLowerCase().includes('loading chunk') ||
        this.state.error.message.toLowerCase().includes('dynamically imported module');
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center p-8">
            <div className="text-red-400 text-5xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold text-white mb-2">{this.props.toolName} 加载失败</h2>
            <p className="text-slate-400 mb-2 text-sm max-w-md mx-auto">{this.getErrorHint(this.state.error)}</p>
            <p className="text-slate-600 text-xs mb-6 font-mono max-w-md mx-auto break-all">{this.state.error.message}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  this.setState({ error: null });
                  if (isChunkError) window.location.reload();
                }}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
              >
                {isChunkError ? '刷新页面' : '重试'}
              </button>
              <button
                onClick={() => window.close()}
                className="px-6 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors"
              >
                关闭窗口
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// 工具使用说明映射
const TOOL_USAGE: Record<string, { steps: string[]; tips: string[] }> = {
  'merge-pdf': {
    steps: ['点击上传区域选择多个PDF文件', '拖拽调整文件顺序', '点击"合并"按钮', '下载合并后的PDF文件'],
    tips: ['支持同时合并多个PDF文件', '合并后会保留原始PDF的质量', '文件顺序会影响最终合并结果']
  },
  'compress-pdf': {
    steps: ['上传需要压缩的PDF文件', '选择压缩质量（低/中/高）', '点击"压缩"按钮', '下载压缩后的文件'],
    tips: ['压缩质量越高，文件越大', '大部分PDF可以压缩30-70%', '扫描件PDF压缩效果更明显']
  },
  'pdf-to-image': {
    steps: ['上传PDF文件', '选择输出格式（PNG/JPG）', '选择图片质量', '点击转换并下载'],
    tips: ['每页PDF会生成一张图片', 'PNG格式质量更高但文件更大', '适合需要在图片编辑器中处理PDF内容']
  },
  'compress-image': {
    steps: ['上传图片文件', '调整压缩质量滑块', '预览压缩效果', '下载压缩后的图片'],
    tips: ['支持JPG、PNG、WebP格式', '压缩质量80%通常是最佳平衡点', '可以批量压缩多张图片']
  },
  'resize-image': {
    steps: ['上传图片文件', '输入目标宽度和高度', '选择是否保持比例', '点击调整并下载'],
    tips: ['勾选"保持比例"可避免图片变形', '支持像素和百分比两种模式', '缩小图片不会影响质量']
  },
  'crop-image': {
    steps: ['上传图片文件', '拖拽选择裁剪区域', '调整裁剪框大小', '点击裁剪并下载'],
    tips: ['支持自由裁剪和固定比例裁剪', '可以拖拽裁剪框移动位置', '裁剪后图片质量不变']
  },
  'json-format': {
    steps: ['在输入框粘贴JSON数据', '点击"格式化"按钮', '查看格式化结果', '点击复制按钮复制结果'],
    tips: ['支持自动检测JSON语法错误', '格式化会自动缩进和换行', '支持嵌套层级很深的JSON']
  },
  'qr-code-generator': {
    steps: ['输入文本或网址', '选择二维码尺寸', '选择纠错级别', '生成并下载二维码'],
    tips: ['纠错级别越高越容易扫描', '网址需要包含http://或https://', '支持自定义二维码颜色']
  },
  'bmi-calculator': {
    steps: ['输入身高（厘米）', '输入体重（公斤）', '点击"计算"按钮', '查看BMI值和健康建议'],
    tips: ['BMI正常范围：18.5-24.9', 'BMI仅供参考，不适用于运动员', '建议结合体脂率综合评估']
  },
  'text-translate': {
    steps: ['输入要翻译的文本', '选择源语言和目标语言', '点击"翻译"按钮', '查看翻译结果并复制'],
    tips: ['支持中英日韩等多种语言', '翻译结果可一键复制', '长文本翻译可能需要几秒钟']
  },
  'ocr-recognition': {
    steps: ['上传包含文字的图片', '选择识别语言', '点击"开始识别"按钮', '查看识别结果并复制'],
    tips: ['图片清晰度越高识别越准确', '支持中文、英文、日文等语言', '识别结果可编辑和导出']
  },
  'grammar-check': {
    steps: ['输入要检查的文本', '选择检查语言', '点击"检查语法"按钮', '查看错误提示和修改建议'],
    tips: ['支持中文和英文语法检查', '红色标记表示有错误', '点击建议可直接替换']
  },
  'text-to-speech': {
    steps: ['输入要朗读的文本', '选择语音和语速', '点击"播放"按钮', '可以暂停、继续或停止'],
    tips: ['支持多种语音选择', '可以调整语速和音调', '使用浏览器内置语音引擎']
  },
  'word-count': {
    steps: ['输入或粘贴文本', '实时查看统计数据', '查看字数、词数、行数', '查看预估阅读时间'],
    tips: ['支持中英文混合统计', '阅读时间按中文400字/分钟计算', '可以统计段落数和字符数']
  },
  'case-converter': {
    steps: ['输入要转换的文本', '选择转换类型', '查看转换结果', '复制转换后的文本'],
    tips: ['支持全部大写、全部小写', '支持首字母大写、句首大写', '支持大小写反转']
  },
  'text-diff': {
    steps: ['在左侧输入原始文本', '在右侧输入对比文本', '自动显示差异结果', '绿色为新增，红色为删除'],
    tips: ['逐行对比文本差异', '支持交换两侧文本', '统计新增和删除行数']
  },
  'text-summarize': {
    steps: ['输入要提取摘要的文本', '选择摘要比例（20%/30%/50%）', '点击"生成摘要"', '查看摘要结果和统计'],
    tips: ['摘要比例越低越精简', '基于句子权重的智能提取', '显示原文和摘要的字数对比']
  },
};

export default function ToolWindow() {
  const { toolId } = useParams<{ toolId: string }>();

  const tool = toolId ? getToolById(toolId) : null;

  // 获取同分类的其他工具
  const relatedTools = useMemo(() => {
    if (!tool) return [];
    return getToolsByCategory(tool.category)
      .filter(t => t.id !== tool.id)
      .slice(0, 6);
  }, [tool]);

  // 获取分类信息
  const category = useMemo(() => {
    if (!tool) return null;
    return CATEGORIES.find(c => c.id === tool.category);
  }, [tool]);

  // 获取使用说明
  const usage = tool ? TOOL_USAGE[tool.id] : null;

  if (!tool) {
    return (
      <div className="min-h-screen mesh-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-slate-400 text-5xl mb-4">🔍</div>
          <h2 className="text-xl font-bold text-white mb-2">工具未找到</h2>
          <p className="text-slate-400 mb-4">ID: {toolId}</p>
          <button
            onClick={() => window.close()}
            className="px-6 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600"
          >
            关闭窗口
          </button>
        </div>
      </div>
    );
  }

  const IconComponent = getIcon(tool.icon);

  const COLOR_MAP: Record<string, { text: string; bg: string; gradient: string }> = {
    red: { text: 'text-red-400', bg: 'bg-red-500/10', gradient: 'from-red-600 to-rose-600' },
    emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', gradient: 'from-emerald-600 to-teal-600' },
    violet: { text: 'text-violet-400', bg: 'bg-violet-500/10', gradient: 'from-violet-600 to-purple-600' },
    amber: { text: 'text-amber-400', bg: 'bg-amber-500/10', gradient: 'from-amber-600 to-orange-600' },
    cyan: { text: 'text-cyan-400', bg: 'bg-cyan-500/10', gradient: 'from-cyan-600 to-sky-600' },
    pink: { text: 'text-pink-400', bg: 'bg-pink-500/10', gradient: 'from-pink-600 to-rose-600' },
    blue: { text: 'text-blue-400', bg: 'bg-blue-500/10', gradient: 'from-blue-600 to-indigo-600' },
    lime: { text: 'text-lime-400', bg: 'bg-lime-500/10', gradient: 'from-lime-600 to-green-600' },
    indigo: { text: 'text-indigo-400', bg: 'bg-indigo-500/10', gradient: 'from-indigo-600 to-blue-600' },
  };

  const colors = COLOR_MAP[tool.color] || COLOR_MAP.violet;

  return (
    <div className="min-h-screen mesh-bg flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 glass-sidebar border-b border-white/5">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <div className={`p-2.5 rounded-xl bg-gradient-to-br ${tool.gradient} shadow-lg`}>
              <IconComponent className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className={`text-xl font-bold ${colors.text}`}>
                {tool.name}
              </h1>
              <p className="text-sm text-slate-400">
                {tool.description}
              </p>
            </div>
          </div>
          <button
            onClick={() => window.close()}
            className="p-2 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            title="关闭窗口"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6">
          {/* Tool Component */}
          <div className="glass-card rounded-2xl p-6 mb-6">
            <ToolErrorBoundary toolName={tool.name}>
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                      <Loader2 className="w-10 h-10 text-blue-400 animate-spin mx-auto mb-4" />
                      <p className="text-slate-400">加载中...</p>
                    </div>
                  </div>
                }
              >
                <tool.component onClose={() => window.close()} />
              </Suspense>
            </ToolErrorBoundary>
          </div>

          {/* Usage Guide */}
          {usage && (
            <div className="glass-card rounded-2xl p-6 mb-6">
              <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-blue-400" />
                使用说明
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Steps */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                    <HelpCircle className="w-4 h-4" />
                    使用步骤
                  </h3>
                  <ol className="space-y-2">
                    {usage.steps.map((step, index) => (
                      <li key={index} className="flex items-start gap-3 text-sm text-slate-400">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Tips */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4" />
                    使用技巧
                  </h3>
                  <ul className="space-y-2">
                    {usage.tips.map((tip, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-slate-400">
                        <span className="text-yellow-400 mt-1">•</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Related Tools */}
          {relatedTools.length > 0 && (
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <ArrowRight className="w-5 h-5 text-purple-400" />
                相关工具
                {category && (
                  <span className="text-sm font-normal text-slate-400">
                    ({category.name})
                  </span>
                )}
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {relatedTools.map(relatedTool => {
                  const RelatedIcon = getIcon(relatedTool.icon);
                  return (
                    <a
                      key={relatedTool.id}
                      href={`/tool/${relatedTool.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all group"
                    >
                      <div className={`p-2 rounded-lg bg-gradient-to-br ${relatedTool.gradient} shadow-lg shrink-0`}>
                        <RelatedIcon className="w-4 h-4 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-white group-hover:text-blue-300 transition-colors truncate">
                          {relatedTool.name}
                        </h3>
                        <p className="text-xs text-slate-500 truncate">
                          {relatedTool.description}
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 shrink-0" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="sticky bottom-0 glass-sidebar border-t border-white/5 px-6 py-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <Shield className="w-3 h-3" />
            <span>纯前端处理 - 数据不会上传到服务器</span>
          </div>
          <a href="/" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors">
            逐梦工具箱
          </a>
        </div>
      </footer>
    </div>
  );
}
