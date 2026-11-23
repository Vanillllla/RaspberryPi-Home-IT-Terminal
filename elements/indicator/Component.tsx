import type { ElementProps } from '@terminal/element'

export default function Indicator({ properties: p }: ElementProps) {
  return <output style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', background: String(p.color) }} />
    {String(p.label)}
  </output>
}
