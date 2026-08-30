import { useEffect, useMemo, useRef, useState } from 'react'
import type { Peaks, Selection, Sentence } from './types'

type Props = {
  materialId: string
  sentence: Sentence
  currentTime: number
  selection: Selection | null
  onSelectionChange: (selection: Selection | null) => void
  onSeek: (time: number) => void
}

type Gesture = { mode: 'new' | 'left' | 'right'; origin: number; moved: boolean }
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

export default function Waveform({ materialId, sentence, currentTime, selection, onSelectionChange, onSeek }: Props) {
  const [data, setData] = useState<Peaks | null>(null)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const latestSelection = useRef<Selection | null>(selection)
  const duration = sentence.end - sentence.start

  useEffect(() => { latestSelection.current = selection }, [selection])

  const emitSelection = (next: Selection | null) => {
    latestSelection.current = next
    onSelectionChange(next)
  }

  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError('')
    const query = new URLSearchParams({ start: String(sentence.start), end: String(sentence.end), buckets: '900' })
    fetch(`/api/materials/${materialId}/waveform?${query}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error((await response.json()).detail ?? 'Could not load the waveform')
        return response.json() as Promise<Peaks>
      })
      .then(setData)
      .catch(reason => { if (reason.name !== 'AbortError') setError(reason.message) })
    return () => controller.abort()
  }, [materialId, sentence.id, sentence.start, sentence.end])

  const timeAtPointer = (clientX: number) => {
    const bounds = root.current!.getBoundingClientRect()
    return sentence.start + clamp((clientX - bounds.left) / bounds.width, 0, 1) * duration
  }
  const begin = (mode: Gesture['mode'], event: React.PointerEvent, origin?: number) => {
    event.preventDefault(); event.stopPropagation()
    root.current?.setPointerCapture(event.pointerId)
    const time = origin ?? timeAtPointer(event.clientX)
    gesture.current = { mode, origin: time, moved: false }
    if (mode === 'new') emitSelection({ start: time, end: time })
  }
  const move = (event: React.PointerEvent) => {
    const active = gesture.current
    if (!active) return
    const time = timeAtPointer(event.clientX)
    if (Math.abs(time - active.origin) > Math.max(0.025, duration / 500)) active.moved = true
    const current = latestSelection.current
    if (active.mode === 'new') emitSelection({ start: Math.min(active.origin, time), end: Math.max(active.origin, time) })
    if (active.mode === 'left' && current) emitSelection({ start: Math.min(time, current.end - 0.02), end: current.end })
    if (active.mode === 'right' && current) emitSelection({ start: current.start, end: Math.max(time, current.start + 0.02) })
  }
  const finish = (event: React.PointerEvent) => {
    const active = gesture.current
    if (!active) return
    const time = timeAtPointer(event.clientX)
    if (active.mode === 'new' && !active.moved) {
      emitSelection(null)
      onSeek(time)
    } else if (active.mode === 'new') {
      const next = { start: Math.min(active.origin, time), end: Math.max(active.origin, time) }
      emitSelection(next); onSeek(next.start)
    } else if (latestSelection.current) onSeek(latestSelection.current.start)
    gesture.current = null
  }
  const left = selection ? ((selection.start - sentence.start) / duration) * 100 : 0
  const right = selection ? ((selection.end - sentence.start) / duration) * 100 : 0
  const playhead = clamp(((currentTime - sentence.start) / duration) * 100, 0, 100)
  const bars = useMemo(() => data?.peaks ?? [], [data])

  return (
    <div className="waveform-shell">
      <div
        className="waveform" ref={root}
        onPointerDown={event => begin('new', event)} onPointerMove={move}
        onPointerUp={finish} onPointerCancel={() => { gesture.current = null }}
      >
        {!data && !error && <div className="waveform-loading">Reading audio samples…</div>}
        {error && <div className="waveform-loading error-text">{error}</div>}
        {data && (
          <svg viewBox={`0 0 ${bars.length} 100`} preserveAspectRatio="none" aria-label="Audio waveform">
            {bars.map(([low, high], index) => (
              <line key={index} x1={index + 0.5} x2={index + 0.5} y1={50 - high * 43} y2={50 - low * 43} />
            ))}
          </svg>
        )}
        <div className="wave-midline" />
        {selection && <>
          <div className="wave-selection" style={{ left: `${left}%`, width: `${right - left}%` }} />
          <button className="wave-handle left" style={{ left: `${left}%` }} onPointerDown={event => begin('left', event, selection.start)} aria-label="Drag selection start" />
          <button className="wave-handle right" style={{ left: `${right}%` }} onPointerDown={event => begin('right', event, selection.end)} aria-label="Drag selection end" />
        </>}
        <div className="wave-playhead" style={{ left: `${playhead}%` }} />
      </div>
      <div className="wave-times">
        <span>{formatTime(sentence.start)}</span>
        {selection ? (
          <strong>Selection {formatTime(selection.start)} — {formatTime(selection.end)} · {(selection.end - selection.start).toFixed(2)}s</strong>
        ) : <span>Drag to select A–B · Click to seek</span>}
        <span>{formatTime(sentence.end)}</span>
      </div>
    </div>
  )
}

export function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, '0')}`
}
