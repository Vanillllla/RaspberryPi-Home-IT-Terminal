import { useState } from 'react'
import { useTranslation, useWords } from '../i18n'
import { palettes } from '../appearance'
import type { Appearance, Json, Layout, Mode, Property } from './model'

export function ValueField({ name, spec, value, change }: { name: string; spec: Property; value: Json; change: (v: Json) => void }) {
  const { language } = useTranslation()
  const w = useWords()
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const title = spec.label[language] || name
  let input
  if (spec.type === 'boolean') input = <input type="checkbox" checked={Boolean(value)} onChange={e => change(e.target.checked)} />
  else if (spec.type === 'choice') input = <select value={String(value)} onChange={e => change(e.target.value)}>
    {spec.options?.map(v => <option key={v} value={v}>{spec.optionLabels?.[v]?.[language] ?? v}</option>)}</select>
  else if (spec.type === 'json') input = <textarea rows={3} value={draft ?? JSON.stringify(value)} aria-invalid={invalid}
    onChange={e => {
      const raw = e.target.value
      setDraft(raw)
      try { const parsed = JSON.parse(raw); setInvalid(false); change(parsed) } catch { setInvalid(true) }
    }} onBlur={() => { if (!invalid) setDraft(null) }} />
  else if (spec.type === 'number') input = <input type="number" step="any" min={spec.min ?? undefined} max={spec.max ?? undefined}
    value={draft ?? Number(value)} onChange={e => {
      setDraft(e.target.value)
      if (e.target.validity.valid && Number.isFinite(e.target.valueAsNumber)) change(e.target.valueAsNumber)
    }} onBlur={() => setDraft(null)} />
  else input = <input type={spec.type === 'secret' ? 'password' : 'text'} autoComplete={spec.type === 'secret' ? 'new-password' : 'off'}
    value={String(value ?? '')} onChange={e => change(e.target.value)} />
  return <label className="engine-field" title={spec.description?.[language]}>{title}{input}
    {invalid && <small role="alert">{w('Проверьте JSON', 'Check JSON syntax')}</small>}</label>
}

export function ModeOptions() {
  const w = useWords()
  return <><option value="event">{w('По событиям', 'Events only')}</option>
    <option value="visible">{w('При отображении', 'While visible')}</option>
    <option value="background">{w('В фоне', 'Background')}</option></>
}

export type RunOverride = { mode?: Mode | null; interval?: number | null }

export function LookFields({ appearance, change, inherit = false }: {
  appearance: Appearance; change: (patch: Appearance) => void; inherit?: boolean
}) {
  const { t } = useTranslation()
  const w = useWords()
  const fallback = inherit ? w('Из проекта', 'From project') : w('По умолчанию', 'Default')
  return <div className="form-grid">
    <label>{w('Название карточки', 'Card title')}<input maxLength={100} value={appearance.customTitle ?? ''}
      placeholder={fallback} onChange={e => change({ customTitle: e.target.value || null })} /></label>
    <label>{w('Заголовок', 'Heading')}<select value={appearance.hideTitle == null ? '' : String(appearance.hideTitle)}
      onChange={e => change({ hideTitle: e.target.value === '' ? null : e.target.value === 'true' })}>
      <option value="">{fallback}</option><option value="false">{w('Показывать', 'Show')}</option>
      <option value="true">{w('Скрывать', 'Hide')}</option></select></label>
    {(['cardPalette', 'titlePalette'] as const).map(key => <label key={key}>
      {key === 'cardPalette' ? w('Фон карточки', 'Card background') : w('Фон заголовка', 'Title background')}
      <select value={appearance[key] ?? ''} onChange={e => change({ [key]: e.target.value || null })}>
        <option value="">{fallback}</option>{Object.entries(palettes).map(([k, text]) =>
          <option key={k} value={k}>{t(text)}</option>)}</select></label>)}
  </div>
}

export function LayoutFields({ layout, update }: { layout: Layout; update: (v: Layout) => void }) {
  const w = useWords()
  return <div className="form-grid"><label>{w('Компоновка', 'Layout')}<select value={layout.mode}
    onChange={e => update({ ...layout, mode: e.target.value as Layout['mode'] })}>
    <option value="fixed">{w('Свободная', 'Fixed')}</option><option value="row">{w('Строка', 'Row')}</option>
    <option value="column">{w('Колонка', 'Column')}</option></select></label>
    {layout.mode !== 'fixed' && <><label>{w('Выравнивание', 'Alignment')}<select value={layout.align}
      onChange={e => update({ ...layout, align: e.target.value as Layout['align'] })}>
      {Object.entries({ start: w('Начало', 'Start'), center: w('Центр', 'Center'), end: w('Конец', 'End'), stretch: w('Растянуть', 'Stretch') })
        .map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>{w('Отступ', 'Gap')}<input type="number" min={0} max={8192} value={layout.gap}
        onChange={e => update({ ...layout, gap: Math.max(0, Math.min(8192, e.target.valueAsNumber || 0)) })} /></label></>}
  </div>
}
