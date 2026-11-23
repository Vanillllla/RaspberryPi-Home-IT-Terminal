import type { ElementProps } from '@terminal/element'

export default function CircularGauge({ properties: p, emit }: ElementProps) {
  const span = Number(p.maximum) - Number(p.minimum)
  const percent = span > 0 ? Math.min(100, Math.max(0, 100 * (Number(p.value) - Number(p.minimum)) / span)) : 0
  return <button disabled={!p.enabled} aria-label={String(p.label) + ' · ' + p.value}
    onClick={() => emit('onClick')} style={{ border: 0, padding: 2, background: 'transparent' }}>
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      <circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" opacity=".15" strokeWidth="8" />
      <circle cx="50" cy="50" r="39" fill="none" stroke={String(p.color)} strokeWidth="8" strokeLinecap="round"
        pathLength="100" strokeDasharray={percent + ' 100'} transform="rotate(-90 50 50)" />
      <text x="50" y="58" textAnchor="middle" fill="currentColor" fontSize="22">{String(p.value)}</text>
    </svg></button>
}
