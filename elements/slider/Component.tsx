import type { ElementProps } from '@terminal/element'
import { useState } from 'react'

export default function Slider({ properties: p, emit }: ElementProps) {
  const [draft, setDraft] = useState<number | null>(null)
  return <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <input style={{ minWidth: 0, flex: 1 }} type="range" aria-label={String(p.label)} disabled={!p.enabled}
      min={Number(p.minimum)} max={Number(p.maximum)} step={Number(p.step)} value={draft ?? Number(p.value)}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDraft(Number(p.value)) }}
      onPointerCancel={() => setDraft(null)}
      onChange={e => { if (draft === null) emit('onChange', { value: e.target.valueAsNumber }); else setDraft(e.target.valueAsNumber) }}
      onPointerUp={e => { emit('onChange', { value: e.currentTarget.valueAsNumber }); setDraft(null) }} />
    <output>{draft ?? Number(p.value)}</output>
  </label>
}
