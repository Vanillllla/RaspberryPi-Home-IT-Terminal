import type { ElementProps } from '@terminal/element'

export default function Button({ properties, emit }: ElementProps) {
  return <button disabled={!properties.enabled} onClick={() => emit('onClick')}>{String(properties.text)}</button>
}
