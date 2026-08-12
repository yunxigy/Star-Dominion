const BASE_TOOL_CARD_CLASS = 'w-full text-left group tool-card-enhanced glass-card rounded-2xl p-6';

export function getToolCardLayoutClass(category: string): string {
  return category === 'test'
    ? `${BASE_TOOL_CARD_CLASS} h-full min-h-[260px]`
    : BASE_TOOL_CARD_CLASS;
}

export function getToolCardContentClass(category: string): string {
  return category === 'test' ? 'flex h-full items-start gap-4' : 'flex items-start gap-4';
}

export function getToolCardActionClass(category: string): string {
  return category === 'test'
    ? 'flex min-w-0 flex-1 h-full items-start gap-4 text-left'
    : 'flex min-w-0 flex-1 items-start gap-4 text-left';
}
