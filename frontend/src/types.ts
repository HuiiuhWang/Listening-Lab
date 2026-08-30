export type Word = {
  text: string
  start: number
  end: number
  probability?: number | null
}

export type DiffItem = {
  type: 'equal' | 'missing' | 'extra' | 'replace'
  expected?: string
  actual?: string
}

export type Sentence = {
  id: number
  material_id: string
  sentence_index: number
  start: number
  end: number
  text: string
  words: Word[]
  answer: string | null
  diff: DiffItem[] | null
  checked_at: string | null
}

export type MaterialSummary = {
  id: string
  name: string
  original_filename: string
  duration: number
  status: 'processing' | 'transcribing' | 'ready' | 'error'
  transcript_source: 'whisper' | 'official_embedded' | 'official_import'
  folder_id: string | null
  completed: boolean
  completed_at: string | null
  error: string | null
  current_sentence: number
  current_position: number
  playback_rate: number
  sentence_count: number
  updated_at: string
}

export type Material = MaterialSummary & { sentences: Sentence[] }

export type Folder = {
  id: string
  name: string
  material_count: number
  created_at: string
  updated_at: string
}

export type PracticeEpisode = {
  source_id: string
  title: string
  description: string
  published: string
  duration_seconds: number | null
  page_url: string
  audio_url: string
}

export type PracticeSource = {
  id: string
  name: string
  provider: string
  level: string
  accent: string
  description: string
  site_url: string
  available: boolean
  episodes: PracticeEpisode[]
}

export type Selection = { start: number; end: number }
export type Peaks = { start: number; end: number; duration: number; peaks: [number, number][] }
