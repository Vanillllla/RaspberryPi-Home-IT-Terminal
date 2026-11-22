import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { api } from '../api'
import { canPlace, ElementLayout } from './ElementLayout'
import { useElementDrag } from './useElementDrag'
import { ElementView } from './TemplateCard'
import { TemplateImport } from './TemplateImport'
import { ActionEditor } from './ActionEditor'
import { actionKinds, colors, emptyDraft, kinds, newAction, newItem, randomKey, type ActionKind, type Color,
  type Draft, type Item, type Kind, type Template } from './model'
import './builder.css'

const symbols: Record<Kind, string> = { text: 'T', button: '▣', switch: '◐', slider: '↔', indicator: '●' }

function swap<T>(values: T[], a: number, b: number) {
  const next = [...values]
  next[a] = values[b]
  next[b] = values[a]
  return next
}

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
  const [rowIndex, setRow] = useState(0)
  const [elementId, setElement] = useState('')
  const [actionId, setAction] = useState('')
  const [tab, setTab] = useState<'element' | 'actions'>('element')
  const [kind, setKind] = useState<ActionKind>('time')
  const [error, setError] = useState('')
  const items = draft.rows.flat()
  const row = draft.rows[rowIndex]
  const item = row.find(e => e.id === elementId)
  const index = row.findIndex(e => e.id === elementId)
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
  const gridWidth = Math.max(1, Math.min(columns, Math.floor(width)))
  const gridHeight = Math.max(1, Math.min(maxRows, Math.floor(height)))
  const drag = useElementDrag(surface, items, gridWidth, gridHeight, (element, cell) => {
    const existingRow = draft.rows.findIndex(r => r.some(e => e.id === element.id))
    if (existingRow < 0) {
      replaceRow([...row, { ...element, cell }])
      select(rowIndex, element.id)
    } else {
      change({ rows: draft.rows.map(r => r.map(e => e.id === element.id ? { ...e, cell } : e)) })
      select(existingRow, element.id)
    }
  })

  function change(delta: Partial<Draft>) {
    if ((delta.defaultWidth || delta.defaultHeight) && items.some(e => e.cell &&
      !canPlace(e, e.cell, items, delta.defaultWidth ?? width, delta.defaultHeight ?? height))) {
      setError('Сначала переместите закреплённые элементы в границы нового размера')
      return
    }
    setError('')
    setDraft(old => ({ ...old, ...delta }))
  }
  function open(id: string) {
    const next = templates.find(t => t.id === id) ?? emptyDraft()
    if (!id) setCreationKey(randomKey())
    setTemplateId(id); setDraft(next); setRow(0); setElement(next.rows[0][0]?.id ?? '')
    setAction(next.actions[0]?.id ?? ''); setError(''); setTab('element')
  }
  function replaceRow(next: Item[]) {
    change({ rows: draft.rows.map((r, i) => i === rowIndex ? next : r) })
  }
  function updateItem(delta: Partial<Item>) {
    if (item?.cell && delta.span !== undefined && !canPlace({ ...item, ...delta }, item.cell, items, width, height)) {
      setError('Для такой ширины недостаточно свободных клеток')
      return
    }
    replaceRow(row.map(e => e.id === elementId ? { ...e, ...delta } : e))
  }
  function select(i: number, id = '') {
    setRow(i); setElement(id); setTab('element')
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
        {(Object.keys(kinds) as Kind[]).map(k => <button key={k} {...drag.handlers(() => newItem(k), () => {
          const e = newItem(k); replaceRow([...row, e]); select(rowIndex, e.id)
        })}><span aria-hidden="true">{symbols[k]}</span>{kinds[k]}</button>)}
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
                <ElementLayout rows={draft.rows} width={gridWidth} height={gridHeight} render={(el, i) =>
                  <div className="builder-preview-cell">
                    <div inert><ElementView item={el} /></div>
                    <button aria-label={'Выбрать ' + kinds[el.kind] + ' · ' + el.label} aria-pressed={el.id === elementId}
                      {...drag.handlers(() => el, () => select(i, el.id))} />
                  </div>} />
                {drag.target && <div aria-hidden="true" className="element-drop" data-valid={drag.target.valid}
                  style={{ left: drag.target.cell.x / gridWidth * 100 + '%', top: drag.target.cell.y / gridHeight * 100 + '%',
                    width: drag.target.span / gridWidth * 100 + '%', height: 100 / gridHeight + '%' }}><div inert><ElementView item={drag.target.item} /></div></div>}
              </div>
            </div>
          </div>
        </div>
        <div className="builder-row-tools">
          <label>Строка <select value={rowIndex} onChange={e => {
            const i = Number(e.target.value); select(i, draft.rows[i][0]?.id)
          }}>{draft.rows.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>
          <button aria-label="Поднять строку" disabled={!rowIndex} onClick={() => {
            change({ rows: swap(draft.rows, rowIndex, rowIndex - 1) }); select(rowIndex - 1, elementId)
          }}>↑</button>
          <button aria-label="Опустить строку" disabled={rowIndex + 1 === draft.rows.length} onClick={() => {
            change({ rows: swap(draft.rows, rowIndex, rowIndex + 1) }); select(rowIndex + 1, elementId)
          }}>↓</button>
          <button aria-label="Удалить строку" onClick={() => {
            const rows = draft.rows.filter((_, n) => n !== rowIndex)
            change({ rows: rows.length ? rows : [[]] }); select(0)
          }}>×</button>
        </div>
        <button onClick={() => { change({ rows: [...draft.rows, []] }); select(draft.rows.length) }}>+ Строка</button>
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
        <label>Ширина элемента<select aria-label="Ширина элемента" value={item.span ?? ''} onChange={e => updateItem({ span: Number(e.target.value) || null })}>
          <option value="">Автоматически</option>
          {Array.from({ length: columns }, (_, i) => <option key={i} value={i + 1}>{i + 1} кл.</option>)}
        </select></label>
        {item.cell && <button onClick={() => updateItem({ cell: null })}>
          Снять закрепление · столбец {item.cell.x + 1}, ряд {item.cell.y + 1}
        </button>}
        <label>Разместить в строке<select disabled={!!item.cell} value={rowIndex} onChange={e => {
          const dest = Number(e.target.value)
          change({ rows: draft.rows.map((r, i) => i === dest ? [...r, item] : i === rowIndex ? r.filter(x => x.id !== item.id) : r) })
          select(dest, item.id)
        }}>{draft.rows.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>
        <div className="builder-order"><button disabled={!!item.cell || !index} onClick={() => replaceRow(swap(row, index, index - 1))}>← Левее</button>
          <button disabled={!!item.cell || index === row.length - 1} onClick={() => replaceRow(swap(row, index, index + 1))}>Правее →</button></div>
        <button onClick={() => { replaceRow(row.filter(e => e.id !== elementId)); setElement('') }}>Удалить элемент</button>
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
