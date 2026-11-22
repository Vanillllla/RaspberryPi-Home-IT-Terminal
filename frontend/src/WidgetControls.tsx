import type { CSSProperties } from 'react'
import './widget-controls.css'

interface SwitchProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function WidgetSwitch({ label, checked, onChange }: SwitchProps) {
  return <label className="widget-switch">
    <input type="checkbox" role="switch" aria-label={label || 'Переключатель'} checked={checked} onChange={event => onChange(event.currentTarget.checked)} />
    {label && <span>{label}</span>}
  </label>
}

interface SliderProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  valueText?: string
  onChange: (value: number) => void
}

export function WidgetSlider({ label, min, max, step, value, valueText, onChange }: SliderProps) {
  const position = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0
  return <span className="widget-range" style={{ '--position': position } as CSSProperties}>
    <input className="widget-slider" type="range" min={min} max={max} step={step} value={value}
      aria-label={label} aria-valuetext={valueText} onChange={event => onChange(event.currentTarget.valueAsNumber)} />
    <span className="widget-slider-track" aria-hidden="true" />
  </span>
}
