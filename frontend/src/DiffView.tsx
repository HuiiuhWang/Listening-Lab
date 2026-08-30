import type { DiffItem } from './types'

export default function DiffView({ items }: { items: DiffItem[] }) {
  const stats = items.reduce((acc, item) => {
    if (item.type !== 'equal') acc[item.type] += 1
    return acc
  }, { missing: 0, extra: 0, replace: 0 })
  const perfect = stats.missing + stats.extra + stats.replace === 0
  return (
    <div className={`diff-result ${perfect ? 'perfect' : ''}`}>
      <div className="diff-summary">
        <strong>{perfect ? 'Perfect match' : 'Check result'}</strong>
        {!perfect && <span>Missing {stats.missing} · Wrong {stats.replace} · Extra {stats.extra}</span>}
      </div>
      <div className="diff-tokens">
        {items.map((item, index) => {
          if (item.type === 'equal') return <span className="diff-token equal" key={index}>{item.expected}</span>
          if (item.type === 'missing') return <span className="diff-token missing" key={index}><small>MISSING</small>{item.expected}</span>
          if (item.type === 'extra') return <span className="diff-token extra" key={index}><small>EXTRA</small>{item.actual}</span>
          return <span className="diff-token replace" key={index}><small>WRONG</small><del>{item.actual}</del><b>{item.expected}</b></span>
        })}
      </div>
    </div>
  )
}
