import { useRef, useState, type RefObject } from 'react'
import { api, type State } from '../api'
import { useTranslation, useWords } from '../i18n'
import { FitView, type Library } from '../engine/Renderer'
import { useElementEvents } from '../engine/useElementEvents'
import { newProject, newView, viewLabels, type Project, type Properties, type Signal, type ViewName } from '../engine/model'
import { Workspace } from './Workspace'
import { LogicEditor, handlerNames } from './Logic'
import { ProjectPanel } from './ProjectPanel'
import { Help } from './Help'
import './designer.css'

type Tab = 'design' | 'python' | 'project' | 'help' | 'preview'
type PreviewState = { token: string | null; properties: Properties }
const viewNames: ViewName[] = ['widget','details','settings']

function Preview({ project, name, library }: { project: Project; name: ViewName; library: Library }) {
  const w = useWords()
  const current = useRef<PreviewState>({ properties: {}, token: null })
  const [snapshot, setSnapshot] = useState(current.current)
  const [error, setError] = useState('')
  const events = useElementEvents(setError)
  function run(event?: Signal, tick = false) {
    events.dispatch(0, event, async () => {
      const next = await api<PreviewState>('preview', 'POST', { project, event, tick, token: current.current.token })
      current.current = next; setSnapshot(next); setError('')
    })
  }
  return <section className="preview-area"><div className="subbar"><strong>{w('Тестовый экземпляр', 'Test instance')}</strong>
    {project.execution.handler && <button onClick={() => run(undefined, true)}>{w('Выполнить периодический обработчик', 'Run periodic handler')}</button>}
    {Object.keys(project.events).map(key => <button key={key} onClick={() => run({ name: key })}>{key}</button>)}</div>
    {error && <p role="alert">{error}</p>}
    {project.views[name] ? <div className="preview-view"><FitView project={project} name={name} library={library}
      properties={events.properties(0, snapshot.properties)} send={e => run(e)} /></div> : <p>{w('Представление отсутствует', 'View is absent')}</p>}
  </section>
}

export function Designer({ catalog, library, refresh, setBusy, dirty }: {
  catalog: State; library: Library; refresh: () => Promise<State>; setBusy: (v: boolean) => void; dirty: RefObject<boolean>
}) {
  const { language } = useTranslation(), w = useWords()
  const editor = useRef<HTMLDivElement>(null)
  const [project, setProject] = useState<Project>(newProject)
  const [revision, setRevision] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('design')
  const [name, setName] = useState<ViewName>('widget')
  const [selected, select] = useState('')
  const [target, setTarget] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(''), [status, setStatus] = useState('')
  const [draftChanged, setDraftChanged] = useState(false)
  const tabs: Record<Tab, string> = { design: w('Дизайн','Design'), python: 'Python', project: w('Проект','Project'),
    help: w('Справка','Reference'), preview: w('Предпросмотр','Preview') }
  function edit(p: Project) { setProject(p); dirty.current = true; setDraftChanged(true); setStatus('') }
  async function work(action: () => Promise<void>) {
    setPending(true); setBusy(true); setError(''); setStatus('')
    try { await action() } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setPending(false); setBusy(false) }
  }
  function open(id: string) {
    if (dirty.current && !window.confirm(w('Заменить несохранённый черновик?', 'Replace the unsaved draft?'))) return
    void work(async () => {
      const next = id ? await api<{ project: Project; revision: string }>('projects/' + id) : { project: newProject(), revision: null }
      setProject(next.project); setRevision(next.revision); setName('widget'); setTab('design'); select('')
      setDraftChanged(false); dirty.current = false
    })
  }
  function fieldsValid() {
    const field = editor.current?.querySelector<HTMLElement>('[aria-invalid="true"],input:invalid,textarea:invalid')
    if (!field) return true
    field.focus()
    setError(w('Исправьте значение в выделенном поле.', 'Correct the value in the focused field.'))
    return false
  }
  function save() {
    if (!fieldsValid()) return
    void work(async () => {
      const result = await api<{ revision: string }>('projects/' + encodeURIComponent(project.id), 'PUT', { project, expected: revision })
      setRevision(result.revision); setDraftChanged(false); dirty.current = false
      await refresh(); setStatus(w('Проект сохранён', 'Project saved'))
    })
  }
  function jump(fn: string) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(fn)) return
    if (!handlerNames(project.source).includes(fn)) {
      const prefix = project.source.trimEnd()
      edit({ ...project, source: (prefix ? prefix + '\n\n\n' : '') + 'def ' + fn + '(ctx):\n    pass\n' })
    }
    setTarget(fn); setTab('python')
  }
  function check(preview = false) {
    if (!fieldsValid()) return
    void work(async () => {
      await api('preview','POST',{ project })
      if (preview) setTab('preview')
      else setStatus(w('Синтаксис и привязки проверены', 'Syntax and bindings checked'))
    })
  }
  const changedElsewhere = revision && catalog.projects.find(p => p.id === project.id)?.revision !== revision
  return <div ref={editor} className="designer">
    <fieldset className="designer-body" disabled={pending}>
      <div className="designer-tools"><label>{w('Библиотека', 'Library')}<select aria-label={w('Открыть проект', 'Open project')}
        value={revision ? project.id : ''} onChange={e => open(e.target.value)}>
        <option value="">{w('Новый проект', 'New project')}</option>
        {catalog.projects.map(p => <option key={p.id} value={p.id}>{p.name[language]}</option>)}</select></label>
        <button onClick={() => open('')}>{w('Создать проект', 'New project')}</button>
        <span className="project-status">{project.name[language]}{draftChanged && ' *'}</span>
        <button className="primary" onClick={save}>{w('Сохранить проект', 'Save project')}</button></div>
      <nav className="design-tabs" aria-label={w('Инструменты конструктора','Designer tools')}>
        {(Object.keys(tabs) as Tab[]).map(k => <button key={k} aria-pressed={tab === k}
          onClick={() => k === 'preview' ? check(true) : setTab(k)}>{tabs[k]}</button>)}</nav>
      {changedElsewhere && <p role="alert">{w('На сервере есть другая версия проекта.', 'The server has a different project revision.')}
        <button onClick={() => open(project.id)}>{w('Загрузить версию сервера', 'Load server version')}</button></p>}
      {error && <p role="alert">{error}</p>}{status && <p className="designer-status" role="status">{status}</p>}
      {(tab === 'design' || tab === 'preview') && <div className="view-tabs">{viewNames.map(k =>
        <button key={k} aria-pressed={name === k} onClick={() => { setName(k); select('') }}>{viewLabels[k][language]}</button>)}</div>}
      {tab === 'design' && (project.views[name] ? <Workspace key={name} project={project} name={name} library={library}
        selected={selected} select={select} edit={edit} jump={jump} /> : <div className="empty-view">
        <button onClick={() => edit({ ...project, views: { ...project.views, [name]: newView() } })}>
          {w('Создать представление', 'Create view')} · {viewLabels[name][language]}</button></div>)}
      {tab === 'python' && <LogicEditor source={project.source} update={source => edit({ ...project, source })} target={target} check={() => check()} />}
      {tab === 'project' && <ProjectPanel project={project} edit={edit} saved={revision !== null} jump={jump} />}
      {tab === 'help' && <Help library={library} operations={catalog.operations} />}
      {tab === 'preview' && <Preview project={project} name={name} library={library} />}
      {Object.keys(catalog.diagnostics).length > 0 && <details><summary>{w('Ошибки модулей', 'Module errors')}</summary>
        {Object.entries(catalog.diagnostics).map(([key,v]) => <p key={key}>{key} · {v}</p>)}</details>}
      <datalist id="known-handlers">{handlerNames(project.source).map(fn => <option key={fn}>{fn}</option>)}</datalist>
    </fieldset>
  </div>
}
