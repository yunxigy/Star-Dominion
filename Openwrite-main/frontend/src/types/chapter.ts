export interface ChapterInfo {
  number: number
  chapter_id: string
  title?: string
}

export interface ChapterContent {
  chapter_id: string
  title?: string
  content: string
  word_count: number
}

export interface WriteResult {
  ok: boolean
  chapter_id: string
  title?: string
  word_count: number
  draft_path?: string
  truth_updates: Record<string, unknown>
}

export interface ReviewResult {
  ok: boolean
  chapter_id: string
  passed: boolean
  score?: number
  issues: ReviewIssue[]
}

export interface ReviewIssue {
  dimension?: string
  severity?: string
  message: string
  [key: string]: unknown
}
