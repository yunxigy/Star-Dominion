import { getMiniMode } from '../lib/miniMode';

const DESKTOP_INPUT_TOOL_IDS = new Set([
  'cps-test',
  'reaction-test',
  'dpi-analyzer',
  'double-click-test',
  'mouse-button-test',
  'scroll-test',
  'mouse-trail',
  'polling-rate',
  'jitter-test',
  'drag-test',
]);

export function MiniCompatibilityNotice({ toolId }: { toolId: string }) {
  if (!getMiniMode() || !DESKTOP_INPUT_TOOL_IDS.has(toolId)) return null;

  return (
    <aside className="mini-compatibility-notice" role="note">
      手机触控可以打开此工具，但它主要针对鼠标/桌面输入设计，手机上可能无法得到完整结果。
    </aside>
  );
}

export default MiniCompatibilityNotice;
