import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, ArrowRight, Zap, BarChart3, Shield, Calendar, Globe, Sparkles, Star, Layers3 } from 'lucide-react';
import { useToolRunner } from '../components/ToolRunner';
import { CATEGORIES, TOOLS } from '../tools/registry';
import { getIcon } from '../lib/iconMap';
import { AdSlot } from '../components/AdSlot';
import { PROJECT_LINKS } from '../lib/projectLinks';

const HOT_TOOLS = [
  'merge-pdf', 'compress-image', 'json-format', 'bmi-calculator',
  'qr-code-generator', 'image-sharpness', 'daily-tarot', 'cps-test',
  'ocr-recognition', 'text-translate', 'grammar-check', 'word-count'
];

const RealTimeClock: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-3xl md:text-4xl font-mono font-bold text-[#2f241b]">
        {time.toLocaleTimeString('zh-CN', { hour12: false })}
      </div>
      <div className="text-sm text-[#6d5a47] flex items-center gap-2">
        <Calendar className="w-4 h-4" />
        {time.toLocaleDateString('zh-CN', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long'
        })}
      </div>
    </div>
  );
};

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
    <span className="text-[#8a4b1f]">
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
    <div className="space-y-10 max-w-[1500px] mx-auto">
      <section className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px] items-stretch">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="glass-card rounded-[2rem] p-6 sm:p-8 lg:p-10 overflow-hidden"
        >
          <div className="flex flex-wrap items-center gap-3 mb-8">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#f1dcc2] px-4 py-2 text-sm font-semibold text-[#6f3714] border border-[#d8b58e]">
              <Sparkles className="w-4 h-4" />
              {TOOLS.length}+ 免费工具
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#dfe5cf] px-4 py-2 text-sm font-semibold text-[#425129] border border-[#c2cda9]">
              <Shield className="w-4 h-4" />
              本地优先
            </span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black leading-tight mb-5 text-[#2f241b]">
            <span className="bg-gradient-to-r from-[#2f241b] via-[#8a4b1f] to-[#5f6f42] bg-clip-text text-transparent">
              逐梦工具箱
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-[#5c4937] mb-8 min-h-10 font-semibold">
            <TypewriterText texts={[
              '100+ 免费在线工具，助力高效工作',
              '本地优先，隐私分级保护',
              'PDF、图片、开发、计算一应俱全',
              '持续更新，更多功能敬请期待'
            ]} />
          </p>

          <form onSubmit={handleSearch} className="max-w-3xl mb-8">
            <div className="relative flex items-center search-bar-enhanced">
              <Search className="search-icon absolute left-4 text-[#8b735c] w-6 h-6" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索你需要的工具..."
                className="w-full pl-14 pr-28 py-5 rounded-2xl text-[#2f241b] placeholder-[#8b735c] focus:outline-none text-lg"
              />
              <button
                type="submit"
                className="absolute right-2 px-6 py-3 bg-[#7a421b] text-[#fff8ef] rounded-xl hover:bg-[#5f3214] transition-all font-semibold shadow-sm"
              >
                搜索
              </button>
            </div>
          </form>

          <div className="flex gap-3 flex-wrap">
            {[
              { icon: Sparkles, value: '128+', label: '在线工具', color: 'text-[#9a5a28]' },
              { icon: BarChart3, value: '11', label: '工具分类', color: 'text-[#5f6f42]' },
              { icon: Star, value: '常用', label: '快捷访问', color: 'text-[#b77932]' },
              { icon: Shield, value: '本地优先', label: '隐私保护', color: 'text-[#9f4b5f]' },
            ].map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + index * 0.1 }}
                className="stat-badge px-4 py-3"
              >
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
                <span className="font-bold text-[#2f241b]">{stat.value}</span>
                <span className="text-[#6d5a47]">{stat.label}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.aside
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.5 }}
          className="glass-card rounded-[2rem] p-6 sm:p-8 flex flex-col justify-between gap-8"
        >
          <RealTimeClock />
          <div className="grid grid-cols-2 gap-3">
            {CATEGORIES.slice(0, 6).map((category) => {
              const IconComponent = getIcon(category.icon);
              const toolCount = TOOLS.filter(t => t.category === category.id).length;
              return (
                <Link
                  key={category.id}
                  to={`/gj?category=${category.id}`}
                    className="rounded-2xl border border-[#d8b58e] bg-[#fff4e6]/80 p-4 hover:border-[#b47a43] hover:bg-[#f1dcc2] transition-all group"
                >
                  <div className={`inline-flex p-2 rounded-xl bg-gradient-to-br ${category.gradient} mb-3`}>
                    <IconComponent className="w-5 h-5 text-white" />
                  </div>
                  <div className="text-base font-bold text-[#2f241b] group-hover:text-[#6f3714]">{category.name}</div>
                  <div className="text-sm text-[#6d5a47] mt-1">{toolCount} 个</div>
                </Link>
              );
            })}
          </div>
        </motion.aside>
      </section>

      <Link
        to="/reports"
        className="group flex flex-col gap-4 rounded-3xl border border-[#d9c8b6] bg-gradient-to-br from-[#fffaf2] via-white to-[#eef2e5] p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-4">
          <span className="rounded-2xl bg-[#2f241b] p-3 text-white shadow-md">
            <BarChart3 className="h-6 w-6" />
          </span>
          <span>
            <span className="block text-xl font-black text-[#2f241b]">研报中心</span>
            <span className="mt-1 block text-sm text-[#6d5a47]">每周 GitHub 热门项目扫榜与多语言榜单</span>
          </span>
        </div>
        <span className="inline-flex items-center gap-2 font-bold text-[#7a431f]">
          查看本周榜单
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
        </span>
      </Link>

      <section>
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-amber-500/20">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-3xl font-black text-[#2f241b]">热门工具</h2>
          <span className="text-base text-[#6d5a47]">快速访问常用功能</span>
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
                className="group tool-card-enhanced p-5 rounded-2xl glass-card text-left min-h-[168px]"
              >
                <div className={`tool-icon inline-flex p-3 rounded-lg bg-gradient-to-br ${tool.gradient} mb-3`}>
                  <IconComponent className="w-6 h-6 text-white" />
                </div>
                <h3 className="tool-name text-lg font-bold text-[#2f241b] truncate">
                  {tool.name}
                </h3>
                <p className="text-base text-[#6d5a47] mt-1.5 line-clamp-2">
                  {tool.description}
                </p>
              </motion.button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#9a5a28] to-[#5f6f42] shadow-lg shadow-[#9a5a28]/20">
            <Layers3 className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-3xl font-black text-[#2f241b]">工具分类</h2>
          <span className="text-base text-[#6d5a47]">按类别浏览所有工具</span>
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
                  className="block tool-card-enhanced p-6 rounded-2xl glass-card group h-full"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-lg bg-gradient-to-br ${category.gradient} group-hover:scale-110 transition-transform`}>
                        <IconComponent className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-[#2f241b] group-hover:text-[#6f3714] transition-colors">
                          {category.name}
                        </h3>
                        <span className="text-sm text-[#6d5a47]">{toolCount} 个工具</span>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-[#9d8268] group-hover:text-[#8a4b1f] group-hover:translate-x-1 transition-all" />
                  </div>
                  <p className="text-base text-[#6d5a47] line-clamp-2">
                    {category.description}
                  </p>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </section>

      <AdSlot name="home-banner" className="my-8" />

      <section>
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#9f4b5f] to-[#9a5a28] shadow-lg shadow-[#9f4b5f]/18">
            <Globe className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-3xl font-black text-[#2f241b]">项目作品</h2>
          <span className="text-base text-[#6d5a47]">探索更多功能</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {PROJECT_LINKS.map((project) => {
            const className = `block p-7 rounded-2xl bg-gradient-to-br ${project.gradient} border ${project.border} transition-all group tool-card-enhanced h-full`;
            const content = (
              <>
                <h3 className={`text-xl font-black text-[#2f241b] ${project.textColor} transition-colors mb-3`}>
                  {project.name}
                </h3>
                <p className="text-base text-[#5c4937] mb-5">
                  {project.description}
                </p>
                <div className={`flex items-center gap-2 text-base font-semibold ${project.arrowColor}`}>
                  了解详情
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </div>
              </>
            );

            return project.external ? (
              <a key={project.path} href={project.path} target="_blank" rel="noopener noreferrer" className={className}>
                {content}
              </a>
            ) : (
              <Link key={project.path} to={project.path} className={className}>
                {content}
              </Link>
            );
          })}
        </div>
      </section>

      <AdSlot name="home-mid" className="my-8" />
    </div>
  );
};

export default HomePage;
