import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ArrowRight, Zap, BarChart3, Shield, Clock, Calendar, Thermometer, Globe, Sparkles } from 'lucide-react';
import { useToolRunner } from '../components/ToolRunner';
import { CATEGORIES, TOOLS } from '../tools/registry';
import { getIcon } from '../lib/iconMap';

const HOT_TOOLS = [
  'merge-pdf', 'compress-image', 'json-format', 'bmi-calculator',
  'qr-code-generator', 'image-sharpness', 'daily-tarot', 'cps-test',
  'ocr-recognition', 'text-translate', 'grammar-check', 'word-count'
];

// 实时时钟组件
const RealTimeClock: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour12: false });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-4xl md:text-5xl font-mono font-bold text-white/90 tracking-wider">
        {formatTime(time)}
      </div>
      <div className="text-sm text-slate-400 flex items-center gap-2">
        <Calendar className="w-4 h-4" />
        {formatDate(time)}
      </div>
    </div>
  );
};

// 打字机效果组件
const TypewriterText: React.FC<{ texts: string[] }> = ({ texts }) => {
  const [displayText, setDisplayText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentText = texts[currentIndex];
    let timeout: NodeJS.Timeout;

    if (!isDeleting && displayText === currentText) {
      timeout = setTimeout(() => setIsDeleting(true), 2000);
    } else if (isDeleting && displayText === '') {
      setIsDeleting(false);
      setCurrentIndex((prev) => (prev + 1) % texts.length);
    } else {
      timeout = setTimeout(() => {
        setDisplayText(
          isDeleting
            ? currentText.substring(0, displayText.length - 1)
            : currentText.substring(0, displayText.length + 1)
        );
      }, isDeleting ? 50 : 100);
    }

    return () => clearTimeout(timeout);
  }, [displayText, currentIndex, isDeleting, texts]);

  return (
    <span className="text-emerald-400">
      {displayText}
      <span className="animate-pulse">|</span>
    </span>
  );
};

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { openTool } = useToolRunner();
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/gj?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const hotTools = HOT_TOOLS.map(id => TOOLS.find(t => t.id === id)).filter(Boolean);

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <section className="text-center py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* 实时时钟 */}
          <div className="mb-8">
            <RealTimeClock />
          </div>

          {/* 标题 */}
          <h1 className="text-5xl md:text-7xl font-bold mb-4">
            <span className="bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 bg-clip-text text-transparent">
              逐梦工具箱
            </span>
          </h1>

          {/* 打字机副标题 */}
          <p className="text-xl md:text-2xl text-slate-300 mb-8 h-10">
            <TypewriterText texts={[
              '100+ 免费在线工具，助力高效工作',
              '纯前端处理，数据安全不上传',
              'PDF、图片、开发、计算一应俱全',
              '持续更新，更多功能敬请期待'
            ]} />
          </p>

          {/* 搜索框 */}
          <form onSubmit={handleSearch} className="max-w-2xl mx-auto mb-10">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-emerald-600 to-cyan-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
              <div className="relative flex items-center search-bar-enhanced">
                <Search className="search-icon absolute left-4 text-slate-400 w-5 h-5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索你需要的工具..."
                  className="w-full pl-12 pr-24 py-4 bg-slate-900/80 rounded-2xl text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="absolute right-2 px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl hover:from-emerald-500 hover:to-teal-500 transition-all font-medium"
                >
                  搜索
                </button>
              </div>
            </div>
          </form>

          {/* 统计徽章 */}
          <div className="flex justify-center gap-4 flex-wrap">
            {[
              { icon: Sparkles, value: '128+', label: '在线工具', color: 'text-emerald-400' },
              { icon: BarChart3, value: '11', label: '工具分类', color: 'text-teal-400' },
              { icon: Shield, value: '100%', label: '免费使用', color: 'text-cyan-400' },
              { icon: Zap, value: '0', label: '数据上传', color: 'text-green-400' },
            ].map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + index * 0.1 }}
                className="stat-badge px-4 py-2.5"
              >
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
                <span className="font-bold text-white">{stat.value}</span>
                <span className="text-slate-400">{stat.label}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* 热门工具 */}
      <section>
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-emerald-500/10">
          <div className="p-2.5 rounded-lg bg-gradient-to-br from-amber-600 to-orange-600">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white">热门工具</h2>
          <span className="text-base text-slate-500">快速访问常用功能</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {hotTools.map((tool, index) => {
            if (!tool) return null;
            const IconComponent = getIcon(tool.icon);
            return (
              <motion.button
                key={tool.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => openTool(tool.id)}
                className="group tool-card-enhanced p-5 rounded-xl bg-white/5 border border-white/10"
              >
                <div className={`tool-icon inline-flex p-3 rounded-lg bg-gradient-to-br ${tool.gradient} mb-3`}>
                  <IconComponent className="w-6 h-6 text-white" />
                </div>
                <h3 className="tool-name text-base font-medium text-white truncate">
                  {tool.name}
                </h3>
                <p className="text-sm text-slate-400 mt-1.5 line-clamp-2">
                  {tool.description}
                </p>
              </motion.button>
            );
          })}
        </div>
      </section>

      {/* 工具分类 */}
      <section>
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-emerald-500/10">
          <div className="p-2.5 rounded-lg bg-gradient-to-br from-violet-600 to-purple-600">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white">工具分类</h2>
          <span className="text-base text-slate-500">按类别浏览所有工具</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {CATEGORIES.map((category, index) => {
            const IconComponent = getIcon(category.icon);
            const toolCount = TOOLS.filter(t => t.category === category.id).length;
            return (
              <motion.div
                key={category.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Link
                  to={`/gj?category=${category.id}`}
                  className="block tool-card-enhanced p-6 rounded-xl bg-white/5 border border-white/10 group"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-lg bg-gradient-to-br ${category.gradient} group-hover:scale-110 transition-transform`}>
                        <IconComponent className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-white group-hover:text-emerald-300 transition-colors">
                          {category.name}
                        </h3>
                        <span className="text-sm text-slate-500">{toolCount} 个工具</span>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" />
                  </div>
                  <p className="text-base text-slate-400 line-clamp-2">
                    {category.description}
                  </p>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* 广告位 */}
      <div id="ad-home-banner" className="my-8 text-center">
        {/* 广告位预留 */}
      </div>

      {/* 项目介绍 */}
      <section>
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-emerald-500/10">
          <div className="p-2.5 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600">
            <Globe className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white">项目作品</h2>
          <span className="text-base text-slate-500">探索更多功能</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              path: '/fy',
              title: '智创翻译',
              desc: '基于 PaddleOCR + 百度翻译 API 的屏幕实时翻译工具',
              gradient: 'from-emerald-600/20 to-teal-600/20',
              border: 'border-emerald-500/30 hover:border-emerald-400/50',
              textColor: 'group-hover:text-emerald-300',
              arrowColor: 'text-emerald-400'
            },
            {
              path: '/bp',
              title: '边坡上位机',
              desc: 'STM32 北斗边坡高精度定位监控系统',
              gradient: 'from-cyan-600/20 to-sky-600/20',
              border: 'border-cyan-500/30 hover:border-cyan-400/50',
              textColor: 'group-hover:text-cyan-300',
              arrowColor: 'text-cyan-400'
            },
            {
              path: '/ai',
              title: '网文智能体',
              desc: 'AI 自主长篇小说写作系统',
              gradient: 'from-violet-600/20 to-purple-600/20',
              border: 'border-violet-500/30 hover:border-violet-400/50',
              textColor: 'group-hover:text-violet-300',
              arrowColor: 'text-violet-400'
            },
            {
              path: '/wuwa/',
              title: 'AI 伴侣',
              desc: '多角色 AI 语音对话系统，支持语音克隆 TTS',
              gradient: 'from-pink-600/20 to-rose-600/20',
              border: 'border-pink-500/30 hover:border-pink-400/50',
              textColor: 'group-hover:text-pink-300',
              arrowColor: 'text-pink-400',
              external: true
            }
          ].map((project) => (
            project.external ? (
              <a
                key={project.path}
                href={project.path}
                target="_blank"
                rel="noopener noreferrer"
                className={`block p-7 rounded-xl bg-gradient-to-br ${project.gradient} border ${project.border} transition-all group`}
              >
                <h3 className={`text-xl font-bold text-white ${project.textColor} transition-colors mb-3`}>
                  {project.title}
                </h3>
                <p className="text-base text-slate-300 mb-5">
                  {project.desc}
                </p>
                <div className={`flex items-center gap-2 text-base ${project.arrowColor}`}>
                  了解详情
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </div>
              </a>
            ) : (
              <Link
                key={project.path}
                to={project.path}
                className={`block p-7 rounded-xl bg-gradient-to-br ${project.gradient} border ${project.border} transition-all group`}
              >
                <h3 className={`text-xl font-bold text-white ${project.textColor} transition-colors mb-3`}>
                  {project.title}
                </h3>
                <p className="text-base text-slate-300 mb-5">
                  {project.desc}
                </p>
                <div className={`flex items-center gap-2 text-base ${project.arrowColor}`}>
                  了解详情
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            )
          ))}
        </div>
      </section>

      {/* 广告位 */}
      <div id="ad-home-mid" className="my-8 text-center">
        {/* 广告位预留 */}
      </div>
    </div>
  );
};

export default HomePage;
