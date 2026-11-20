import { useState, type FormEvent } from 'react'
import type { Plugin, WidgetProps } from '@terminal/plugin'
import './demo.css'

function labelOf({ settings }: WidgetProps['instance']) {
  return typeof settings.label === 'string' ? settings.label : 'Мой демовиджет'
}

function Widget({ instance }: WidgetProps) {
  const [count, setCount] = useState(0)
  return <div className="demo-widget">
    <strong>{labelOf(instance)}</strong>
    <button onClick={() => setCount(n => n + 1)}>Нажатий: {count}</button>
  </div>
}

function Details({ instance }: WidgetProps) {
  return <div className="demo-details">
    <h3>{labelOf(instance)}</h3>
    <dl>
      <dt>Экземпляр</dt><dd>{instance.id}</dd>
      <dt>Рабочий стол</dt><dd>{instance.desktop_id}</dd>
      <dt>Ячейка</dt><dd>{instance.slot + 1}</dd>
      <dt>Плагин</dt><dd>{instance.plugin_id}</dd>
    </dl>
  </div>
}

const Settings: NonNullable<Plugin['Settings']> = ({ instance, saveSettings }) => {
  const [label, setLabel] = useState(() => labelOf(instance))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await saveSettings({ ...instance.settings, label })
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить подпись')
    } finally {
      setSaving(false)
    }
  }

  return <form className="demo-form" onSubmit={submit}>
    <label>Подпись<input value={label} disabled={saving} required onChange={e => {
      setLabel(e.target.value)
      setSaved(false)
      setError('')
    }} /></label>
    <button className="primary" disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</button>
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Подпись сохранена</p>}
  </form>
}

export default { Widget, Details, Settings } satisfies Plugin
