import { useTranslation } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { WidgetSlider, WidgetSwitch, type WidgetInstance } from '../plugin'
import { ElementLayout } from './ElementLayout'
import { WidgetInput } from './WidgetInput'
import { actionName, colors, itemLabel, type Action, type Color, type InputValue, type Item, type Inputs, type Outputs, type Template } from './model'

function TextResult({ value }: { value: string }) {
  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value)
      // Older servers could save the worker reply itself as the displayed text.
      const wrapped = parsed && Object.keys(parsed).length === 2 && Object.hasOwn(parsed, 'value')
        && Array.isArray(parsed.commands) && parsed.commands.every((command: unknown) => typeof command === 'string')
      const result = wrapped ? parsed.value : parsed
      if (wrapped && (typeof result === 'string' || typeof result === 'number')) {
        return <span className="widget-output">{result}</span>
      }
      if (result && typeof result === 'object' && Object.keys(result).length === 2 && typeof result.color === 'string' && Object.hasOwn(colors, result.color)
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
  const { t } = useTranslation()
  const label = itemLabel(item, t)
  const value = inputs[item.id]
  switch (item.kind) {
    case 'input':
      return <WidgetInput item={item} value={typeof value === 'string' ? value : ''} change={v => change?.(item, v)} />
    case 'button':
      return <button className="widget-button" type="button" onClick={() => change?.(item)}>{label}</button>
    case 'switch':
      return <WidgetSwitch label={label} checked={Boolean(value ?? item.checked)} onChange={v => change?.(item, v)} />
    case 'slider':
      return <label className="built-slider">{label && <span>{label}</span>}
        <WidgetSlider label={label || t('Слайдер')} min={item.minimum} max={item.maximum} step={item.step}
          value={Number(value ?? item.initial)} onChange={v => change?.(item, v)} />
      </label>
    case 'indicator': {
      const color = (outputs[item.id] ?? item.color) as Color
      return <span className="built-indicator" role="img" aria-label={label + ' — ' + t(colors[color])} title={label}>
        <i className="widget-status" data-color={color} /></span>
    }
    case 'text':
      return outputs[item.id] === undefined
        ? <strong>{label}</strong>
        : <TextResult value={outputs[item.id]} />
  }
}
interface RunResult { outputs?: Outputs; diagnostic?: string; commands?: string[]; skipped?: boolean }
interface Props {
  template: Template; instance: WidgetInstance; active: boolean
  patch: (id: number, revision: number, group: 'inputs' | 'outputs', data: Inputs | Outputs) => void
  resetTimers: Map<string, number>
  inputWrites: Map<number, Promise<void>>
}

export function TemplateCard({ template, instance, active, patch, resetTimers, inputWrites }: Props) {
  const { t } = useTranslation()
  const inputs = (instance.settings.inputs ?? {}) as Inputs
  const outputs = (instance.settings.outputs ?? {}) as Outputs
  const latest = useRef({ inputs, outputs })
  latest.current = { inputs, outputs }
  const [messages, setMessages] = useState<Record<string, string>>({})
  const pendingTimers = useRef(new Set<string>())
  const commands = useRef(new Map<string, Promise<void>>())
  const base = 'widgets/' + instance.id
  const revision = template.revision

  const saveInput = useCallback((id: string, value: InputValue) => {
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
  }, [base, inputWrites, instance.id, patch, revision])

  const dispatch = useCallback((command: string, fromScript = false) => {
    const listeners = template.actions.filter(a => a.trigger === 'command' && a.command === command
      && (a.targets.length > 0 || a.kind === 'python'))
    const resets = template.rows.flat().filter(e => e.kind === 'input' && e.resetCommand === command)
    if (fromScript && !listeners.length && !resets.length) throw new Error(t('Нет получателей команды «{command}»', { command }))
    for (const field of resets) {
      const key = instance.id + ':' + field.id
      window.clearTimeout(resetTimers.get(key))
      resetTimers.set(key, window.setTimeout(() => {
        resetTimers.delete(key)
        saveInput(field.id, '')
      }, 500))
    }
    return listeners
  }, [instance.id, resetTimers, saveInput, template, t])

  function snapshot() {
    const inputs = { ...latest.current.inputs }
    for (const field of template.rows.flat()) {
      if (field.kind === 'input') inputs[field.id] ??= ''
    }
    return { inputs, outputs: latest.current.outputs }
  }

  const run = useCallback(async (root: Action, captured = latest.current) => {
    const timer = root.trigger === 'timer'
    if (timer && pendingTimers.current.has(root.id)) return
    if (timer) pendingTimers.current.add(root.id)
    const state = { ...captured }
    let count = 0
    let current = root
    async function step(action: Action, parents: string[]) {
      current = action
      if (parents.includes(action.id)) throw new Error(t('Цикл команд в действии «{name}»', { name: actionName(action, t) }))
      if (++count > 64) throw new Error(t('В цепочке допускается до 64 запусков действий'))
      const result = await api<RunResult>(base + '/actions/' + action.id, 'POST', { revision, ...state })
      if (result.skipped) return
      if (result.outputs) {
        state.outputs = { ...state.outputs, ...result.outputs }
        patch(instance.id, revision, 'outputs', result.outputs)
      }
      setMessages(old => ({ ...old, [action.id]: result.diagnostic ?? '' }))
      for (const command of result.commands ?? []) {
        current = action
        for (const next of dispatch(command, true)) await step(next, [...parents, action.id])
      }
    }
    try {
      await step(root, [])
    } catch (e) {
      const id = current.id
      setMessages(old => ({ ...old, [id]: e instanceof Error ? e.message : t('Ошибка действия') }))
    } finally {
      if (timer) pendingTimers.current.delete(root.id)
    }
  }, [base, instance.id, revision, patch, dispatch, t])

  useEffect(() => {
    if (!active) return
    let timers: number[] = []
    function schedule() {
      timers.forEach(clearInterval)
      timers = []
      if (document.hidden) return
      for (const action of template.actions) {
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
  }, [active, run, template.actions])

  function change(item: Item, value?: InputValue) {
    if (!active) return
    if (value !== undefined) saveInput(item.id, value)
    if (item.kind === 'input') {
      const key = instance.id + ':' + item.id
      window.clearTimeout(resetTimers.get(key))
      resetTimers.delete(key)
      return
    }
    if (!item.command) return
    const captured = snapshot()
    for (const action of dispatch(item.command)) {
      const previous = commands.current.get(action.id) ?? Promise.resolve()
      const next = previous.then(() => run(action, captured))
      commands.current.set(action.id, next)
      void next.finally(() => {
        if (commands.current.get(action.id) === next) commands.current.delete(action.id)
      })
    }
  }

  return <div className="built-card">
    <ElementLayout rows={template.rows} width={template.defaultWidth ?? 4} height={template.defaultHeight ?? 2}
      flowWidth={instance.width} render={item => {
        const view = <ElementView item={item} inputs={inputs} outputs={outputs} change={change} />
        return item.frame ? <div className="frame-content">{view}</div> : view
      }} />
    {Object.entries(messages).filter(([, message]) => message).map(([id, message]) => {
      const action = template.actions.find(a => a.id === id)
      return <p className="action-message" role="status" key={id}><b>{action ? actionName(action, t) : t('Сохранение')}</b> · {message}</p>
    })}
  </div>
}
