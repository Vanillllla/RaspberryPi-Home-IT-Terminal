import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { onSharedChange } from '../sync'
import { useTranslation } from '../i18n'
import { actionLabel, contextExpression, itemLabel, type Action, type Item } from './model'

interface Task { name: string; operation: string; script?: string; inputs?: number }
export interface Integration { id: string; name: string; tasks: Task[] }
export interface Catalog { elements: Integration[]; operations: Record<string, number> }

export function IntegrationPalette({ catalog, setCatalog, add }: {
  catalog: Catalog; setCatalog: (catalog: Catalog) => void; add: (element: Integration) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const refresh = useRef(() => {})
  useEffect(() => {
    let active = true
    let request = 0
    function load() {
      const current = ++request
      api<Catalog>('integrations').then(result => { if (active && current === request) setCatalog(result) })
        .catch(e => { if (active && current === request) setError(e.message) })
    }
    refresh.current = load
    load()
    const unsubscribe = onSharedChange({ kind: 'integrations' }, load)
    return () => { active = false; refresh.current = () => {}; unsubscribe() }
  }, [setCatalog])
  const blank = () => ({ name: '', operation: '', script: '', inputs: 0 })
  async function save() {
    setPending(true)
    try {
      await api('integrations', 'POST', { name, tasks })
      refresh.current()
      setEditing(false); setError('')
    } catch (e) { setError(String(e)) } finally { setPending(false) }
  }
  async function remove(el: Integration) {
    if (!window.confirm(t('Удалить интеграцию «{name}»?', { name: el.name }))) return
    setPending(true)
    try {
      await api('integrations/' + el.id, 'DELETE')
      refresh.current()
      setError('')
    } catch (e) { setError(String(e)) } finally { setPending(false) }
  }
  return <>
    {catalog.elements.map(el => <div className="integration-choice" key={el.id}>
      <button onClick={() => add(el)}>{el.name}</button>
      <button disabled={pending} aria-label={t('Удалить интеграцию «{name}»?', { name: el.name })} onClick={() => void remove(el)}>×</button>
    </div>)}
    {!editing ? <button onClick={() => { setEditing(true); setName(''); setTasks([blank()]) }}>{t('Создать элемент интеграции')}</button> :
      <fieldset disabled={pending} className="integration-form">
        <label>{t('Название')}<input value={name} maxLength={100} onChange={e => setName(e.target.value)} /></label>
        {tasks.map((task, i) => <div key={i}>
          <label>{t('Название действия')}<input value={task.name} maxLength={100} onChange={e =>
            setTasks(tasks.map((v, j) => j === i ? { ...v, name: e.target.value } : v))} /></label>
          <label>{t('Системная операция')}<select value={task.operation} onChange={e =>
            setTasks(tasks.map((v, j) => j === i ? { ...v, operation: e.target.value, script: '' } : v))}>
            <option value="">{t('Свои команды')}</option>
            {Object.keys(catalog.operations).map(key => <option key={key}>{key}</option>)}
          </select></label>
          {!task.operation && <>
            <label>{t('Команды службы')}<textarea rows={3} value={task.script ?? ''} placeholder="systemctl start sing-box"
              onChange={e => setTasks(tasks.map((v, j) => j === i ? { ...v, script: e.target.value } : v))} /></label>
            <small>{t('По одной команде systemctl на строку. Аргументы контекста: $1, $2…')}</small>
            <label>{t('Число аргументов')}<input type="number" min={0} max={16} value={task.inputs ?? 0}
              onChange={e => setTasks(tasks.map((v, j) => j === i ? { ...v, inputs: Number(e.target.value) } : v))} /></label>
          </>}
          {tasks.length > 1 && <button onClick={() => setTasks(tasks.filter((_, j) => j !== i))}>{t('Удалить действие')}</button>}
        </div>)}
        <button disabled={tasks.length >= 32} onClick={() => setTasks([...tasks, blank()])}>{t('Добавить действие')}</button>
        <button disabled={!name.trim() || tasks.some(v => !v.name.trim() || (!v.operation && !v.script?.trim()))} onClick={() => void save()}>{t('Сохранить')}</button>
        <button onClick={() => setEditing(false)}>{t('Отмена')}</button>
      </fieldset>}
    {error && <p role="alert">{error}</p>}
  </>
}

export function IntegrationBindings({ item, items, actions, catalog, update }: {
  item: Item; items: Item[]; actions: Action[]; catalog: Catalog; update: (delta: Partial<Item>) => void
}) {
  const { t } = useTranslation()
  const definition = catalog.elements.find(el => el.id === item.integration)
  if (!definition) return <p>{t('Интеграция недоступна')}</p>
  const bindings = definition.tasks.map((_, i) => item.bindings?.[i] ?? { trigger: '', context: '' })
  const sources = items.filter(el => ['input', 'slider', 'switch'].includes(el.kind))
  return <><table className="integration-bindings"><thead><tr>
    <th>{t('Действие')}</th><th>{t('Триггер')}</th><th>{t('Контекст')}</th>
  </tr></thead><tbody>{definition.tasks.map((task, i) => <tr key={i}>
    <th scope="row">{task.name}</th><td><select aria-label={t('Триггер') + ' · ' + task.name} value={bindings[i].trigger}
      onChange={e => update({ bindings: bindings.map((v, j) => j === i ? { ...v, trigger: e.target.value } : v) })}>
      <option value="">{t('Без обновления')}</option>
      {actions.filter(a => a.kind === 'activate').map(a => <option key={a.id} value={a.id}>{actionLabel(a, t)}</option>)}
    </select></td><td><input aria-label={t('Контекст') + ' · ' + task.name} value={bindings[i].context}
      placeholder={String(task.script ? task.inputs : catalog.operations[task.operation] ?? '') + ' · ' + t('Аргументы')}
      onChange={e => update({ bindings: bindings.map((v, j) => j === i ? { ...v, context: e.target.value } : v) })} /></td>
  </tr>)}</tbody></table>
  <small>{t('Выберите действие типа «Активация интеграции». Ссылки на входы указывайте через запятую.')}</small>
  {sources.map(el => <small key={el.id}>{itemLabel(el, t)} · <code>{contextExpression(el.id)}</code></small>)}</>
}
