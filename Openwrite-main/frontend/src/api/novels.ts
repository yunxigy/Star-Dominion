import api from './client'
import type { NovelInfo, NovelConfig } from '../types/novel'

export async function listNovels(): Promise<NovelInfo[]> {
  const { data } = await api.get('/novels')
  return data
}

export async function getNovelConfig(novelId: string): Promise<NovelConfig> {
  const { data } = await api.get(`/novels/${novelId}/config`)
  return data
}

export async function updateNovelConfig(novelId: string, update: Partial<NovelConfig>): Promise<NovelConfig> {
  const { data } = await api.put(`/novels/${novelId}/config`, update)
  return data
}

export async function getStatus(novelId: string): Promise<Record<string, unknown>> {
  const { data } = await api.get(`/novels/${novelId}/status`)
  return data
}

export async function runDoctor(novelId: string): Promise<{ checks: { check: string; ok: boolean }[]; all_ok: boolean }> {
  const { data } = await api.post(`/novels/${novelId}/doctor`)
  return data
}
