export const HOME_HOT_TOOL_TITLE_CLASS = 'text-xl font-bold text-[#2f241b]';
export const HOME_HOT_TOOL_DESCRIPTION_CLASS = 'text-lg text-[#6d5a47] mt-1.5 line-clamp-2';
export const HOME_CATEGORY_TITLE_CLASS = 'text-2xl font-bold text-[#2f241b]';
export const HOME_CATEGORY_DESCRIPTION_CLASS = 'text-lg text-[#6d5a47] line-clamp-2';
export const TOOLBOX_CARD_TITLE_CLASS = 'text-2xl font-bold text-[#2f241b] truncate';
export const TOOLBOX_CARD_DESCRIPTION_CLASS = 'text-lg text-[#6d5a47] mt-2 line-clamp-2';
export const TOOL_WINDOW_CONTENT_CLASS = 'max-w-7xl mx-auto p-8';
export const TOOL_WINDOW_AD_CLASS = 'max-w-7xl mx-auto px-8 pb-6';

const IMAGE_WORKBENCH_CATEGORIES = new Set(['image', 'image-enhance']);

export function usesImageWorkbench(category: string): boolean {
  return IMAGE_WORKBENCH_CATEGORIES.has(category);
}

export function getToolWindowContentClass(category: string): string {
  return usesImageWorkbench(category)
    ? 'max-w-[1500px] mx-auto px-4 py-6 sm:px-6 lg:px-8'
    : TOOL_WINDOW_CONTENT_CLASS;
}

export function getToolComponentShellClass(category: string): string {
  return usesImageWorkbench(category)
    ? 'mb-6'
    : 'glass-card rounded-2xl p-6 mb-6';
}
