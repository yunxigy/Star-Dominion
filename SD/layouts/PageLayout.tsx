import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MouseParticles } from '../components/MouseParticles';
import { ArrowLeft } from 'lucide-react';

interface PageLayoutProps {
  children: React.ReactNode;
  showBackButton?: boolean;
  fullScreen?: boolean;
}

export const PageLayout: React.FC<PageLayoutProps> = ({ children, showBackButton = true, fullScreen = false }) => {
  const location = useLocation();
  const isHome = location.pathname === '/';

  if (fullScreen) {
    return (
      <div className="min-h-screen mesh-bg text-slate-200 relative overflow-hidden selection:bg-blue-500/30">
        <MouseParticles />
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen mesh-bg text-slate-200 relative overflow-x-hidden selection:bg-blue-500/30">
      <MouseParticles />

      {/* Soft gradient orbs */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-15%] left-[-5%] w-[50%] h-[50%] bg-purple-600/15 rounded-full blur-[150px]" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-blue-600/12 rounded-full blur-[120px]" />
        <div className="absolute top-[30%] left-[50%] w-[30%] h-[30%] bg-teal-500/10 rounded-full blur-[100px]" />
      </div>

      {/* Main Container */}
      <div className="relative z-10 container mx-auto px-4 py-8 lg:py-12 max-w-7xl">

        {/* Back Button */}
        {showBackButton && !isHome && (
          <Link
            to="/"
            className="inline-flex items-center gap-2 mb-8 px-4 py-2 rounded-xl glass-card text-slate-300 hover:text-white transition-all duration-300 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            返回导航
          </Link>
        )}

        {children}

        {/* Footer */}
        <footer className="mt-20 py-8 text-center text-slate-500 text-sm border-t border-white/5">
          <p className="mb-2">&copy; {new Date().getFullYear()} 逐梦光影 | All Rights Reserved.</p>
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-300 transition-colors duration-300"
          >
            津ICP备2025041246号-1
          </a>
        </footer>
      </div>
    </div>
  );
};
