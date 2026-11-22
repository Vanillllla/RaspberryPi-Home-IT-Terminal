import { useLayoutEffect, useRef, useState, type KeyboardEvent, type CSSProperties } from 'react'
import { api } from '../api'
import { canPlace, editableDraft, frameStyle, ElementLayout } from './ElementLayout'
import { useElementDrag } from './useElementDrag'
import { ElementView } from './TemplateCard'
import { TemplateImport } from './TemplateImport'
import { ActionEditor } from './ActionEditor'
import { actionKinds, colors, emptyDraft, kinds, newAction, newItem, randomKey, subdivisions, type ActionKind, type Color,
  type Draft, type Frame, type Item, type Kind, type Template } from './model'
import './builder.css'

const symbols: Record<Kind, string> = { text: 'T', button: '▣', switch: '◐', slider: '↔', indicator: '●' }

interface Props {
  cellSize: number
  columns: number
  maxRows: number
  templates: Template[]
  busy: boolean
  setBusy: (value: boolean) => void
  imported: (template: Template) => void
  saved: (template: Template) => Promise<void>
}

export function Builder({ cellSize, columns, maxRows, templates, busy, setBusy, imported, saved }: Props) {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [templateId, setTemplateId] = useState('')
  const [creationKey, setCreationKey] = useState(() => randomKey())
  const [elementId, setElement] = useState('')
  const [actionId, setAction] = useState('')
  const [tab, setTab] = useState<'element' | 'actions'>('element')
  const [kind, setKind] = useState<ActionKind>('time')
  const [error, setError] = useState('')
  const items = draft.rows.flat()
  const item = items.find(e => e.id === elementId)
  const action = draft.actions.find(a => a.id === actionId)
  const source = draft.actions.find(a => a.targets.some(t => t.element === elementId))

  const width = draft.defaultWidth ?? 4
  const height = draft.defaultHeight ?? 2
  const [guides, setGuides] = useState(true)
  const stage = useRef<HTMLDivElement>(null)
  const [space, setSpace] = useState(0)
  useLayoutEffect(() => {
    const node = stage.current!
    const measure = () => setSpace(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const scale = space ? Math.min(1, space / (Math.max(1, width) * cellSize)) : 1

  const surface = useRef<HTMLDivElement>(null)
  const gridWidth = Math.max(1, Math.min(columns, Math.floor(width))) * subdivisions
  const gridHeight = Math.max(1, Math.min(maxRows, Math.floor(height))) * subdivisions
  const drag = useElementDrag(surface, items, gridWidth, gridHeight, place)

  function select(id: string) {
    setElement(id)
    setTab('element')
  }
  function place(element: Item, frame: Frame) {
    const next = { ...element, frame }
    const updated = items.some(e => e.id === element.id)
      ? items.map(e => e.id === element.id ? next : e) : [...items, next]
    change({ rows: [updated] })
    select(element.id)
  }
  function fromPalette(kind: Kind) {
    const sizes: Record<Kind, [number, number]> = { text: [6, 3], button: [6, 3], indicator: [2, 2], switch: [9, 3], slider: [10, 4] }
    const [w, h] = sizes[kind]
    return { ...newItem(kind), frame: { x: 0, y: 0, width: Math.min(w, gridWidth), height: Math.min(h, gridHeight) } }
  }
  function add(kind: Kind) {
    const element = fromPalette(kind)
    for (let y = 0; y <= gridHeight - element.frame.height; y++) {
      for (let x = 0; x <= gridWidth - element.frame.width; x++) {
        const frame = { ...element.frame, x, y }
        if (canPlace(element.id, frame, items, gridWidth, gridHeight)) return place(element, frame)
      }
    }
    setError('Для элемента нет свободного места. Уменьшите соседние элементы или увеличьте шаблон.')
  }
  function arrow(e: KeyboardEvent, element: Item, resize: boolean) {
    const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const step = steps[e.key]
    if (!step) return
    e.preventDefault()
    const frame = { ...element.frame! }
    frame[resize ? 'width' : 'x'] += step[0]
    frame[resize ? 'height' : 'y'] += step[1]
    if (canPlace(element.id, frame, items, gridWidth, gridHeight)) place(element, frame)
  }
  function change(delta: Partial<Draft>) {
    if ((delta.defaultWidth || delta.defaultHeight) && items.some(e => e.frame &&
      !canPlace(e.id, e.frame, items, (delta.defaultWidth ?? width) * subdivisions, (delta.defaultHeight ?? height) * subdivisions))) {
      setError('Сначала переместите закреплённые элементы в границы нового размера')
      return
    }
    setError('')
    setDraft(old => ({ ...old, ...delta }))
  }
  function open(id: string) {
    const next = editableDraft(templates.find(t => t.id === id) ?? emptyDraft())
    if (!id) setCreationKey(randomKey())
    setTemplateId(id); setDraft(next); setElement(next.rows.flat()[0]?.id ?? '')
    setAction(next.actions[0]?.id ?? ''); setError(''); setTab('element')
  }
  function updateItem(delta: Partial<Item>) {
    change({ rows: [items.map(e => e.id === elementId ? { ...e, ...delta } : e)] })
  }
  function bind(id: string, actions = draft.actions) {
    change({ actions: actions.map(a => ({ ...a, targets: [
      ...a.targets.filter(t => t.element !== elementId),
      ...(a.id === id ? [{ element: elementId, field: a.kind === 'reach' ? (item?.kind === 'indicator' ? 'color' : 'text') : '' }] : []),
    ] })) })
  }
  function setMode(mode: string) {
    if (mode === 'static') return bind('')
    const existing = draft.actions.find(a => a.trigger === mode)
    if (existing) return bind(existing.id)
    const next = newAction('time')
    next.trigger = mode === 'timer' ? 'timer' : 'command'
    bind(next.id, [...draft.actions, next])
  }
  async function save() {
    if (!Number.isInteger(width) || width < 1 || width > columns || !Number.isInteger(height) || height < 1 || height > maxRows) {
      setError('Проверьте ширину и высоту шаблона в клетках')
      return
    }
    if (items.some(e => e.fontSize !== undefined && (!Number.isInteger(e.fontSize) || e.fontSize < 1 || e.fontSize > 144))) {
      setError('Размер шрифта должен быть целым числом от 1 до 144 пт')
      return
    }
    setError(''); setBusy(true)
    try {
      const result = await api<Template>(templateId ? 'templates/' + templateId : 'templates?creation_key=' + creationKey, templateId ? 'PUT' : 'POST', draft)
      await saved(result)
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сохранения шаблона') }
    finally { setBusy(false) }
  }
  return <div className="builder" inert={busy} aria-busy={busy}>
    <div className="builder-bar">
      <label>Шаблон<select aria-label="Шаблон" value={templateId} onChange={e => open(e.target.value)}>
        <option value="">Новый шаблон</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select></label>
      <label>Название шаблона<input value={draft.name} maxLength={100} placeholder="Например, Домашний сервер"
        onChange={e => change({ name: e.target.value })} /></label>
      <label>Описание<input value={draft.description ?? ''} maxLength={2000}
        onChange={e => change({ description: e.target.value })} /></label>
      <TemplateImport setBusy={setBusy} imported={imported} open={open} />
      <button className="primary" disabled={busy} onClick={save}>Сохранить шаблон</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="builder-layout">
      <section className="builder-palette"><h3>Элементы</h3>
        {(Object.keys(kinds) as Kind[]).map(k => <button key={k} {...drag.handlers('add', () => fromPalette(k), () => add(k))}><span aria-hidden="true">{symbols[k]}</span>{kinds[k]}</button>)}
      </section>
      <section className="builder-canvas"><h3>Предпросмотр</h3>
        <div className="preview-size">
          <label>Ширина в клетках<input type="number" min={1} max={columns} value={width || ''}
            onChange={e => change({ defaultWidth: Number(e.target.value) })} /></label>
          <label>Высота в клетках<input type="number" min={1} max={maxRows} value={height || ''}
            onChange={e => change({ defaultHeight: Number(e.target.value) })} /></label>
          <label><input type="checkbox" checked={guides} onChange={e => setGuides(e.target.checked)} /> Сетка</label>
        </div>
        <div className="preview-stage" ref={stage}>
          <div className="builder-sheet" data-guides={guides} style={{ width: Math.max(1, Math.min(width, columns)) * cellSize,
            height: Math.max(1, Math.min(height, maxRows)) * cellSize, zoom: scale } as CSSProperties}>
            <div className="builder-sheet-frame">
              <h4>{draft.name || 'Новый виджет'}</h4>
              <div className="preview-body" ref={surface} style={{ '--columns': gridWidth, '--rows': gridHeight } as CSSProperties}>
                <ElementLayout rows={draft.rows} width={gridWidth / subdivisions} height={gridHeight / subdivisions} render={el =>
                  <div className="builder-preview-cell" data-dragging={drag.target?.item.id === el.id}>
                    <div className="frame-content" inert><ElementView item={el} /></div>
                    <button className="element-select" aria-label={'Выбрать ' + kinds[el.kind] + ' · ' + el.label} aria-pressed={el.id === elementId}
                      onKeyDown={e => arrow(e, el, false)} {...drag.handlers('move', () => el, () => select(el.id))} />
                    {el.id === elementId && <button className="resize-handle" aria-label="Изменить размер элемента"
                      title="Потяните за угол или используйте стрелки" onKeyDown={e => arrow(e, el, true)}
                      {...drag.handlers('resize', () => el, () => select(el.id))} />}
                  </div>} />
                {drag.target && <div aria-hidden="true" className="element-drop" data-valid={drag.target.valid}
                  style={frameStyle(drag.target.item, gridWidth, gridHeight, drag.target.frame)}>
                  <div className="frame-content" inert><ElementView item={drag.target.item} /></div>
                </div>}
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="builder-inspector"><div className="builder-tabs">
        <button aria-pressed={tab === 'element'} onClick={() => setTab('element')}>Свойства</button>
        <button aria-pressed={tab === 'actions'} onClick={() => setTab('actions')}>Действия</button>
      </div>
      {tab === 'element' && (item ? <>
        <h4>{kinds[item.kind]}</h4>
        <label>Подпись<input value={item.label} onChange={e => updateItem({ label: e.target.value })} /></label>
        {['button', 'switch', 'slider'].includes(item.kind) && <>
          <label>Отправить команду<input value={item.command} placeholder="Например, refresh" onChange={e => updateItem({ command: e.target.value })} /></label>
          {item.command && <small>Действия · {draft.actions.filter(a => a.trigger === 'command' && a.command === item.command).map(a => a.name).join(', ') || 'не назначены'}</small>}
        </>}
        {item.kind === 'switch' && <label className="builder-check"><input type="checkbox" checked={item.checked}
          onChange={e => updateItem({ checked: e.target.checked })} />Включён изначально</label>}
        {item.kind === 'slider' && (['minimum', 'maximum', 'step', 'initial'] as const).map((key, i) =>
          <label key={key}>{['Минимум', 'Максимум', 'Шаг', 'Начальное значение'][i]}
            <input type="number" step="any" value={item[key]} onChange={e => updateItem({ [key]: Number(e.target.value) })} /></label>)}
        {item.kind === 'indicator' && <label>Начальный цвет<select value={item.color} onChange={e => updateItem({ color: e.target.value as Color })}>
          {Object.entries(colors).map(([k,v]) => <option value={k} key={k}>{v}</option>)}</select></label>}
        {['text', 'indicator'].includes(item.kind) && <>
          <label>Обновление<select aria-label="Обновление" value={source?.trigger ?? 'static'} onChange={e => setMode(e.target.value)}>
            <option value="static">Без обновления</option><option value="timer">По таймеру</option><option value="command">По команде</option>
          </select></label>
          {source && <label>Действие обновления<select value={source.id} onChange={e => bind(e.target.value)}>
            {draft.actions.filter(a => a.trigger === source.trigger).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>}
          <button onClick={() => { if (source) setAction(source.id); setTab('actions') }}>Настроить действия</button>
        </>}
        {item.kind !== 'indicator' && <>
          <label>Шрифт<select value={item.fontFamily ?? 'system'}
            onChange={e => updateItem({ fontFamily: e.target.value as Item['fontFamily'] })}>
            <option value="system">Системный</option><option value="serif">С засечками</option>
            <option value="monospace">Моноширинный</option>
          </select></label>
          <label>Размер шрифта, пт<input type="number" min={1} max={144} value={item.fontSize ?? 12}
            onChange={e => updateItem({ fontSize: e.target.value ? Number(e.target.value) : undefined })} /></label>
        </>}
        <button onClick={() => { change({ rows: [items.filter(e => e.id !== elementId)] }); setElement('') }}>Удалить элемент</button>
      </> : <p>Выберите элемент в предпросмотре.</p>)}
      {tab === 'actions' && <>
        <label>Тип действия<select value={kind} onChange={e => setKind(e.target.value as ActionKind)}>
          {Object.entries(actionKinds).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button onClick={() => {
          const a = newAction(kind); change({ actions: [...draft.actions, a] }); setAction(a.id)
        }}>Добавить действие</button>
        {!!draft.actions.length && <label>Действие<select value={actionId} onChange={e => setAction(e.target.value)}>
          {draft.actions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        {action && <><ActionEditor action={action} items={items} update={delta =>
          change({ actions: draft.actions.map(a => a.id === action.id ? { ...a, ...delta } : a) })} />
          <button onClick={() => {
            const actions = draft.actions.filter(a => a.id !== actionId)
            change({ actions }); setAction(actions[0]?.id ?? '')
          }}>Удалить действие</button></>}
      </>}
      </section>
    </div>
  </div>
}
