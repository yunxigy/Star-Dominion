import { readStorage, writeStorage } from './storage';

const RECENT_KEY = 'recent-tools';
const FAVORITE_KEY = 'favorite-tools';
const SEARCH_HISTORY_KEY = 'search-history';
const RECENT_LIMIT = 8;
const SEARCH_HISTORY_LIMIT = 10;

export function recordRecentTool(id: string): void {
  if (!id) return;
  const ids = readStorage<string[]>(RECENT_KEY, []).filter((item) => item !== id);
  ids.unshift(id);
  writeStorage(RECENT_KEY, ids.slice(0, RECENT_LIMIT));
}

export function getRecentToolIds(): string[] {
  return readStorage<string[]>(RECENT_KEY, []);
}

export function toggleFavoriteTool(id: string): boolean {
  if (!id) return false;
  const ids = readStorage<string[]>(FAVORITE_KEY, []);
  const exists = ids.includes(id);
  const next = exists ? ids.filter((item) => item !== id) : [id, ...ids];
  writeStorage(FAVORITE_KEY, next);
  return !exists;
}

export function getFavoriteToolIds(): string[] {
  return readStorage<string[]>(FAVORITE_KEY, []);
}

export function addSearchHistory(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  const items = readStorage<string[]>(SEARCH_HISTORY_KEY, []).filter((item) => item !== trimmed);
  items.unshift(trimmed);
  writeStorage(SEARCH_HISTORY_KEY, items.slice(0, SEARCH_HISTORY_LIMIT));
}

export function getSearchHistory(): string[] {
  return readStorage<string[]>(SEARCH_HISTORY_KEY, []);
}

export function clearSearchHistory(): void {
  writeStorage(SEARCH_HISTORY_KEY, []);
}