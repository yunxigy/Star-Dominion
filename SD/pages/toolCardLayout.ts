export const TOOL_CARD_SURFACE_CLASS = 'block content-visibility-auto h-full min-h-[154px] w-full text-left group tool-card-enhanced glass-card rounded-2xl p-5';

export function getToolCardLayoutClass(category: string): string {
  return category === 'test'
    ? `${TOOL_CARD_SURFACE_CLASS} min-h-[260px]`
    : TOOL_CARD_SURFACE_CLASS;
}

export function getToolCardContentClass(category: string): string {
  return 'flex h-full items-start gap-4';
}

export function getToolCardActionClass(category: string): string {
  return 'flex min-w-0 flex-1 h-full items-start gap-4 text-left';
}
