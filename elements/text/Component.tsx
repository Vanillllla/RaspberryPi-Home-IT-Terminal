import type { ElementProps } from '@terminal/element'

export default function Text({ properties: p }: ElementProps) {
  return <output style={{ display: 'flex', alignItems: 'center', whiteSpace: 'pre-wrap', overflow: 'auto',
    color: String(p.color), fontSize: Number(p.fontSize), fontFamily: String(p.font) }}>{String(p.text)}</output>
}
