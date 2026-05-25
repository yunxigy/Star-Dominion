export interface NovelInfo {
  novel_id: string
  path: string
  has_outline: boolean
  has_characters: boolean
  chapter_count: number
}

export interface NovelConfig {
  novel_id: string
  style_id?: string
  current_arc?: string
  current_chapter?: string
  default_word_count?: number
  max_tokens?: number
}
