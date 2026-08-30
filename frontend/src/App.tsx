import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { wordDiff } from './diff'
import DiffView from './DiffView'
import type { DiffItem, Folder, Material, MaterialSummary, PracticeSource, Selection, Sentence } from './types'
import Waveform, { formatTime } from './Waveform'

const RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25]

export default function App() {
  const [materials, setMaterials] = useState<MaterialSummary[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [uploadFolderId, setUploadFolderId] = useState('')
  const [draggingMaterialId, setDraggingMaterialId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null)
  const [showSources, setShowSources] = useState(false)
  const [sources, setSources] = useState<PracticeSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourceSearch, setSourceSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem('lastMaterial'))
  const [material, setMaterial] = useState<Material | null>(null)
  const [index, setIndex] = useState(0)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [rate, setRate] = useState(1)
  const [repeatCount, setRepeatCount] = useState(3)
  const [repeatRun, setRepeatRun] = useState<{ current: number; total: number } | null>(null)
  const [answer, setAnswer] = useState('')
  const [diff, setDiff] = useState<DiffItem[] | null>(null)
  const [showAnswer, setShowAnswer] = useState(false)
  const [wordRange, setWordRange] = useState<{ sentence: number; from: number; to: number } | null>(null)
  const [timeDraft, setTimeDraft] = useState({ start: '', end: '' })
  const [notice, setNotice] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadingSubtitles, setUploadingSubtitles] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  const sentenceRef = useRef<Sentence | undefined>(undefined)
  const selectionRef = useRef<Selection | null>(null)
  const loopRef = useRef(false)
  const repeatRef = useRef({ active: false, current: 0, total: 0 })
  const monitorFrame = useRef<number | null>(null)
  const autosaves = useRef(new Map<string, number>())
  const lastProgressSave = useRef(0)
  const sentence = material?.sentences[index]

  const refreshList = useCallback(async () => {
    try {
      const [result, folderResult] = await Promise.all([api.list(), api.listFolders()])
      setMaterials(result); setFolders(folderResult)
      if (!selectedId && result[0]) setSelectedId(result[0].id)
    } catch (error) { setNotice((error as Error).message) }
  }, [selectedId])

  useEffect(() => { void refreshList() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (uploadFolderId && !folders.some(folder => folder.id === uploadFolderId)) setUploadFolderId('')
  }, [folders, uploadFolderId])
  useEffect(() => {
    if (!selectedId) { setMaterial(null); return }
    localStorage.setItem('lastMaterial', selectedId)
    api.get(selectedId).then(item => {
      setMaterial(item)
      const savedIndex = Math.min(item.current_sentence, Math.max(0, item.sentences.length - 1))
      setIndex(savedIndex); setRate(item.playback_rate || 1); setCurrentTime(item.current_position || 0)
    }).catch(error => setNotice(error.message))
  }, [selectedId])

  useEffect(() => {
    if (!material || material.status === 'ready' || material.status === 'error') return
    const timer = window.setInterval(async () => {
      const item = await api.get(material.id)
      setMaterial(item); void refreshList()
      if (item.status === 'ready') { setIndex(0); setCurrentTime(item.sentences[0]?.start ?? 0) }
    }, 1800)
    return () => window.clearInterval(timer)
  }, [material?.id, material?.status, refreshList])

  useEffect(() => {
    if (!sentence) return
    sentenceRef.current = sentence
    repeatRef.current = { active: false, current: 0, total: 0 }
    setRepeatRun(null)
    setAnswer(sentence.answer ?? '')
    setDiff(sentence.diff)
    selectionRef.current = null
    setShowAnswer(false); setSelection(null); setWordRange(null)
    setTimeDraft({ start: sentence.start.toFixed(3), end: sentence.end.toFixed(3) })
  }, [sentence?.id])

  useEffect(() => {
    if (!audio.current) return
    audio.current.playbackRate = rate
    audio.current.preservesPitch = true
  }, [rate])

  useEffect(() => { loopRef.current = loop }, [loop])

  const seek = useCallback((time: number) => {
    if (!audio.current) return
    audio.current.currentTime = time; setCurrentTime(time)
  }, [])

  const updateSelection = useCallback((next: Selection | null) => {
    const valid = next && next.end - next.start >= 0.02 ? next : null
    if (valid && repeatRef.current.active) {
      repeatRef.current = { active: false, current: 0, total: 0 }
      setRepeatRun(null)
    }
    selectionRef.current = valid
    setSelection(next)
    const player = audio.current
    if (valid && player && !player.paused && (player.currentTime < valid.start || player.currentTime >= valid.end)) {
      player.currentTime = valid.start
      setCurrentTime(valid.start)
    }
  }, [])

  const activeRange = useCallback(() => {
    const currentSentence = sentenceRef.current
    return selectionRef.current ?? (currentSentence ? { start: currentSentence.start, end: currentSentence.end } : null)
  }, [])
  const play = useCallback(async () => {
    const range = activeRange()
    if (!audio.current || !range) return
    if (audio.current.currentTime < range.start - 0.02 || audio.current.currentTime >= range.end - 0.02) seek(range.start)
    try { await audio.current.play() } catch { setNotice('Your browser blocked playback. Please click Play again.') }
  }, [activeRange, seek])
  const togglePlay = useCallback(() => {
    if (!audio.current) return
    if (audio.current.paused) void play(); else audio.current.pause()
  }, [play])
  const replay = useCallback(() => {
    const range = activeRange(); if (!range) return
    seek(range.start); void play()
  }, [activeRange, play, seek])

  const goTo = useCallback((next: number, position?: number) => {
    if (!material || !material.sentences.length) return
    const target = Math.max(0, Math.min(next, material.sentences.length - 1))
    sentenceRef.current = material.sentences[target]
    selectionRef.current = null
    repeatRef.current = { active: false, current: 0, total: 0 }
    setRepeatRun(null)
    setIndex(target); setSelection(null)
    const start = position ?? material.sentences[target].start
    seek(start)
    void api.progress(material.id, { current_sentence: target, current_position: start })
  }, [material, seek])

  const enforcePlaybackEnd = useCallback(() => {
    const player = audio.current
    const repeatingSentence = repeatRef.current.active ? sentenceRef.current : undefined
    const range = repeatingSentence
      ? { start: repeatingSentence.start, end: repeatingSentence.end }
      : activeRange()
    if (!player || !range || player.currentTime < range.end) return false
    if (repeatRef.current.active) {
      if (repeatRef.current.current < repeatRef.current.total) {
        repeatRef.current.current += 1
        setRepeatRun({ current: repeatRef.current.current, total: repeatRef.current.total })
        player.currentTime = range.start
        setCurrentTime(range.start)
      } else {
        repeatRef.current = { active: false, current: 0, total: 0 }
        setRepeatRun(null)
        player.currentTime = range.end
        setCurrentTime(range.end)
        player.pause()
      }
      return true
    }
    if (loopRef.current && range.end - range.start >= 0.02) {
      player.currentTime = range.start
      setCurrentTime(range.start)
    } else {
      player.currentTime = range.end
      setCurrentTime(range.end)
      player.pause()
    }
    return true
  }, [activeRange])

  const monitorPlayback = useCallback(function tick() {
    const player = audio.current
    if (!player || player.paused) { monitorFrame.current = null; return }
    enforcePlaybackEnd()
    if (!player.paused) monitorFrame.current = window.requestAnimationFrame(tick)
  }, [enforcePlaybackEnd])

  useEffect(() => () => {
    if (monitorFrame.current !== null) window.cancelAnimationFrame(monitorFrame.current)
  }, [])

  const changeRate = useCallback((next: number) => {
    const valid = RATES.reduce((best, candidate) => Math.abs(candidate - next) < Math.abs(best - next) ? candidate : best, RATES[0])
    setRate(valid)
    if (material) void api.progress(material.id, { playback_rate: valid })
  }, [material])

  const toggleLoop = () => {
    if (repeatRef.current.active) {
      repeatRef.current = { active: false, current: 0, total: 0 }
      setRepeatRun(null)
    }
    setLoop(value => {
      loopRef.current = !value
      return !value
    })
  }

  const toggleSentenceRepeat = () => {
    if (repeatRef.current.active) {
      repeatRef.current = { active: false, current: 0, total: 0 }
      setRepeatRun(null)
      audio.current?.pause()
      return
    }
    const currentSentence = sentenceRef.current
    if (!currentSentence) return
    const total = Math.max(2, Math.min(50, Math.round(repeatCount)))
    setRepeatCount(total)
    repeatRef.current = { active: true, current: 1, total }
    setRepeatRun({ current: 1, total })
    loopRef.current = false; setLoop(false)
    selectionRef.current = null; setSelection(null)
    seek(currentSentence.start)
    void play()
  }

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, [contenteditable="true"]')) return
      if (event.code === 'Space') { event.preventDefault(); togglePlay() }
      if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(index - 1) }
      if (event.key === 'ArrowRight') { event.preventDefault(); goTo(index + 1) }
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); replay() }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); changeRate(RATES[Math.min(RATES.length - 1, RATES.indexOf(rate) + 1)]) }
      if (event.key === '-' || event.key === '_') { event.preventDefault(); changeRate(RATES[Math.max(0, RATES.indexOf(rate) - 1)]) }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [changeRate, goTo, index, rate, replay, togglePlay])

  const updatePlayback = () => {
    if (!audio.current || !material || !sentence) return
    const time = audio.current.currentTime; setCurrentTime(time)
    enforcePlaybackEnd()
    const now = Date.now()
    if (now - lastProgressSave.current > 1200) {
      lastProgressSave.current = now
      void api.progress(material.id, { current_sentence: index, current_position: time })
    }
  }

  const playbackStarted = () => {
    setPlaying(true)
    if (monitorFrame.current !== null) window.cancelAnimationFrame(monitorFrame.current)
    monitorFrame.current = window.requestAnimationFrame(monitorPlayback)
  }

  const playbackPaused = () => {
    setPlaying(false)
    if (monitorFrame.current !== null) window.cancelAnimationFrame(monitorFrame.current)
    monitorFrame.current = null
    if (material) void api.progress(material.id, { current_sentence: index, current_position: audio.current?.currentTime ?? currentTime })
  }

  const handleUpload = async (file?: File) => {
    if (!file) return
    setUploading(true); setNotice('Importing file…')
    try {
      const created = await api.upload(file)
      if (uploadFolderId) await api.updateMaterial(created.id, { folder_id: uploadFolderId })
      await refreshList(); setSelectedId(created.id)
      const destination = folders.find(folder => folder.id === uploadFolderId)?.name ?? 'Unfiled'
      setNotice(`Imported to ${destination}. Extracting and transcribing locally. The model is downloaded on first use.`)
    } catch (error) { setNotice((error as Error).message) }
    finally { setUploading(false) }
  }

  const createFolder = async () => {
    const name = folderName.trim()
    if (!name) return
    try {
      await api.createFolder(name)
      setFolderName(''); setCreatingFolder(false); await refreshList()
    } catch (error) { setNotice((error as Error).message) }
  }

  const openPracticeSources = async () => {
    setShowSources(true)
    if (sources.length || sourcesLoading) return
    setSourcesLoading(true)
    try { setSources(await api.practiceSources()) }
    catch (error) { setNotice(`Could not load practice sources: ${(error as Error).message}`) }
    finally { setSourcesLoading(false) }
  }

  const renameFolder = async () => {
    if (!editingFolderId || !editingFolderName.trim()) return
    try {
      await api.renameFolder(editingFolderId, editingFolderName.trim())
      setEditingFolderId(null); setEditingFolderName(''); await refreshList()
    } catch (error) { setNotice((error as Error).message) }
  }

  const deleteFolder = async (deleteMaterials: boolean) => {
    if (!folderToDelete) return
    const deletedFolder = folderToDelete
    try {
      await api.deleteFolder(deletedFolder.id, deleteMaterials)
      setFolderToDelete(null)
      if (deleteMaterials && material?.folder_id === deletedFolder.id) {
        audio.current?.pause(); setMaterial(null); setSelectedId(null)
        localStorage.removeItem('lastMaterial')
      } else if (material?.folder_id === deletedFolder.id) {
        setMaterial({ ...material, folder_id: null })
      }
      const [nextMaterials, nextFolders] = await Promise.all([api.list(), api.listFolders()])
      setMaterials(nextMaterials); setFolders(nextFolders)
      if (deleteMaterials && !nextMaterials.some(item => item.id === selectedId)) {
        setSelectedId(nextMaterials[0]?.id ?? null)
      }
    } catch (error) { setNotice((error as Error).message) }
  }

  const updateMaterialMeta = async (values: { folder_id?: string | null; completed?: boolean }) => {
    if (!material) return
    try {
      const updated = await api.updateMaterial(material.id, values)
      setMaterial({ ...material, ...updated })
      await refreshList()
    } catch (error) { setNotice((error as Error).message) }
  }

  const moveMaterial = async (materialId: string, folderId: string | null) => {
    const item = materials.find(candidate => candidate.id === materialId)
    if (!item || item.folder_id === folderId) { setDraggingMaterialId(null); setDropTarget(null); return }
    setMaterials(current => current.map(candidate => candidate.id === materialId ? { ...candidate, folder_id: folderId } : candidate))
    if (material?.id === materialId) setMaterial({ ...material, folder_id: folderId })
    setDraggingMaterialId(null); setDropTarget(null)
    try {
      await api.updateMaterial(materialId, { folder_id: folderId })
      await refreshList()
    } catch (error) {
      setNotice((error as Error).message); await refreshList()
    }
  }

  const dropMaterial = (event: React.DragEvent, folderId: string | null) => {
    event.preventDefault()
    const materialId = event.dataTransfer.getData('text/plain') || draggingMaterialId
    if (materialId) void moveMaterial(materialId, folderId)
  }

  const deleteCurrentMaterial = async () => {
    if (!material || !window.confirm(`Permanently delete “${material.name}” and all of its study data?`)) return
    audio.current?.pause()
    try {
      await api.deleteMaterial(material.id)
      const [nextMaterials, nextFolders] = await Promise.all([api.list(), api.listFolders()])
      setMaterials(nextMaterials); setFolders(nextFolders); setMaterial(null)
      const nextId = nextMaterials[0]?.id ?? null
      setSelectedId(nextId)
      if (nextId) localStorage.setItem('lastMaterial', nextId)
      else localStorage.removeItem('lastMaterial')
    } catch (error) { setNotice((error as Error).message) }
  }

  const handleSubtitleUpload = async (file?: File) => {
    if (!file || !material) return
    setUploadingSubtitles(true)
    try {
      const updated = await api.uploadSubtitles(material.id, file)
      setMaterial(updated); setIndex(0); sentenceRef.current = updated.sentences[0]
      repeatRef.current = { active: false, current: 0, total: 0 }; setRepeatRun(null)
      selectionRef.current = null; setSelection(null)
      seek(updated.sentences[0]?.start ?? 0)
      setNotice('Official subtitles imported and set as the reference transcript.')
      void refreshList()
    } catch (error) { setNotice((error as Error).message) }
    finally { setUploadingSubtitles(false) }
  }

  const answerChanged = (value: string) => {
    setAnswer(value); setDiff(null)
    if (!material || !sentence) return
    const materialId = material.id, sentenceId = sentence.id
    const key = `${materialId}:${sentenceId}`
    const previous = autosaves.current.get(key)
    if (previous) window.clearTimeout(previous)
    const timer = window.setTimeout(() => {
      autosaves.current.delete(key)
      void api.saveDictation(materialId, sentenceId, value, null, false)
    }, 500)
    autosaves.current.set(key, timer)
  }
  const check = () => {
    if (!material || !sentence) return
    const result = wordDiff(sentence.text, answer); setDiff(result)
    void api.saveDictation(material.id, sentence.id, answer, result, true)
  }
  const updateBoundary = async () => {
    if (!material || !sentence) return
    const start = Number(timeDraft.start), end = Number(timeDraft.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) { setNotice('Invalid sentence time range.'); return }
    try {
      const updated = await api.updateSentence(material.id, sentence, start, end)
      setMaterial({ ...material, sentences: material.sentences.map(item => item.id === updated.id ? updated : item) })
      sentenceRef.current = updated; selectionRef.current = null
      repeatRef.current = { active: false, current: 0, total: 0 }; setRepeatRun(null)
      setSelection(null); seek(start); setNotice('Sentence time range saved.')
    } catch (error) { setNotice((error as Error).message) }
  }

  const clickWord = (sentenceIndex: number, wordIndex: number, event: React.MouseEvent) => {
    if (!material) return
    const targetSentence = material.sentences[sentenceIndex]
    const word = targetSentence.words[wordIndex]
    if (!word) return
    if (sentenceIndex !== index) { sentenceRef.current = targetSentence; setIndex(sentenceIndex) }
    if (event.shiftKey && wordRange?.sentence === sentenceIndex) {
      const from = Math.min(wordRange.from, wordIndex), to = Math.max(wordRange.from, wordIndex)
      setWordRange({ sentence: sentenceIndex, from, to })
      const selected = {
        start: Math.max(targetSentence.start, targetSentence.words[from].start),
        end: Math.min(targetSentence.end, targetSentence.words[to].end),
      }
      updateSelection(selected); seek(selected.start)
    } else {
      setWordRange({ sentence: sentenceIndex, from: wordIndex, to: wordIndex })
      updateSelection(null); seek(Math.max(targetSentence.start, Math.min(word.start, targetSentence.end)))
    }
    void api.progress(material.id, { current_sentence: sentenceIndex, current_position: word.start })
  }

  const materialItem = (item: MaterialSummary) => (
    <button key={item.id} draggable className={`material-item ${selectedId === item.id ? 'active' : ''} ${item.completed ? 'completed' : ''} ${draggingMaterialId === item.id ? 'dragging' : ''}`} onClick={() => setSelectedId(item.id)} onDragStart={event => { setDraggingMaterialId(item.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id) }} onDragEnd={() => { setDraggingMaterialId(null); setDropTarget(null) }}>
      <strong>{item.completed && <i className="completed-mark">✓</i>}{item.name}</strong>
      <span>{item.completed ? 'Completed' : statusLabel(item)}{item.status === 'ready' ? ` · ${item.sentence_count} sentences` : ''}</span>
    </button>
  )
  const unfiledMaterials = materials.filter(item => !item.folder_id)
  const normalizedSourceSearch = sourceSearch.trim().toLowerCase()
  const visibleSources = sources.map(source => {
    if (!normalizedSourceSearch) return source
    const sourceMatches = `${source.name} ${source.provider} ${source.description} ${source.accent}`.toLowerCase().includes(normalizedSourceSearch)
    return { ...source, episodes: sourceMatches ? source.episodes : source.episodes.filter(episode => `${episode.title} ${episode.description}`.toLowerCase().includes(normalizedSourceSearch)) }
  }).filter(source => !normalizedSourceSearch || source.episodes.length || `${source.name} ${source.provider} ${source.description} ${source.accent}`.toLowerCase().includes(normalizedSourceSearch))

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">L</div><div><strong>Listening Lab</strong><span>Focused English practice</span></div></div>
        <label className={`upload-button ${uploading ? 'disabled' : ''}`}>
          <input type="file" accept=".mp3,.wav,.m4a,.mp4,.mov,audio/*,video/mp4,video/quicktime" disabled={uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void handleUpload(file) }} />
          <span>{uploading ? 'Importing…' : '＋ Import audio / video'}</span>
        </label>
        <label className="upload-destination">IMPORT TO<select value={uploadFolderId} onChange={event => setUploadFolderId(event.target.value)} disabled={uploading}><option value="">Unfiled</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
        <div className="library-heading"><span>LIBRARY</span><button onClick={() => setCreatingFolder(value => !value)} title="Create folder">＋</button></div>
        {creatingFolder && <form className="new-folder" onSubmit={event => { event.preventDefault(); void createFolder() }}>
          <input autoFocus value={folderName} maxLength={80} onChange={event => setFolderName(event.target.value)} placeholder="Folder name" />
          <button type="submit">Add</button>
        </form>}
        <div className="material-list">
          {folders.map(folder => <div className={`folder-group ${dropTarget === folder.id ? 'drop-target' : ''}`} key={folder.id} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(folder.id) }} onDrop={event => dropMaterial(event, folder.id)}>
            {editingFolderId === folder.id ? <form className="rename-folder" onSubmit={event => { event.preventDefault(); void renameFolder() }}>
              <input autoFocus maxLength={80} value={editingFolderName} onChange={event => setEditingFolderName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setEditingFolderId(null) }} />
              <button type="submit" title="Save folder name">✓</button><button type="button" title="Cancel" onClick={() => setEditingFolderId(null)}>×</button>
            </form> : <div className="folder-row"><span><b>⌄</b>{folder.name}<small>{materials.filter(item => item.folder_id === folder.id).length}</small></span><div><button title={`Rename ${folder.name}`} onClick={() => { setEditingFolderId(folder.id); setEditingFolderName(folder.name) }}>✎</button><button title={`Delete ${folder.name}`} onClick={() => setFolderToDelete(folder)}>×</button></div></div>}
            <div className="folder-materials">{materials.filter(item => item.folder_id === folder.id).map(materialItem)}{!materials.some(item => item.folder_id === folder.id) && <span className="empty-folder-drop">Drop material here</span>}</div>
          </div>)}
          {(folders.length > 0 || unfiledMaterials.length > 0) && <div className={`folder-group unfiled-group ${dropTarget === 'unfiled' ? 'drop-target' : ''}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget('unfiled') }} onDrop={event => dropMaterial(event, null)}>
            <div className="folder-row"><span><b>⌄</b>Unfiled<small>{unfiledMaterials.length}</small></span></div>
            <div className="folder-materials">{unfiledMaterials.map(materialItem)}{!unfiledMaterials.length && <span className="empty-folder-drop">Drop material here</span>}</div>
          </div>}
          {!materials.length && <p className="empty-tip">Import an mp3, wav, m4a, mp4, or mov to begin.</p>}
        </div>
        <button className="sources-button" onClick={() => void openPracticeSources()}><span>⌕</span><div><strong>Practice Sources</strong><small>BBC · VOA · NPR · TED</small></div></button>
        <div className="local-badge"><i /> Study processing stays local</div>
      </aside>

      <main className="workspace">
        {showSources && <div className="modal-backdrop sources-backdrop" role="presentation" onMouseDown={() => setShowSources(false)}><div className="sources-modal" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
          <header><div><span className="eyebrow">ONLINE DISCOVERY · FREE OFFICIAL SOURCES</span><h2>Practice Sources</h2><p>Natural, intermediate-to-advanced English. Open an episode, save the audio locally, then import it into Listening Lab.</p></div><button onClick={() => setShowSources(false)} aria-label="Close">×</button></header>
          <input className="source-search" type="search" value={sourceSearch} onChange={event => setSourceSearch(event.target.value)} placeholder="Search sources or recent episode topics…" />
          {sourcesLoading && <div className="source-loading">Reading official feeds…</div>}
          {!sourcesLoading && <div className="source-list">{visibleSources.map(source => <section className="source-card" key={source.id}>
            <div className="source-card-heading"><div><span>{source.provider}</span><h3>{source.name}</h3></div><b>{source.level}</b></div>
            <p>{source.description}</p><small>{source.accent}</small>
            <div className="episode-list">{source.episodes.slice(0, 5).map(episode => <article key={`${source.id}-${episode.title}-${episode.published}`}>
              <div><strong>{episode.title}</strong><span>{episode.duration_seconds ? formatDuration(episode.duration_seconds) : 'Duration varies'}</span></div>
              <p>{episode.description}</p>
              <nav>{episode.page_url && <a href={episode.page_url} target="_blank" rel="noreferrer">Episode page ↗</a>}{episode.audio_url && <a href={episode.audio_url} target="_blank" rel="noreferrer">Open audio ↗</a>}</nav>
            </article>)}</div>
            {!source.episodes.length && <p className="no-episodes">{source.available ? 'Open the official page to browse current material.' : 'The live feed is temporarily unavailable; the official page still works.'}</p>}
            <a className="source-home" href={source.site_url} target="_blank" rel="noreferrer">Browse {source.name} ↗</a>
          </section>)}</div>}
          {!sourcesLoading && !visibleSources.length && <div className="source-loading">No matching sources or episodes.</div>}
          <footer>Discovery links require internet access. Audio processing, Whisper transcription, and study records remain local. Follow each provider's terms of use.</footer>
        </div></div>}
        {folderToDelete && <div className="modal-backdrop" role="presentation" onMouseDown={() => setFolderToDelete(null)}><div className="delete-modal" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
          <span className="eyebrow">DELETE FOLDER</span><h2>{folderToDelete.name}</h2>
          <p>This folder contains {folderToDelete.material_count} material{folderToDelete.material_count === 1 ? '' : 's'}. Choose what should happen to them.</p>
          <div className="modal-actions"><button onClick={() => setFolderToDelete(null)}>Cancel</button><button onClick={() => void deleteFolder(false)}>Delete folder only</button><button className="danger-button" onClick={() => void deleteFolder(true)}>Delete folder and materials</button></div>
          <small>Deleting materials permanently removes their media, transcripts, dictations, and study history.</small>
        </div></div>}
        {notice && <button className="notice" onClick={() => setNotice('')}>{notice}<span>×</span></button>}
        {!material && <EmptyState onFile={handleUpload} />}
        {material && material.status !== 'ready' && <Processing material={material} />}
        {material && material.status === 'ready' && sentence && <>
          <header className="topbar">
            <div><span className="eyebrow">NOW STUDYING</span><h1>{material.name}</h1></div>
            <div className="progress-copy">Sentence <strong>{index + 1}</strong> of {material.sentences.length}</div>
          </header>
          <div className="material-management">
            <label>FOLDER<select value={material.folder_id ?? ''} onChange={event => void updateMaterialMeta({ folder_id: event.target.value || null })}><option value="">Unfiled</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
            <button className={material.completed ? 'complete active' : 'complete'} onClick={() => void updateMaterialMeta({ completed: !material.completed })}>{material.completed ? '✓ Completed' : 'Mark as completed'}</button>
            <button className="delete-material" onClick={() => void deleteCurrentMaterial()}>Delete material</button>
          </div>

          <section className="listen-card">
            <div className="sentence-heading">
              <span className="sentence-number">{String(index + 1).padStart(2, '0')}</span>
              <p className={showAnswer ? '' : 'answer-mask'}>{showAnswer ? sentence.text : 'Listen carefully. Type what you hear.'}</p>
              <button className="ghost-button" onClick={() => setShowAnswer(value => !value)}>{showAnswer ? 'Hide answer' : 'Show answer'}</button>
            </div>

            <Waveform materialId={material.id} sentence={sentence} currentTime={currentTime} selection={selection} onSelectionChange={updateSelection} onSeek={seek} />

            <div className="transport">
              <div className="transport-main">
                <button onClick={() => goTo(index - 1)} disabled={index === 0} title="Previous sentence (←)">‹</button>
                <button onClick={replay} title="Replay (R)">↺</button>
                <button className="play-button" onClick={togglePlay} title="Play / pause (Space)">{playing ? '❚❚' : '▶'}</button>
                <button className={loop ? 'toggle-on' : ''} onClick={toggleLoop} title="Loop sentence or selection">A↔B</button>
                <button onClick={() => goTo(index + 1)} disabled={index === material.sentences.length - 1} title="Next sentence (→)">›</button>
              </div>
              <div className="speed-control"><span>SPEED</span>{RATES.map(value => <button key={value} className={rate === value ? 'active' : ''} onClick={() => changeRate(value)}>{value}×</button>)}</div>
            </div>
            <div className="sentence-repeat-control">
              <span>REPEAT WHOLE SENTENCE</span>
              <input type="number" min="2" max="50" step="1" value={repeatCount} disabled={Boolean(repeatRun)} onChange={event => setRepeatCount(Number(event.target.value))} onBlur={() => setRepeatCount(Math.max(2, Math.min(50, Math.round(repeatCount || 2))))} aria-label="Number of sentence plays" />
              <span>times</span>
              <button className={repeatRun ? 'active' : ''} onClick={toggleSentenceRepeat}>{repeatRun ? `Stop · playing ${repeatRun.current}/${repeatRun.total}` : 'Start continuous play'}</button>
            </div>
            {selection && <button className="clear-selection" onClick={() => { updateSelection(null); seek(sentence.start) }}>Clear selection and play the full sentence</button>}

            <details className="boundary-editor">
              <summary>Adjust sentence time range</summary>
              <div><label>Start (seconds)<input type="number" min="0" step="0.01" value={timeDraft.start} onChange={event => setTimeDraft({ ...timeDraft, start: event.target.value })} /></label>
              <label>End (seconds)<input type="number" min="0" step="0.01" value={timeDraft.end} onChange={event => setTimeDraft({ ...timeDraft, end: event.target.value })} /></label>
              <button onClick={() => void updateBoundary()}>Save range</button></div>
            </details>
          </section>

          <section className="dictation-card">
            <div className="section-title"><div><span className="eyebrow">DICTATION</span><h2>Type what you hear</h2></div><span>Autosaved</span></div>
            <textarea value={answer} onChange={event => answerChanged(event.target.value)} placeholder="Type the English sentence here…" spellCheck={false} />
            <div className="dictation-actions"><button className="primary-button" onClick={check}>Check answer</button><button className="ghost-button" onClick={() => setShowAnswer(value => !value)}>{showAnswer ? 'Hide answer' : 'Show answer'}</button></div>
            {diff && <DiffView items={diff} />}
          </section>

          <section className="transcript-card">
            <div className="section-title"><div><span className="eyebrow">TRANSCRIPT · {transcriptSource(material.transcript_source)}</span><h2>Full transcript</h2></div><div className="subtitle-tools"><span>{showAnswer ? 'Click a word to seek · Shift-click to select a phrase' : 'Show the answer to enable word-level seeking'}</span><label className={uploadingSubtitles ? 'disabled' : ''}><input type="file" accept=".srt,.vtt,text/vtt" disabled={uploadingSubtitles} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void handleSubtitleUpload(file) }} />{uploadingSubtitles ? 'Importing…' : 'Import official SRT/VTT'}</label></div></div>
            <div className={`transcript ${showAnswer ? '' : 'transcript-hidden'}`}>
              {material.sentences.map((item, sentenceIndex) => <div key={item.id} className={`transcript-line ${sentenceIndex === index ? 'current' : ''}`} onClick={() => !showAnswer && goTo(sentenceIndex)}>
                <button className="line-time" onClick={() => goTo(sentenceIndex)}>{formatTime(item.start)}</button>
                <p>{showAnswer ? item.words.map((word, wordIndex) => {
                  const chosen = wordRange?.sentence === sentenceIndex && wordIndex >= wordRange.from && wordIndex <= wordRange.to
                  return <button key={`${word.start}-${wordIndex}`} className={`word ${chosen ? 'chosen' : ''}`} onClick={event => clickWord(sentenceIndex, wordIndex, event)}>{word.text}</button>
                }) : <span className="masked-line">{maskedText(item.text, false)}</span>}</p>
              </div>)}
            </div>
          </section>

          <audio ref={audio} src={`/api/materials/${material.id}/audio`} preload="auto" onLoadedMetadata={() => seek(material.current_position || sentence.start)} onTimeUpdate={updatePlayback} onPlay={playbackStarted} onPause={playbackPaused} />
          <div className="shortcuts">Shortcuts: Space play/pause · ←/→ sentence · R replay · +/− speed</div>
        </>}
      </main>
    </div>
  )
}

function statusLabel(item: MaterialSummary) {
  if (item.status === 'processing') return 'Extracting audio'
  if (item.status === 'transcribing') return 'Transcribing locally'
  if (item.status === 'error') return 'Processing failed'
  return item.duration ? formatTime(item.duration) : 'Ready'
}
function transcriptSource(source: Material['transcript_source']) {
  if (source === 'official_embedded') return 'OFFICIAL · EMBEDDED'
  if (source === 'official_import') return 'OFFICIAL · IMPORTED'
  return 'WHISPER'
}
function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes} min`
}
function maskedText(text: string, visible: boolean) {
  if (visible) return text
  return text.replace(/[A-Za-z0-9]/g, '•')
}
function Processing({ material }: { material: Material }) {
  return <div className="center-state"><div className={material.status === 'error' ? 'error-orb' : 'processing-orb'}>{material.status === 'error' ? '!' : ''}</div><h2>{material.status === 'error' ? 'Processing failed' : material.status === 'transcribing' ? 'Transcribing locally with MLX Whisper' : 'Extracting audio'}</h2><p>{material.status === 'error' ? material.error : 'Processing time depends on the media length. The free model downloads once on first use; this page will open automatically when ready.'}</p></div>
}
function EmptyState({ onFile }: { onFile: (file?: File) => void }) {
  return <div className="center-state"><div className="empty-orb">♪</div><h2>Start focused listening</h2><p>Import local audio or video. Your media, transcript, and study history stay on this Mac.</p><label className="primary-button file-label"><input type="file" accept=".mp3,.wav,.m4a,.mp4,.mov" onChange={event => void onFile(event.target.files?.[0])} />Choose a file</label></div>
}
