import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { getIcon } from '../lib/iconMap';
import { PROJECT_LINKS } from '../lib/projectLinks';

type ProjectGalleryProps = {
  authenticated: boolean;
  authLoading: boolean;
  onAuthRequired: (path: string) => void;
};

export const ProjectGallery: React.FC<ProjectGalleryProps> = ({
  authenticated,
  authLoading,
  onAuthRequired,
}) => {
  return (
    <section aria-labelledby="project-gallery-title" className="mt-8 border-t border-[#dcc2a3]/70 pt-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="project-gallery-title" className="text-xl font-black text-[#2f241b]">项目作品</h2>
          <p className="mt-1 text-sm text-[#6d5a47]">从工具箱出发，探索更多实用项目</p>
        </div>
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9d8268]">Projects</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5 max-md:flex max-md:snap-x max-md:overflow-x-auto max-md:pb-2">
        {PROJECT_LINKS.map(project => {
          const ProjectIcon = getIcon(project.icon);
          const className = `group flex h-full flex-col rounded-2xl bg-gradient-to-br ${project.gradient} border ${project.border} p-4 transition-all hover:-translate-y-0.5 hover:shadow-md max-md:min-w-[78%] max-md:snap-start`;
          const content = (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="rounded-xl bg-white/65 p-2 text-[#6f3714] shadow-sm">
                  <ProjectIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <ArrowRight className="h-4 w-4 text-[#9d8268] transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </div>
              <h3 className={`text-base font-black text-[#2f241b] ${project.textColor} transition-colors`}>{project.name}</h3>
              <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-[#5c4937]">{project.description}</p>
              <span className={`mt-auto pt-3 text-xs font-bold ${project.arrowColor}`}>了解详情</span>
            </>
          );

          if (project.external) {
            return (
              <a
                key={project.path}
                href={project.path}
                target="_blank"
                rel="noopener noreferrer"
                className={className}
                onClick={event => {
                  if (project.requiresAuth && !authLoading && !authenticated) {
                    event.preventDefault();
                    onAuthRequired(project.path);
                  }
                }}
              >
                {content}
              </a>
            );
          }

          return (
            <Link key={project.path} to={project.path} className={className}>
              {content}
            </Link>
          );
        })}
      </div>
    </section>
  );
};

export default ProjectGallery;
