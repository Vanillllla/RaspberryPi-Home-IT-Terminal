import { useState, type FormEvent } from 'react'
import type { WidgetInstance } from './plugin'

interface Props {
  widget: WidgetInstance
  save: (width: number, height: number) => Promise<void>
}

export function SizeSettings({ widget, save }: Props) {
  const [width, setWidth] = useState(String(widget.width))
  const [height, setHeight] = useState(String(widget.height))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setError('')
    setSaved(false)
    if (![width, height].every(s => Number.isSafeInteger(Number(s)) && Number(s) > 0)) {
      setError('Введите целые положительные размеры')
      return
    }
    setSaving(true)
    try {
      await save(Number(width), Number(height))
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить размер')
    } finally {
      setSaving(false)
    }
  }

  return <form className="instance-settings" onSubmit={submit} onChange={() => { setSaved(false); setError('') }}>
    <h3>Размер</h3>
    <label>Ширина в клетках<input type="number" min="1" required value={width} disabled={saving}
      onChange={e => setWidth(e.target.value)} /></label>
    <label>Высота в клетках<input type="number" min="1" required value={height} disabled={saving}
      onChange={e => setHeight(e.target.value)} /></label>
    <button disabled={saving}>Сохранить размер</button>
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Размер сохранён</p>}
  </form>
}
