import type { ElementProps } from '@terminal/element'

export default function LineChart({ properties: p, language }: ElementProps) {
  const points = Array.isArray(p.points) ? p.points.filter((v): v is number[] =>
    Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n))) : []
  const times = points.map(point => point[0]), values = points.map(point => point[1])
  const left = Math.min(...times), right = Math.max(...times)
  const low = Math.min(...values), high = Math.max(...values)
  const line = points.map(([t, v]) => [28 + (t-left) / (right-left || 1) * 306, 126 - (v-low) / (high-low || 1) * 102].join(',')).join(' ')
  const time = (stamp: number) => new Date(stamp * 1000).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return <svg width="100%" height="100%" viewBox="0 0 360 160" role="img" aria-label={String(p.label) + ' · ' + points.length}>
    <title>{String(p.label)}</title><path d="M28 15v111h306" fill="none" stroke="currentColor" opacity=".4" />
    {points.length ? <><polyline points={line} stroke={String(p.color)} strokeWidth="3" fill="none" />
      <text x="2" y="20" fill="currentColor" fontSize="11">{Math.round(high)}</text>
      <text x="2" y="126" fill="currentColor" fontSize="11">{Math.round(low)}</text>
      <text x="28" y="148" fill="currentColor" fontSize="12">{time(left)}</text>
      <text x="334" y="148" fill="currentColor" textAnchor="end" fontSize="12">{time(right)}</text></> :
      <text x="180" y="78" fill="currentColor" textAnchor="middle">{language === 'ru' ? 'Нет данных' : 'No samples'}</text>}
  </svg>
}
