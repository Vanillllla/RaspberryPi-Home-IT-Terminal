import { useRef, useState } from 'react'
import { cardAppearance, palettes, type Palette } from './appearance'
import { PluginView } from './PluginView'
import type { WidgetInstance } from './plugin'

export interface Configuration {
  width: number
  height: number
  appearance: ReturnType<typeof cardAppearance>
  settings?: WidgetInstance['settings']
}

function PalettePicker({ label, name, value, change }: {
  label: string; name: string; value: Palette; change: (value: Palette) => void
}) {
  return <fieldset className="palette-picker">
    <legend>{label}</legend>
    {Object.entries(palettes).map(([key, text]) =>
      <label key={key} title={text}>
        <input type="radio" name={name} aria-label={text} checked={value === key}
          onChange={() => change(key as Palette)} />
        <span data-palette={key} aria-hidden="true">{value === key ? '✓' : ''}</span>
      </label>)}
  </fieldset>
}

export function InstanceSettings({ widget, pluginSettings, busy, save }: {
  widget: WidgetInstance; pluginSettings: boolean; busy: boolean; save: (draft: Configuration) => Promise<void>
}) {
  const [width, setWidth] = useState(String(widget.width))
  const [height, setHeight] = useState(String(widget.height))
  const [appearance, setAppearance] = useState(() => cardAppearance(widget.appearance))
  const [error, setError] = useState('')
  const common = useRef<HTMLFormElement>(null)
  const plugin = useRef<HTMLDivElement>(null)

  async function persist(settings?: WidgetInstance['settings']) {
    if (!common.current?.reportValidity()) throw new Error('Проверьте размер карточки')
    await save({ width: Number(width), height: Number(height), appearance, settings })
  }

  return <div className="card-settings" onChange={() => setError('')}>
    <form id="card-settings-form" ref={common} onSubmit={e => {
      e.preventDefault()
      if (busy) return
      setError('')
      // Let a v1 plugin validate its own form and supply its settings to the same write.
      const pluginForm = plugin.current?.querySelector('form')
      if (pluginForm) pluginForm.requestSubmit()
      else void persist().catch(e => setError(e.message))
    }}>
      <fieldset className="instance-settings" disabled={busy}>
        <legend>Оформление</legend>
        <PalettePicker label="Фон названия" name="titlePalette" value={appearance.titlePalette}
          change={titlePalette => setAppearance({ ...appearance, titlePalette })} />
        <PalettePicker label="Фон карточки" name="cardPalette" value={appearance.cardPalette}
          change={cardPalette => setAppearance({ ...appearance, cardPalette })} />
      </fieldset>
      <fieldset className="instance-settings" disabled={busy}>
        <legend>Размер</legend>
        <label>Ширина в клетках<input type="number" min="1" required value={width} onChange={e => setWidth(e.target.value)} /></label>
        <label>Высота в клетках<input type="number" min="1" required value={height} onChange={e => setHeight(e.target.value)} /></label>
      </fieldset>
      <fieldset className="instance-settings" disabled={busy}>
        <legend>Выравнивание содержимого</legend>
        <label>По горизонтали<select value={appearance.horizontalAlign ?? 'left'}
          onChange={e => setAppearance({ ...appearance, horizontalAlign: e.target.value })}>
          <option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option>
        </select></label>
        <label>По вертикали<select value={appearance.verticalAlign ?? 'top'}
          onChange={e => setAppearance({ ...appearance, verticalAlign: e.target.value })}>
          <option value="top">Сверху</option><option value="center">По центру</option><option value="bottom">Снизу</option>
        </select></label>
      </fieldset>
    </form>
    {pluginSettings && <div ref={plugin} className="plugin-settings">
      <h3>Настройки плагина</h3>
      <PluginView instance={widget} mode="Settings" saveSettings={persist} />
    </div>}
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button className="primary" type="submit" form="card-settings-form"
      disabled={busy}>Сохранить</button></div>
  </div>
}
