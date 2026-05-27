import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { NovelConfig, NovelInfo } from '../types/novel'
import * as novelApi from '../api/novels'

interface NovelStore {
  novels: NovelInfo[]
  currentNovelId: string | null
  config: NovelConfig | null
  status: Record<string, unknown> | null
  loading: boolean
  error: string | null

  loadNovels: () => Promise<void>
  selectNovel: (id: string) => Promise<void>
  refreshConfig: () => Promise<void>
  refreshStatus: () => Promise<void>
}

export const useNovelStore = create<NovelStore>()(persist((set, get) => ({
  novels: [],
  currentNovelId: null,
  config: null,
  status: null,
  loading: false,
  error: null,

  loadNovels: async () => {
    set({ loading: true, error: null })
    try {
      const novels = await novelApi.listNovels()
      set({ novels, loading: false })
      const current = get().currentNovelId
      if (!current && novels.length > 0) {
        await get().selectNovel(novels[0].novel_id)
      }
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  selectNovel: async (id: string) => {
    set({ currentNovelId: id, loading: true, error: null })
    try {
      const [config, status] = await Promise.all([
        novelApi.getNovelConfig(id).catch(() => null),
        novelApi.getStatus(id).catch(() => null),
      ])
      set({ config, status, loading: false })
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  refreshConfig: async () => {
    const id = get().currentNovelId
    if (!id) return
    try {
      const config = await novelApi.getNovelConfig(id)
      set({ config })
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },

  refreshStatus: async () => {
    const id = get().currentNovelId
    if (!id) return
    try {
      const status = await novelApi.getStatus(id)
      set({ status })
    } catch (e: unknown) {
      set({ error: (e as Error).message })
    }
  },
}), {
  name: 'openwrite-novel',
  partialize: (state) => ({ currentNovelId: state.currentNovelId }),
}))
