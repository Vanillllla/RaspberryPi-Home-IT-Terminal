import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { WidgetSlider, WidgetSwitch, type WidgetInstance } from '../plugin'
import { ElementLayout } from './ElementLayout'
import { WidgetInput } from './WidgetInput'
import { colors, type Action, type Color, type InputValue, type Item, type Inputs, type Outputs, type Template } from './model'

function TextResult({ value }: { value: string }) {
  if (value.startsWith('{')) {
    try {
      const result = JSON.parse(value)
      if (result && Object.keys(result).length === 2 && typeof result.color === 'string' && Object.hasOwn(colors, result.color)
        && (typeof result.text === 'string' || typeof result.text === 'number')) {
        return <span className="widget-output widget-status" data-color={result.color}>{result.text}</span>
      }
    } catch { /* Plain text may also start with a brace. */ }
  }
  return <span className="widget-output">{value}</span>
}

interface ElementProps {
  item: Item
  inputs?: Inputs
  outputs?: Outputs
  change?: (item: Item, value?: InputValue) => void
}
export function ElementView({ item, inputs = {}, outputs = {}, change }: ElementProps) {
  const value = inputs[item.id]
  switch (item.kind) {
    case 'input':
      return <WidgetInput item={item} value={typeof value === 'string' ? value : ''} change={v => change?.(item, v)} />
    case 'button':
      return <button className="widget-button" type="button" onClick={() => change?.(item)}>{item.label}</button>
    case 'switch':
      return <WidgetSwitch label={item.label} checked={Boolean(value ?? item.checked)} onChange={v => change?.(item, v)} />
    case 'slider':
      return <label className="built-slider">{item.label && <span>{item.label}</span>}
        <WidgetSlider label={item.label || 'Слайдер'} min={item.minimum} max={item.maximum} step={item.step}
          value={Number(value ?? item.initial)} onChange={v => change?.(item, v)} />
      </label>
    case 'indicator': {
      const color = (outputs[item.id] ?? item.color) as Color
      return <span className="built-indicator" role="img" aria-label={item.label + ' — ' + colors[color]} title={item.label}>
        <i className="widget-status" data-color={color} /></span>
    }
    case 'text':
      return outputs[item.id] === undefined
        ? <strong>{item.label}</strong>
        : <TextResult value={outputs[item.id]} />
  }
}
interface RunResult { outputs?: Outputs; diagnostic?: string; skipped?: boolean }
interface Props {
  template: Template; instance: WidgetInstance; active: boolean
  patch: (id: number, revision: number, group: 'inputs' | 'outputs', data: Inputs | Outputs) => void
  resetTimers: Map<string, number>
  inputWrites: Map<number, Promise<void>>
}

export function TemplateCard({ template, instance, active, patch, resetTimers, inputWrites }: Props) {
  const inputs = (instance.settings.inputs ?? {}) as Inputs
  const outputs = (instance.settings.outputs ?? {}) as Outputs
  const latest = useRef({ inputs, outputs })
  latest.current = { inputs, outputs }
  const [messages, setMessages] = useState<Record<string, string>>({})
  const actions = useRef(template.actions)
  actions.current = template.actions
  const pendingTimers = useRef(new Set<string>())
  const commands = useRef(new Map<string, Promise<void>>())
  const base = 'widgets/' + instance.id
  const revision = template.revision

  const run = useCallback(async (action: Action, snapshot = latest.current) => {
    const timer = action.trigger === 'timer'
    if (timer && pendingTimers.current.has(action.id)) return
    if (timer) pendingTimers.current.add(action.id)
    try {
      const result = await api<RunResult>(base + '/actions/' + action.id, 'POST', { revision, ...snapshot })
      if (result.skipped) return
      if (result.outputs) patch(instance.id, revision, 'outputs', result.outputs)
      setMessages(old => ({ ...old, [action.id]: result.diagnostic ?? '' }))
    } catch (e) {
      setMessages(old => ({ ...old, [action.id]: e instanceof Error ? e.message : 'Ошибка действия' }))
    } finally { if (timer) pendingTimers.current.delete(action.id) }
  }, [base, instance.id, revision, patch])

  useEffect(() => {
    if (!active) return
    let timers: number[] = []
    function schedule() {
      timers.forEach(clearInterval)
      timers = []
      if (document.hidden) return
      for (const action of actions.current) {
        if (!action.targets.length || action.trigger !== 'timer') continue
        void run(action)
        timers.push(window.setInterval(() => void run(action), action.interval * 1000))
      }
    }
    schedule()
    document.addEventListener('visibilitychange', schedule)
    return () => {
      timers.forEach(clearInterval)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [active, run])

  function saveInput(id: string, value: InputValue) {
    const update = { [id]: value }
    latest.current.inputs = { ...latest.current.inputs, ...update }
    patch(instance.id, revision, 'inputs', update)
    const previous = inputWrites.get(instance.id) ?? Promise.resolve()
    const write = previous.then(async () => {
      await api(base + '/inputs', 'PUT', { revision, inputs: update })
      setMessages(old => ({ ...old, inputs: '' }))
    }).catch(e => setMessages(old => ({ ...old, inputs: e.message })))
    inputWrites.set(instance.id, write)
    void write.finally(() => {
      if (inputWrites.get(instance.id) === write) inputWrites.delete(instance.id)
    })
  }

  function resetKey(id: string) {
    return instance.id + ':' + id
  }

  function cancelReset(key: string) {
    window.clearTimeout(resetTimers.get(key))
    resetTimers.delete(key)
  }

  function change(item: Item, value?: InputValue) {
    if (!active) return
    if (value !== undefined) saveInput(item.id, value)
    if (item.kind === 'input') {
      cancelReset(resetKey(item.id))
      return
    }
    if (!item.command) return
    const fields = template.rows.flat().filter(field => field.kind === 'input')
    const snapshot = { ...latest.current, inputs: { ...latest.current.inputs } }
    for (const field of fields) snapshot.inputs[field.id] ??= ''
    template.actions.filter(a => a.targets.length && a.trigger === 'command' && a.command === item.command)
      .forEach(action => {
        const previous = commands.current.get(action.id) ?? Promise.resolve()
        const next = previous.then(() => run(action, snapshot))
        commands.current.set(action.id, next)
        void next.finally(() => {
          if (commands.current.get(action.id) === next) commands.current.delete(action.id)
        })
      })
    for (const field of fields) {
      if (field.resetCommand !== item.command) continue
      const key = resetKey(field.id)
      cancelReset(key)
      resetTimers.set(key, window.setTimeout(() => {
        resetTimers.delete(key)
        saveInput(field.id, '')
      }, 500))
    }
  }

  return <div className="built-card">
    <ElementLayout rows={template.rows} width={template.defaultWidth ?? 4} height={template.defaultHeight ?? 2}
      flowWidth={instance.width} render={item => {
        const view = <ElementView item={item} inputs={inputs} outputs={outputs} change={change} />
        return item.frame ? <div className="frame-content">{view}</div> : view
      }} />
    {Object.entries(messages).filter(([, message]) => message).map(([id, message]) =>
      <p className="action-message" role="status" key={id}><b>{template.actions.find(a => a.id === id)?.name ?? 'Сохранение'}</b> · {message}</p>)}
  </div>
}
