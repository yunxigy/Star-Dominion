import api from './client'
import type { ChapterInfo, ChapterContent, WriteResult, ReviewResult } from '../types/chapter'

export async function listChapters(novelId: string): Promise<ChapterInfo[]> {
  const { data } = await api.get(`/novels/${encodeURIComponent(novelId)}/chapters`)
  return data.chapters || []
}

export async function getChapter(novelId: string, chapterId: string): Promise<ChapterContent> {
  const { data } = await api.get(`/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}`)
  return data
}

export async function writeChapter(
  novelId: string,
  chapterId: string,
  opts?: { guidance?: string; temperature?: number; no_review?: boolean }
): Promise<WriteResult> {
  const { data } = await api.post(`/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/write`, opts || {})
  return data
}

export async function reviewChapter(novelId: string, chapterId: string): Promise<ReviewResult> {
  const { data } = await api.post(`/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/review`)
  return data
}
