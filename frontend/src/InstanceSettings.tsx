import { useTranslation } from './i18n'
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
  const { t } = useTranslation()
  return <fieldset className="palette-picker">
    <legend>{label}</legend>
    {Object.entries(palettes).map(([key, text]) =>
      <label key={key} title={t(text)}>
        <input type="radio" name={name} aria-label={t(text)} checked={value === key}
          onChange={() => change(key as Palette)} />
        <span data-palette={key} aria-hidden="true">{value === key ? '✓' : ''}</span>
      </label>)}
  </fieldset>
}

export function InstanceSettings({ widget, defaultTitle, pluginSettings, busy, save }: {
  widget: WidgetInstance; defaultTitle: string; pluginSettings: boolean; busy: boolean; save: (draft: Configuration) => Promise<void>
}) {
  const { t } = useTranslation()
  const [width, setWidth] = useState(String(widget.width))
  const [height, setHeight] = useState(String(widget.height))
  const [appearance, setAppearance] = useState(() => cardAppearance(widget.appearance))
  const [error, setError] = useState('')
  const common = useRef<HTMLFormElement>(null)
  const plugin = useRef<HTMLDivElement>(null)

  async function persist(settings?: WidgetInstance['settings']) {
    if (!common.current?.reportValidity()) throw new Error(t('Проверьте размер карточки'))
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
        <legend>{t('Оформление')}</legend>
        <label>{t('Название виджета')}<input type="text" maxLength={100} placeholder={defaultTitle}
          value={appearance.customTitle} onChange={e => setAppearance({ ...appearance, customTitle: e.target.value })} /></label>
        <label className="hide-card-title"><input type="checkbox" checked={appearance.hideTitle}
          onChange={e => setAppearance({ ...appearance, hideTitle: e.target.checked })} />{t('Скрыть название')}</label>
        <PalettePicker label={t('Фон названия')} name="titlePalette" value={appearance.titlePalette}
          change={titlePalette => setAppearance({ ...appearance, titlePalette })} />
        <PalettePicker label={t('Фон карточки')} name="cardPalette" value={appearance.cardPalette}
          change={cardPalette => setAppearance({ ...appearance, cardPalette })} />
      </fieldset>
      <fieldset className="instance-settings" disabled={busy}>
        <legend>{t('Размер')}</legend>
        <label>{t('Ширина в клетках')}<input type="number" min="1" required value={width} onChange={e => setWidth(e.target.value)} /></label>
        <label>{t('Высота в клетках')}<input type="number" min="1" required value={height} onChange={e => setHeight(e.target.value)} /></label>
      </fieldset>
      <fieldset className="instance-settings" disabled={busy}>
        <legend>{t('Выравнивание содержимого')}</legend>
        <label>{t('По горизонтали')}<select value={appearance.horizontalAlign ?? 'left'}
          onChange={e => setAppearance({ ...appearance, horizontalAlign: e.target.value })}>
          <option value="left">{t('Слева')}</option><option value="center">{t('По центру')}</option><option value="right">{t('Справа')}</option>
        </select></label>
        <label>{t('По вертикали')}<select value={appearance.verticalAlign ?? 'top'}
          onChange={e => setAppearance({ ...appearance, verticalAlign: e.target.value })}>
          <option value="top">{t('Сверху')}</option><option value="center">{t('По центру')}</option><option value="bottom">{t('Снизу')}</option>
        </select></label>
      </fieldset>
    </form>
    {pluginSettings && <div ref={plugin} className="plugin-settings">
      <h3>{t('Настройки плагина')}</h3>
      <PluginView instance={widget} mode="Settings" saveSettings={persist} />
    </div>}
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button className="primary" type="submit" form="card-settings-form"
      disabled={busy}>{t('Сохранить')}</button></div>
  </div>
}
