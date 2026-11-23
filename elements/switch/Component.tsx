import type { ElementProps } from '@terminal/element'
import './switch.css'

export default function Switch({ properties, emit }: ElementProps) {
  return <label className="terminal-switch">
    <input type="checkbox" role="switch" disabled={!properties.enabled} checked={Boolean(properties.value)}
      onChange={event => emit('onChange', { value: event.currentTarget.checked })} />
    <span className="terminal-switch-track" aria-hidden="true" />
    <span>{String(properties.label)}</span>
  </label>
}
