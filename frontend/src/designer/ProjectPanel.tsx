import { useState } from 'react'
import { useWords } from '../i18n'
import { LookFields, ModeOptions, ValueField } from '../engine/Fields'
import type { Mode, Project, Property } from '../engine/model'
import { HandlerField } from './Logic'

interface Props { project: Project; edit: (p: Project) => void; saved: boolean; jump: (name: string) => void }
export function ProjectPanel({ project: p, edit, saved, jump }: Props) {
  const w = useWords()
  const [key, setKey] = useState(''), [event, setEvent] = useState('')
  const [kind, setKind] = useState<Property['type']>('string')
  const identifier = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
  function changeSetting(id: string, patch: Partial<Property>) { edit({ ...p, settings: { ...p.settings, [id]: { ...p.settings[id], ...patch } } }) }
  return <div className="project-panel">
    <fieldset><legend>{w('Проект', 'Project')}</legend><div className="form-grid">
      <label>ID<input disabled={saved} maxLength={64} value={p.id} onChange={e => edit({ ...p, id: e.target.value })} /></label>
      <label>{w('Версия', 'Version')}<input value={p.version} onChange={e => edit({ ...p, version: e.target.value })} /></label>
      {(['ru','en'] as const).map(lang => <label key={lang}>{w('Название', 'Name')} · {lang}
        <input value={p.name[lang]} onChange={e => edit({ ...p, name: { ...p.name, [lang]: e.target.value } })} /></label>)}
      {(['ru','en'] as const).map(lang => <label key={lang}>{w('Описание', 'Description')} · {lang}
        <textarea value={p.description[lang]} onChange={e => edit({ ...p, description: { ...p.description, [lang]: e.target.value } })} /></label>)}
      <label>{w('Автор', 'Author')}<input value={p.author} onChange={e => edit({ ...p, author: e.target.value })} /></label>
      <label>{w('Иконка из assets', 'Icon in assets')}<input value={p.icon} onChange={e => edit({ ...p, icon: e.target.value })} /></label>
    </div></fieldset>
    <fieldset><legend>{w('Оформление по умолчанию', 'Default appearance')}</legend>
      <LookFields appearance={p.appearance} change={patch => edit({ ...p, appearance: { ...p.appearance, ...patch } })} /></fieldset>
    <fieldset><legend>{w('Выполнение', 'Execution')}</legend><div className="form-grid">
      <label>{w('Режим', 'Mode')}<select value={p.execution.mode}
        onChange={e => edit({ ...p, execution: { ...p.execution, mode: e.target.value as Mode } })}><ModeOptions /></select></label>
      <label>{w('Интервал, с', 'Interval, s')}<input type="number" min={1} max={86400} value={p.execution.interval}
        onChange={e => edit({ ...p, execution: { ...p.execution, interval: e.target.valueAsNumber || 1 } })} /></label></div>
      <HandlerField label={w('Периодический обработчик', 'Periodic handler')} source={p.source} value={p.execution.handler ?? ''}
        update={handler => edit({ ...p, execution: { ...p.execution, handler: handler || null } })} jump={jump} />
    </fieldset>
    <fieldset><legend>{w('События проекта', 'Project events')}</legend>
      {Object.entries(p.events).map(([id, fn]) => <div key={id}><HandlerField label={id} source={p.source} value={fn} jump={jump}
        update={name => edit({ ...p, events: { ...p.events, [id]: name } })} /><button onClick={() => {
          const events = { ...p.events }; delete events[id]; edit({ ...p, events })
        }}>{w('Удалить', 'Remove')} · {id}</button></div>)}
      <div className="binding"><label>{w('Новое событие', 'New event')}<input value={event} onChange={e => setEvent(e.target.value)} /></label>
        <button disabled={!identifier.test(event) || Object.hasOwn(p.events, event)}
          onClick={() => { edit({ ...p, events: { ...p.events, [event]: event } }); setEvent('') }}>{w('Добавить', 'Add')}</button></div>
    </fieldset>
    <fieldset><legend>{w('Параметры экземпляра', 'Instance parameters')}</legend>
      {Object.entries(p.settings).map(([id, spec]) => <details key={id}><summary>{id} · {spec.type}</summary>
        {(['ru','en'] as const).map(lang => <label key={lang}>{w('Подпись', 'Label')} · {lang}
          <input value={spec.label[lang]} onChange={e => changeSetting(id, { label: { ...spec.label, [lang]: e.target.value } })} /></label>)}
        {spec.type !== 'secret' && <ValueField spec={{ ...spec, label: { ru: 'По умолчанию', en: 'Default' } }}
          name={id} value={spec.default} change={value => changeSetting(id, { default: value })} />}
        <button onClick={() => { const settings = { ...p.settings }; delete settings[id]; edit({ ...p, settings }) }}>{w('Удалить', 'Remove')} · {id}</button></details>)}
      <div className="form-grid"><label>ID<input value={key} onChange={e => setKey(e.target.value)} /></label>
        <label>{w('Тип', 'Type')}<select value={kind} onChange={e => setKind(e.target.value as Property['type'])}>
          {['string','number','boolean','color','json','secret'].map(k => <option key={k}>{k}</option>)}</select></label></div>
      <button disabled={!identifier.test(key) || Object.hasOwn(p.settings, key)} onClick={() => {
        const defaults = { string: '', number: 0, boolean: false, color: '#168567', json: [], secret: '', choice: '' }
        edit({ ...p, settings: { ...p.settings, [key]: { type: kind, label: { en: key, ru: key }, default: defaults[kind] } } }); setKey('')
      }}>{w('Добавить параметр', 'Add parameter')}</button>
    </fieldset>
    <fieldset><legend>{w('Зависимости', 'Dependencies')}</legend>{(['python','host'] as const).map(k =>
      <label key={k}>{k === 'python' ? 'Python' : w('Возможности хоста', 'Host capabilities')}
        <input defaultValue={p.dependencies[k].join(', ')} placeholder={w('Через запятую', 'Comma separated')}
          onBlur={e => edit({ ...p, dependencies: { ...p.dependencies, [k]: e.target.value.split(',').map(v => v.trim()).filter(Boolean) } })} /></label>)}</fieldset>
  </div>
}
