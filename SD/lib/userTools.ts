/**
 * 用户工具偏好（最近使用 + 收藏）
 * 纯 localStorage，无需登录
 */

const RECENT_KEY = 'sd-recent-tools';
const FAVORITES_KEY = 'sd-favorite-tools';
const MAX_RECENT = 12;

/** 获取最近使用的工具 ID 列表 */
export function getRecentTools(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

/** 记录一次工具使用 */
export function recordToolUse(toolId: string): void {
  const recent = getRecentTools().filter(id => id !== toolId);
  recent.unshift(toolId);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

/** 获取收藏的工具 ID 列表 */
export function getFavoriteTools(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
  } catch {
    return [];
  }
}

/** 切换收藏状态，返回是否已收藏 */
export function toggleFavorite(toolId: string): boolean {
  const favs = getFavoriteTools();
  const index = favs.indexOf(toolId);
  if (index >= 0) {
    favs.splice(index, 1);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
    return false;
  } else {
    favs.push(toolId);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
    return true;
  }
}

/** 检查是否已收藏 */
export function isFavorite(toolId: string): boolean {
  return getFavoriteTools().includes(toolId);
}
