import React from 'react';
import { motion } from 'framer-motion';
import {
  Languages, Monitor, Eye, Brain, Cloud, Keyboard, Settings2,
  Download, ChevronRight, Zap, Shield, Globe, Cpu
} from 'lucide-react';

const colorClasses: Record<string, { bg: string; border: string; text: string }> = {
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-400' },
  violet: { bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400' },
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400' },
  pink: { bg: 'bg-pink-500/10', border: 'border-pink-500/20', text: 'text-pink-400' },
  red: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400' },
  lime: { bg: 'bg-lime-500/10', border: 'border-lime-500/20', text: 'text-lime-400' },
  indigo: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/20', text: 'text-indigo-400' },
};

const features = [
  {
    icon: Monitor,
    title: '实时屏幕翻译',
    desc: '自动捕获目标窗口，识别英文文本并实时覆盖翻译为中文，无需手动操作',
    color: 'emerald',
  },
  {
    icon: Eye,
    title: '透明覆盖层',
    desc: '基于 Win32 HwndSource 的全透明窗口，完全穿透鼠标点击，不影响原始操作',
    color: 'cyan',
  },
  {
    icon: Brain,
    title: 'PaddleOCR V4 引擎',
    desc: '采用飞桨 PaddleOCR V4 模型，支持文本检测、识别和方向分类，后台线程异步处理',
    color: 'violet',
  },
  {
    icon: Cloud,
    title: '百度翻译 API',
    desc: '批量翻译 + 换行合并优化，5000 条内存缓存，200ms 速率限制，高效低成本',
    color: 'blue',
  },
  {
    icon: Keyboard,
    title: '全局热键',
    desc: 'Ctrl+Alt+T 一键切换翻译开关，无需切换窗口，游戏 / 全屏场景下也能快速操作',
    color: 'amber',
  },
  {
    icon: Settings2,
    title: '灵活配置',
    desc: '字体大小 / 颜色 / 描边 / 透明度均可自定义，支持目标进程选择和刷新频率调节',
    color: 'pink',
  },
];

const techStack = [
  { name: '.NET 8', desc: '运行框架' },
  { name: 'WPF', desc: '桌面 UI' },
  { name: 'PaddleOCR', desc: 'OCR 引擎' },
  { name: 'OpenCV', desc: '图像处理' },
  { name: 'Baidu API', desc: '翻译服务' },
  { name: 'Win32 API', desc: '窗口覆盖' },
];

const steps = [
  {
    num: '01',
    title: '配置 API',
    desc: '在设置中填入百度翻译 API 的 App ID 和 Secret Key',
  },
  {
    num: '02',
    title: '选择目标窗口',
    desc: '从下拉列表中选择需要翻译的应用进程',
  },
  {
    num: '03',
    title: '开始翻译',
    desc: '按下 Ctrl+Alt+T 或点击系统托盘图标即可开启实时翻译',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export const TranslationPage: React.FC = () => {
  return (
    <div className="max-w-5xl mx-auto space-y-20 pb-20">
      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center pt-8 relative"
      >
        <div className="absolute inset-0 flex items-center justify-center -z-10 opacity-20">
          <div className="w-80 h-80 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full blur-[120px]" />
        </div>

        <div className="inline-flex p-5 rounded-2xl bg-gradient-to-br from-emerald-600/20 to-teal-600/20 border border-emerald-500/20 mb-8">
          <Languages className="w-16 h-16 text-emerald-400" />
        </div>

        <h1 className="text-5xl md:text-6xl font-bold mb-4">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300">
            ScreenTranslator
          </span>
        </h1>
        <p className="text-xl text-slate-300 mb-2">屏幕实时翻译工具</p>
        <p className="text-slate-400 max-w-lg mx-auto leading-relaxed mb-8">
          基于 PaddleOCR + 百度翻译 API，实时捕获窗口画面，识别英文文本并以透明覆盖层显示中文翻译。
          适用于游戏、文档、网页等各种场景。
        </p>

        <div className="flex items-center justify-center gap-4">
          <a
            href="#download"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:-translate-y-0.5"
          >
            <Download className="w-5 h-5" />
            下载程序
          </a>
          <a
            href="#features"
            className="inline-flex items-center gap-2 px-6 py-3.5 bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 hover:text-white rounded-xl font-medium transition-all border border-slate-700/50 hover:border-slate-600/50"
          >
            了解更多
            <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      </motion.section>

      {/* Features */}
      <section id="features">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          variants={containerVariants}
        >
          <motion.h2 variants={itemVariants} className="text-3xl font-bold text-center mb-3 text-slate-100">
            核心特性
          </motion.h2>
          <motion.p variants={itemVariants} className="text-center text-slate-400 mb-12">
            高性能 OCR + 翻译引擎，透明覆盖，零干扰体验
          </motion.p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  variants={itemVariants}
                  className="p-6 rounded-xl bg-slate-900/40 border border-slate-700/50 hover:border-slate-600/50 transition-all group hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/50"
                >
                  <div className={`inline-flex p-3 rounded-xl ${colorClasses[f.color]?.bg || 'bg-slate-500/10'} border ${colorClasses[f.color]?.border || 'border-slate-500/20'} mb-4 group-hover:scale-110 transition-transform`}>
                    <Icon className={`w-6 h-6 ${colorClasses[f.color]?.text || 'text-slate-400'}`} />
                  </div>
                  <h3 className="text-lg font-bold text-slate-100 mb-2">{f.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </section>

      {/* Tech Stack */}
      <motion.section
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-50px' }}
        variants={containerVariants}
      >
        <motion.h2 variants={itemVariants} className="text-3xl font-bold text-center mb-3 text-slate-100">
          技术栈
        </motion.h2>
        <motion.p variants={itemVariants} className="text-center text-slate-400 mb-12">
          现代化 .NET 技术栈 + 成熟的 AI 能力
        </motion.p>

        <div className="flex flex-wrap justify-center gap-4">
          {techStack.map((t) => (
            <motion.div
              key={t.name}
              variants={itemVariants}
              className="px-6 py-4 rounded-xl bg-slate-900/40 border border-slate-700/50 hover:border-cyan-500/30 transition-all text-center min-w-[120px]"
            >
              <div className="text-lg font-bold text-cyan-400 mb-1">{t.name}</div>
              <div className="text-xs text-slate-500">{t.desc}</div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* How to Use */}
      <motion.section
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-50px' }}
        variants={containerVariants}
      >
        <motion.h2 variants={itemVariants} className="text-3xl font-bold text-center mb-3 text-slate-100">
          快速开始
        </motion.h2>
        <motion.p variants={itemVariants} className="text-center text-slate-400 mb-12">
          三步即可开启屏幕实时翻译
        </motion.p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((s, i) => (
            <motion.div
              key={s.num}
              variants={itemVariants}
              className="relative p-6 rounded-xl bg-slate-900/40 border border-slate-700/50"
            >
              <div className="text-5xl font-black text-slate-800 mb-4 select-none">{s.num}</div>
              <h3 className="text-lg font-bold text-slate-100 mb-2">{s.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{s.desc}</p>
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-3 transform -translate-y-1/2 z-10">
                  <ChevronRight className="w-6 h-6 text-slate-600" />
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Highlights */}
      <motion.section
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-50px' }}
        variants={containerVariants}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
      >
        {[
          { icon: Zap, label: '1.5s 刷新间隔', desc: '高效实时' },
          { icon: Shield, label: '本地 OCR', desc: '隐私安全' },
          { icon: Globe, label: '多显示器支持', desc: '全屏适配' },
          { icon: Cpu, label: '智能缓存', desc: '5000条缓存' },
        ].map((h) => {
          const Icon = h.icon;
          return (
            <motion.div
              key={h.label}
              variants={itemVariants}
              className="flex items-center gap-4 p-5 rounded-xl bg-slate-900/40 border border-slate-700/50"
            >
              <Icon className="w-8 h-8 text-emerald-400 shrink-0" />
              <div>
                <div className="font-bold text-slate-200 text-sm">{h.label}</div>
                <div className="text-xs text-slate-500">{h.desc}</div>
              </div>
            </motion.div>
          );
        })}
      </motion.section>

      {/* Download */}
      <section id="download">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center p-10 rounded-2xl bg-gradient-to-b from-slate-900/60 to-slate-900/30 border border-emerald-500/20 relative overflow-hidden"
        >
          <div className="absolute inset-0 flex items-center justify-center -z-10 opacity-10">
            <div className="w-64 h-64 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full blur-[100px]" />
          </div>

          <Download className="w-12 h-12 text-emerald-400 mx-auto mb-5" />
          <h2 className="text-3xl font-bold text-slate-100 mb-3">下载 ScreenTranslator</h2>
          <p className="text-slate-400 mb-2">框架依赖版本，需要安装 .NET 8 Desktop Runtime</p>
          <p className="text-xs text-slate-500 mb-8">支持 Windows 10/11 x64 系统</p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="https://dotnet.microsoft.com/download/dotnet/8.0"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl font-medium transition-all border border-slate-700/50"
            >
              安装 .NET 8 Runtime
            </a>
          </div>

          <div className="mt-8 p-4 rounded-lg bg-slate-800/40 border border-slate-700/30 text-left max-w-md mx-auto">
            <p className="text-xs text-slate-500 mb-1 font-mono">百度翻译 API 申请：</p>
            <a
              href="https://fanyi-api.baidu.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              https://fanyi-api.baidu.com/
            </a>
            <p className="text-xs text-slate-500 mt-2">免费版支持 QPS 1，标准版支持更高并发</p>
          </div>
        </motion.div>
      </section>
    </div>
  );
};
