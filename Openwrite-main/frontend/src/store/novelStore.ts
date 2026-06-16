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
  _requestId: string | null

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
  _requestId: null,

  loadNovels: async () => {
    set({ loading: true, error: null })
    try {
      const novels = await novelApi.listNovels()
      set({ novels, loading: false })
      const current = get().currentNovelId
      // Auto-select if: no current, or current doesn't exist in list
      const exists = current && novels.some(n => n.novel_id === current)
      if (!exists && novels.length > 0) {
        await get().selectNovel(novels[0].novel_id)
      } else if (exists) {
        // Re-fetch config/status for persisted novel
        await get().selectNovel(current!)
      }
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  selectNovel: async (id: string) => {
    const requestId = crypto.randomUUID()
    set({ currentNovelId: id, loading: true, error: null, _requestId: requestId })
    try {
      const [config, status] = await Promise.all([
        novelApi.getNovelConfig(id),
        novelApi.getStatus(id),
      ])
      // Discard stale responses
      if (get()._requestId !== requestId) return
      set({ config, status, loading: false })
    } catch (e: unknown) {
      if (get()._requestId !== requestId) return
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
