import type { DiffItem, Folder, Material, MaterialSummary, PracticeSource, Sentence } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      message = body.detail ?? message
    } catch { /* response was not JSON */ }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  list: () => request<MaterialSummary[]>('/api/materials'),
  listFolders: () => request<Folder[]>('/api/folders'),
  practiceSources: () => request<PracticeSource[]>('/api/practice-sources'),
  createFolder: (name: string) => request<Folder>('/api/folders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }),
  renameFolder: (id: string, name: string) => request<Folder>(`/api/folders/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }),
  deleteFolder: (id: string, deleteMaterials: boolean) => request<void>(`/api/folders/${id}?delete_materials=${deleteMaterials}`, { method: 'DELETE' }),
  get: (id: string) => request<Material>(`/api/materials/${id}`),
  upload: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<MaterialSummary>('/api/materials', { method: 'POST', body })
  },
  progress: (id: string, values: Partial<Pick<Material, 'current_sentence' | 'current_position' | 'playback_rate'>>) =>
    request<MaterialSummary>(`/api/materials/${id}/progress`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
    }),
  updateSentence: (materialId: string, sentence: Sentence, start: number, end: number) =>
    request<Sentence>(`/api/materials/${materialId}/sentences/${sentence.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end }),
    }),
  uploadSubtitles: (materialId: string, file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<Material>(`/api/materials/${materialId}/subtitles`, { method: 'POST', body })
  },
  updateMaterial: (id: string, values: { folder_id?: string | null; completed?: boolean }) =>
    request<MaterialSummary>(`/api/materials/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
    }),
  deleteMaterial: (id: string) => request<void>(`/api/materials/${id}`, { method: 'DELETE' }),
  saveDictation: (materialId: string, sentenceId: number, answer: string, diff: DiffItem[] | null, checked: boolean) =>
    request<{ saved: boolean }>(`/api/materials/${materialId}/sentences/${sentenceId}/dictation`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer, diff, checked }),
    }),
}
