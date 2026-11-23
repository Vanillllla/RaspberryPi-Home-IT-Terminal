import type { ElementProps } from '@terminal/element'

export default function Divider({ properties: p }: ElementProps) {
  const vertical = p.orientation === 'vertical'
  return <div className="element-fill" role="separator" aria-orientation={vertical ? 'vertical' : 'horizontal'}
    style={{ display: 'grid', placeItems: 'center' }}>
    <span style={{ background: String(p.color), width: vertical ? 2 : '100%', height: vertical ? '100%' : 2 }} />
  </div>
}
