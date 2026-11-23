import { useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import { useTranslation, useWords } from './i18n'
import { LookFields, ModeOptions, ValueField, type RunOverride } from './engine/Fields'
import type { Appearance, Mode, Published, Values, WidgetInstance } from './engine/model'

export function InstanceSettings({ widget, project, children, saved }: {
  widget: WidgetInstance; project?: Published; children?: ReactNode; saved: () => Promise<void>
}) {
  const w = useWords()
  const { t, language } = useTranslation()
  const [original, setOriginal] = useState<WidgetInstance | null>(null)
  const base = original ?? widget
  function startEdit() { setOriginal(previous => previous ?? widget) }
  const [look, setLook] = useState<Appearance>({})
  const [run, setRun] = useState<RunOverride>({})
  const [settings, setSettings] = useState<Values>({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const mode = { ...base.execution, ...run }
  const dirty = Object.keys(look).length + Object.keys(run).length + Object.keys(settings).length > 0
  function reset() { setOriginal(null); setLook({}); setRun({}); setSettings({}); setError(''); setConflict(false) }
  const fields = Object.entries(project?.settings ?? {})
  return <div className="instance-config">
    {children}
    <form onSubmit={async e => {
      e.preventDefault(); setPending(true); setError('')
      try {
        await api('widgets/' + widget.id + '/configuration', 'PUT', {
          expected: base.config_version, appearance: look, execution: run, settings,
        })
        await saved()
      } catch (err) { setError(String(err)); setConflict(err instanceof ApiError && err.status === 409) }
      finally { setPending(false) }
    }}>
      <fieldset disabled={pending}><legend>{w('Оформление экземпляра', 'Instance appearance')}</legend>
        <LookFields inherit appearance={{ ...base.appearance, ...look }} change={p => { startEdit(); setLook({ ...look, ...p }) }} /></fieldset>
      {project?.execution.handler && <fieldset disabled={pending}><legend>{w('Выполнение', 'Execution')}</legend>
        <div className="form-grid"><label>{w('Режим', 'Mode')}<select value={mode.mode ?? ''}
          onChange={e => { startEdit(); setRun({ ...run, mode: e.target.value as Mode || null }) }}>
          <option value="">{w('Из проекта', 'From project')}</option><ModeOptions /></select></label>
          <label>{w('Интервал, с', 'Interval, s')}<input type="number" min={1} max={86400} value={mode.interval ?? ''}
            placeholder={String(project.execution.interval)} onChange={e => { startEdit(); setRun({ ...run, interval: e.target.valueAsNumber || null }) }} /></label>
        </div></fieldset>}
      {fields.length > 0 && <fieldset disabled={pending}><legend>{w('Параметры', 'Parameters')}</legend>
        {fields.map(([key, spec]) => <div key={key}>
          <ValueField name={key} spec={spec} value={Object.hasOwn(settings, key) ? settings[key] : base.settings[key] ?? spec.default}
            change={val => { startEdit(); setSettings({ ...settings, [key]: val }) }} />
          {spec.type === 'secret' && base.configuredSecrets.includes(key) && <small>{w('Секрет сохранён', 'Secret configured')}</small>}
          {spec.type === 'secret' && <button type="button" onClick={() => { startEdit(); setSettings({ ...settings, [key]: null }) }}>
            {w('Очистить', 'Clear')} · {spec.label[language]}</button>}</div>)}</fieldset>}
      {error && <p role="alert">{error}</p>}
      {(conflict || base.config_version !== widget.config_version) && <button type="button" onClick={reset}>{t('Загрузить актуальные данные')}</button>}
      <button className="primary" disabled={pending || !dirty}>{t('Сохранить')}</button>
    </form></div>
}
