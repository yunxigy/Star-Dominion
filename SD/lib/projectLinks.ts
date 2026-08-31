export interface ProjectLink {
  path: string;
  name: string;
  description: string;
  icon: string;
  gradient: string;
  border: string;
  textColor: string;
  arrowColor: string;
  external?: boolean;
  requiresAuth?: boolean;
}

export const PROJECT_LINKS: ProjectLink[] = [
  {
    path: '/games',
    name: '趣味游戏',
    description: '七款本地棋类小游戏，支持人机与双人同屏对战',
    icon: 'Gamepad2',
    gradient: 'from-[#dfe5cf] to-[#d7e8e2]',
    border: 'border-[#b8cba8] hover:border-[#7f9d6c]',
    textColor: 'group-hover:text-[#4d5b33]',
    arrowColor: 'text-[#5f6f42]',
  },
  {
    path: '/fy',
    name: '智创翻译',
    description: '基于 PaddleOCR 与百度翻译 API 的屏幕实时翻译工具',
    icon: 'Languages',
    gradient: 'from-[#fff4e6] to-[#dfe5cf]',
    border: 'border-[#d8b58e] hover:border-[#b47a43]',
    textColor: 'group-hover:text-[#6f3714]',
    arrowColor: 'text-[#8a4b1f]',
  },
  {
    path: '/bp',
    name: '边坡上位机',
    description: 'STM32 北斗边坡高精度定位监控系统',
    icon: 'Satellite',
    gradient: 'from-[#f8ead8] to-[#e1e6d5]',
    border: 'border-[#d5b795] hover:border-[#a9875f]',
    textColor: 'group-hover:text-[#4d5b33]',
    arrowColor: 'text-[#5f6f42]',
  },
  {
    path: '/ai',
    name: '网文智能体',
    description: 'AI 自主长篇小说写作系统',
    icon: 'Bot',
    gradient: 'from-[#f6e5d0] to-[#f0d2d9]',
    border: 'border-[#d8b58e] hover:border-[#bd8f63]',
    textColor: 'group-hover:text-[#7a421b]',
    arrowColor: 'text-[#9a5a28]',
  },
  {
    path: '/wuwa/',
    name: 'AI 伴侣',
    description: '多角色 AI 语音对话系统，支持语音克隆与 TTS',
    icon: 'Heart',
    gradient: 'from-[#f0d2d9] to-[#fff0df]',
    border: 'border-[#d8a7b2] hover:border-[#b76b7b]',
    textColor: 'group-hover:text-[#7c3141]',
    arrowColor: 'text-[#9f4b5f]',
    external: true,
  },
  {
    path: '/stock/',
    name: '股票研究',
    description: '九点猫研、自选策略、宝妈指数与个股 AI 详细分析',
    icon: 'TrendingUp',
    gradient: 'from-[#f7ead7] to-[#e4ead7]',
    border: 'border-[#d3b48e] hover:border-[#8da067]',
    textColor: 'group-hover:text-[#4d5b33]',
    arrowColor: 'text-[#5f6f42]',
    external: true,
    requiresAuth: true,
  },
];
