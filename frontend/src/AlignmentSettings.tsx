import { useState, type FormEvent } from 'react'
import type { WidgetInstance } from './plugin'

export function contentAlignment({ horizontalAlign, verticalAlign }: WidgetInstance['appearance']) {
  return {
    horizontalAlign: horizontalAlign === 'left' || horizontalAlign === 'center' || horizontalAlign === 'right'
      ? horizontalAlign : undefined,
    verticalAlign: verticalAlign === 'top' || verticalAlign === 'center' || verticalAlign === 'bottom'
      ? verticalAlign : undefined,
  }
}

interface Props {
  appearance: WidgetInstance['appearance']
  save: (horizontalAlign: string, verticalAlign: string) => Promise<void>
}

export function AlignmentSettings({ appearance, save }: Props) {
  const alignment = contentAlignment(appearance)
  const [horizontal, setHorizontal] = useState<string>(alignment.horizontalAlign ?? 'left')
  const [vertical, setVertical] = useState<string>(alignment.verticalAlign ?? 'top')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setError('')
    setSaved(false)
    setSaving(true)
    try {
      await save(horizontal, vertical)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить выравнивание')
    } finally {
      setSaving(false)
    }
  }

  return <form className="instance-settings alignment-settings" onSubmit={submit}
    onChange={() => { setSaved(false); setError('') }}>
    <h3>Выравнивание содержимого</h3>
    <label>По горизонтали
      <select value={horizontal} onChange={e => setHorizontal(e.target.value)} disabled={saving}>
        <option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option>
      </select>
    </label>
    <label>По вертикали
      <select value={vertical} onChange={e => setVertical(e.target.value)} disabled={saving}>
        <option value="top">Сверху</option><option value="center">По центру</option><option value="bottom">Снизу</option>
      </select>
    </label>
    <button disabled={saving}>Сохранить выравнивание</button>
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Выравнивание сохранено</p>}
  </form>
}
