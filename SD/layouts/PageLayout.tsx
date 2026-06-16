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
      <div className="min-h-screen mesh-bg text-[#2f241b] relative overflow-hidden">
        <MouseParticles />
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen mesh-bg text-[#2f241b] relative overflow-x-hidden">
      <MouseParticles />

      {/* Main Container */}
      <div className="relative z-10 container mx-auto px-4 py-8 lg:py-12 max-w-7xl">

        {/* Back Button */}
        {showBackButton && !isHome && (
          <Link
            to="/"
            className="inline-flex items-center gap-2 mb-8 px-4 py-2 rounded-xl glass-card text-[#6d5a47] hover:text-[#6f3714] transition-all duration-300 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            返回导航
          </Link>
        )}

        {children}

        {/* Footer */}
        <footer className="mt-20 py-8 text-center text-[#8b735c] text-sm border-t border-[#dcc2a3]">
          <p className="mb-2">&copy; {new Date().getFullYear()} 逐梦光影 | All Rights Reserved.</p>
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#6f3714] transition-colors duration-300"
          >
            津ICP备2025041246号-1
          </a>
        </footer>
      </div>
    </div>
  );
};
