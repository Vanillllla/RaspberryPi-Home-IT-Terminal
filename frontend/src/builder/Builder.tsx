import { useTranslation } from '../i18n'
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type CSSProperties } from 'react'
import { api } from '../api'
import { canPlace, editableDraft, frameStyle, ElementLayout } from './ElementLayout'
import { useElementDrag } from './useElementDrag'
import { ElementView } from './TemplateCard'
import { TemplateImport } from './TemplateImport'
import { ActionHelp } from './ActionHelp'
import { ActionEditor } from './ActionEditor'
import { actionKinds, actionLabel, actionName, itemLabel, colors, contextExpression, emptyDraft, inputFormats, kinds, newAction, newItem, randomKey, subdivisions, unusedCommand, type ActionKind, type Color,
  type Action, type Draft, type Frame, type Item, type Kind, type Template } from './model'
import './builder.css'

const symbols: Record<Kind, string> = { text: 'T', button: '▣', switch: '◐', slider: '↔', indicator: '●', input: '▏', shortcut: '↗' }

async function copyExpression(expression: string, origin: HTMLElement) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(expression)
      return
    } catch { /* Try the selection-based copy below. */ }
  }

  // LAN access can use HTTP, where the asynchronous clipboard API is unavailable.
  const previousFocus = document.activeElement
  const field = document.createElement('textarea')
  field.value = expression
  field.readOnly = true
  field.style.cssText = 'position: fixed; inset: 0 auto auto 0; opacity: 0; pointer-events: none'
  const container = origin.closest('dialog') ?? document.body
  container.append(field)
  try {
    field.focus({ preventScroll: true })
    field.select()
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable')
  } finally {
    field.remove()
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
  }
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
  deleted: (id: string) => void
}

export function Builder({ cellSize, columns, maxRows, templates, busy, setBusy, imported, saved, deleted }: Props) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [templateId, setTemplateId] = useState('')
  const [creationKey, setCreationKey] = useState(() => randomKey())
  const [elementId, setElement] = useState('')
  const [actionId, setAction] = useState('')
  const [tab, setTab] = useState<'element' | 'actions'>('element')
  const [helpOpen, setHelpOpen] = useState(false)
  const [kind, setKind] = useState<ActionKind>('time')
  const [error, setError] = useState('')
  const selectedTemplate = templates.find(template => template.id === templateId)
  const items = draft.rows.flat()
  const item = items.find(e => e.id === elementId)
  const action = draft.actions.find(a => a.id === actionId)
  const source = draft.actions.find(a => a.targets.some(t => t.element === elementId))
  const sentActions = item?.command ? draft.actions.filter(a => a.trigger === 'command' && a.command === item.command) : []

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
  async function copyContext(id: string, origin: HTMLElement) {
    const expression = contextExpression(id)
    try {
      await copyExpression(expression, origin)
    } catch {
      setError(t('Не удалось скопировать выражение. Скопируйте вручную {expression}', { expression }))
    }
  }
  function place(element: Item, frame: Frame) {
    const next = { ...element, frame }
    const updated = items.some(e => e.id === element.id)
      ? items.map(e => e.id === element.id ? next : e) : [...items, next]
    change({ rows: [updated] })
    select(element.id)
  }
  function paletteButton(k: Kind) {
    return <button key={k} {...drag.handlers('add', () => fromPalette(k), () => add(k))}><span aria-hidden="true">{symbols[k]}</span>{t(kinds[k])}</button>
  }
  function fromPalette(kind: Kind) {
    const sizes: Record<Kind, [number, number]> = { text: [6, 3], button: [6, 3], indicator: [2, 2], switch: [9, 3], slider: [10, 4], input: [14, 3], shortcut: [8, 3] }
    const [w, h] = sizes[kind]
    return { ...newItem(kind, t), frame: { x: 0, y: 0, width: Math.min(w, gridWidth), height: Math.min(h, gridHeight) } }
  }
  function add(kind: Kind) {
    const element = fromPalette(kind)
    for (let y = 0; y <= gridHeight - element.frame.height; y++) {
      for (let x = 0; x <= gridWidth - element.frame.width; x++) {
        const frame = { ...element.frame, x, y }
        if (canPlace(element.id, frame, items, gridWidth, gridHeight)) return place(element, frame)
      }
    }
    setError(t('Для элемента нет свободного места. Уменьшите соседние элементы или увеличьте шаблон.'))
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
      setError(t('Сначала переместите закреплённые элементы в границы нового размера'))
      return
    }
    setError('')
    setDraft(old => ({ ...old, ...delta }))
  }
  function open(id: string) {
    const next = editableDraft(templates.find(t => t.id === id) ?? emptyDraft())
    if (!id) setCreationKey(randomKey())
    setTemplateId(id); setDraft(next); setElement(next.rows.flat()[0]?.id ?? '')
    setAction(''); setError(''); setTab('element')
  }
  function updateItem(delta: Partial<Item>) {
    change({ rows: [items.map(e => e.id === elementId ? { ...e, ...delta } : e)] })
  }
  function bind(id: string) {
    if (id && id === source?.id) return
    change({ actions: draft.actions.map(a => ({ ...a, targets: [
      ...a.targets.filter(t => t.element !== elementId),
      ...(a.id === id ? [{ element: elementId, field: a.kind === 'reach' ? (item?.kind === 'indicator' ? 'color' : 'text') : '' }] : []),
    ] })) })
  }
  function createUpdate(trigger: Action['trigger']) {
    const base = source ?? newAction('time', t)
    const previousTarget = source?.targets.find(t => t.element === elementId)
    const next = {
      ...base,
      id: source && source.targets.length > 1 ? 'a' + randomKey(5) : base.id,
      trigger,
      command: trigger === 'command' ? unusedCommand(draft) : '',
      targets: [previousTarget ?? { element: elementId, field: '' }],
    }
    const actions = draft.actions.filter(a => a.id !== next.id).map(a => a === source
      ? { ...a, targets: a.targets.filter(t => t.element !== elementId) } : a)
    change({ actions: [...actions, next] })
    return next.id
  }
  function setMode(mode: Action['trigger'] | 'static') {
    if (mode === 'static') return bind('')
    createUpdate(mode)
  }
  function showActions(id = source?.id ?? sentActions[0]?.id ?? '') {
    setAction(id)
    setTab('actions')
  }
  async function save() {
    if (!Number.isInteger(width) || width < 1 || width > columns || !Number.isInteger(height) || height < 1 || height > maxRows) {
      setError(t('Проверьте ширину и высоту шаблона в клетках'))
      return
    }
    if (items.some(e => e.fontSize !== undefined && (!Number.isInteger(e.fontSize) || e.fontSize < 1 || e.fontSize > 144))) {
      setError(t('Размер шрифта должен быть целым числом от 1 до 144 пт'))
      return
    }
    setError(''); setBusy(true)
    try {
      const result = await api<Template>(templateId ? 'templates/' + templateId : 'templates?creation_key=' + creationKey, templateId ? 'PUT' : 'POST', draft)
      await saved(result)
    } catch (e) { setError(e instanceof Error ? e.message : t('Ошибка сохранения шаблона')) }
    finally { setBusy(false) }
  }
  async function remove(template: Template) {
    const prompt = t('Удалить шаблон «{name}»? Размещённые карточки останутся на столе и будут показывать заглушку.', { name: template.name })
    if (busy || !window.confirm(prompt)) return
    setError('')
    setBusy(true)
    try {
      await api('templates/' + template.id + '?revision=' + template.revision, 'DELETE')
      deleted(template.id)
      open('')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Не удалось удалить шаблон'))
    } finally {
      setBusy(false)
    }
  }
  return <div className="builder" inert={busy} aria-busy={busy} onPointerDownCapture={drag.cancelClick} onKeyDownCapture={drag.cancelClick}>
    <div className="builder-bar">
      <label>{t('Шаблон')}<select aria-label={t('Шаблон')} value={templateId} onChange={e => open(e.target.value)}>
        <option value="">{t('Новый шаблон')}</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select></label>
      <label>{t('Название шаблона')}<input value={draft.name} maxLength={100} placeholder={t('Например, Домашний сервер')}
        onChange={e => change({ name: e.target.value })} /></label>
      <label>{t('Описание')}<input value={draft.description ?? ''} maxLength={2000}
        onChange={e => change({ description: e.target.value })} /></label>
      <TemplateImport key={templateId} setBusy={setBusy} imported={imported} open={open} />
      <button className="primary" disabled={busy} onClick={save}>{t('Сохранить шаблон')}</button>
      {selectedTemplate && <button disabled={busy} onClick={() => void remove(selectedTemplate)}>{t('Удалить шаблон')}</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="builder-layout">
      <section className="builder-palette"><h3>{t('Элементы')}</h3>
        <h4>{t('Простые элементы')}</h4>
        {(Object.keys(kinds) as Kind[]).filter(k => k !== 'shortcut').map(paletteButton)}
        <h4>{t('Элементы интеграций')}</h4>
        {paletteButton('shortcut')}
      </section>
      <section className="builder-canvas"><h3>{t('Предпросмотр')}</h3>
        <div className="preview-size">
          <label>{t('Ширина в клетках')}<input type="number" min={1} max={columns} value={width || ''}
            onChange={e => change({ defaultWidth: Number(e.target.value) })} /></label>
          <label>{t('Высота в клетках')}<input type="number" min={1} max={maxRows} value={height || ''}
            onChange={e => change({ defaultHeight: Number(e.target.value) })} /></label>
          <label><input type="checkbox" checked={guides} onChange={e => setGuides(e.target.checked)} /> {t('Сетка')}</label>
        </div>
        <div className="preview-stage" ref={stage}>
          <div className="builder-sheet" data-guides={guides} style={{ width: Math.max(1, Math.min(width, columns)) * cellSize,
            height: Math.max(1, Math.min(height, maxRows)) * cellSize, zoom: scale } as CSSProperties}>
            <div className="builder-sheet-frame">
              <h4>{draft.name || t('Новый виджет')}</h4>
              <div className="preview-body" ref={surface} style={{ '--columns': gridWidth, '--rows': gridHeight } as CSSProperties}>
                <ElementLayout rows={draft.rows} width={gridWidth / subdivisions} height={gridHeight / subdivisions} render={el =>
                  <div className="builder-preview-cell" data-dragging={drag.target?.item.id === el.id}>
                    <div className="frame-content" inert><ElementView item={el} /></div>
                    <button className="element-select" aria-label={t('Выбрать {kind} · {label}', { kind: t(kinds[el.kind]), label: itemLabel(el, t) })} aria-pressed={el.id === elementId}
                      title={t('Дважды нажмите, чтобы скопировать выражение Python')}
                      onMouseDown={e => { if (tab === 'actions') e.preventDefault() }}
                      onKeyDown={e => arrow(e, el, false)}
                      {...drag.handlers('move', () => el, () => select(el.id), button => void copyContext(el.id, button))} />
                    {el.id === elementId && <button className="resize-handle" aria-label={t('Изменить размер элемента')}
                      title={t('Потяните за угол или используйте стрелки')} onKeyDown={e => arrow(e, el, true)}
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
        <button aria-pressed={tab === 'element'} onClick={() => setTab('element')}>{t('Свойства')}</button>
        <button aria-pressed={tab === 'actions'} onClick={() => { if (tab !== 'actions') showActions() }}>{t('Действия')}</button>
        <button className="action-help-toggle" type="button" title={t('Справка по API действий')} aria-label={t('Справка по API действий')}
          aria-expanded={helpOpen} aria-controls="builder-action-help" onClick={() => setHelpOpen(open => !open)}>i</button>
      </div>
      {helpOpen && <ActionHelp switchId={items.find(e => e.kind === 'switch')?.id} />}
      {tab === 'element' && (item ? <>
        <h4>{t(kinds[item.kind])}</h4>
        <label>{t('Подпись')}<input value={itemLabel(item, t)} onChange={e => updateItem({ label: e.target.value, defaultLabel: false })} /></label>
        {item.kind === 'shortcut' && <>
          <label>{t('Адрес ссылки')}<input type="url" placeholder="https://example.com" value={item.href ?? ''}
            onChange={e => updateItem({ href: e.target.value })} /></label>
          <label className="builder-check"><input type="checkbox" checked={!!item.siteIcon}
            onChange={e => updateItem({ siteIcon: e.target.checked })} />{t('Использовать иконку сайта')}</label>
          {!item.siteIcon && <label>{t('Иконка PNG')}<input type="file" accept="image/png" onChange={e => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            const invalid = () => setError(t('Выберите PNG до 256 КиБ'))
            if (file.size > 262144) { invalid(); return }
            const reader = new FileReader()
            reader.onerror = invalid
            reader.onload = () => {
              const png = String(reader.result)
              if (!png.startsWith('data:image/png;base64,iVBORw0KGgo')) { invalid(); return }
              setError('')
              setDraft(old => ({ ...old, rows: old.rows.map(row => row.map(el => el.id === item.id ? { ...el, png } : el)) }))
            }
            reader.readAsDataURL(file)
          }} /></label>}
          {!item.siteIcon && item.png && <button onClick={() => updateItem({ png: '' })}>{t('Убрать иконку')}</button>}
        </>}
        {item.kind === 'input' && <>
          <label>{t('Формат поля')}<select value={item.inputMode ?? 'text'}
            onChange={e => updateItem({ inputMode: e.target.value as Item['inputMode'] })}>
            {Object.entries(inputFormats).map(([format, { label }]) => <option key={format} value={format}>{t(label)}</option>)}
          </select></label>
          <label>{t('Подсказка')}<input maxLength={200} value={item.placeholder ?? ''}
            placeholder={t(inputFormats[item.inputMode ?? 'text'].placeholder)}
            onChange={e => updateItem({ placeholder: e.target.value })} /></label>
          <label>{t('Сброс по команде')}<input maxLength={100} value={item.resetCommand ?? ''}
            placeholder={t('Без сброса')} onChange={e => updateItem({ resetCommand: e.target.value })} /></label>
          <small>{t('Ключ значения для Python ·')} <code>{item.id}</code></small>
        </>}
        {['button', 'switch', 'slider'].includes(item.kind) && <>
          <label>{t('Отправить команду')}<input value={item.command} placeholder={t('Например, refresh')} onChange={e => updateItem({ command: e.target.value })} /></label>
          {item.command && <small>{t('Действия ·')} {sentActions.map(a => actionName(a, t)).join(', ') || t('не назначены')}</small>}
        </>}
        {item.kind === 'switch' && <label className="builder-check"><input type="checkbox" checked={item.checked}
          onChange={e => updateItem({ checked: e.target.checked })} />{t('Включён изначально')}</label>}
        {item.kind === 'slider' && (['minimum', 'maximum', 'step', 'initial'] as const).map((key, i) =>
          <label key={key}>{[t('Минимум'), t('Максимум'), t('Шаг'), t('Начальное значение')][i]}
            <input type="number" step="any" value={item[key]} onChange={e => updateItem({ [key]: Number(e.target.value) })} /></label>)}
        {item.kind === 'indicator' && <label>{t('Начальный цвет')}<select value={item.color} onChange={e => updateItem({ color: e.target.value as Color })}>
          {Object.entries(colors).map(([k,v]) => <option value={k} key={k}>{t(v)}</option>)}</select></label>}
        {['text', 'indicator'].includes(item.kind) && <>
          <label>{t('Обновление')}<select aria-label={t('Обновление')} value={source?.trigger ?? 'static'} onChange={e => setMode(e.target.value as Action['trigger'] | 'static')}>
            <option value="static">{t('Без обновления')}</option><option value="timer">{t('По таймеру')}</option><option value="command">{t('По команде')}</option>
          </select></label>
          {source && <label>{t('Действие обновления')}<select value={source.id} onChange={e => bind(e.target.value)}>
            {draft.actions.filter(a => a.trigger === source.trigger).map(a => <option key={a.id} value={a.id}>{actionLabel(a, t)}</option>)}
          </select></label>}
          {source && <button onClick={() => showActions(source.id)}>{t('Настроить действия')}</button>}
          {source && source.targets.length > 1 && <button onClick={() => showActions(createUpdate(source.trigger))}>
            {t('Создать отдельное действие')}
          </button>}
        </>}
        {item.kind !== 'indicator' && <>
          <label>{t('Шрифт')}<select value={item.fontFamily ?? 'system'}
            onChange={e => updateItem({ fontFamily: e.target.value as Item['fontFamily'] })}>
            <option value="system">{t('Системный')}</option><option value="serif">{t('С засечками')}</option>
            <option value="monospace">{t('Моноширинный')}</option>
          </select></label>
          <label>{t('Размер шрифта, пт')}<input type="number" min={1} max={144} value={item.fontSize ?? 12}
            onChange={e => updateItem({ fontSize: e.target.value ? Number(e.target.value) : undefined })} /></label>
        </>}
        <button onClick={() => { change({ rows: [items.filter(e => e.id !== elementId)] }); setElement('') }}>{t('Удалить элемент')}</button>
      </> : <p>{t('Выберите элемент в предпросмотре.')}</p>)}
      {tab === 'actions' && <>
        <label>{t('Тип действия')}<select value={kind} onChange={e => setKind(e.target.value as ActionKind)}>
          {Object.entries(actionKinds).map(([k,v]) => <option key={k} value={k}>{t(v)}</option>)}</select></label>
        <button onClick={() => {
          const a = { ...newAction(kind, t), command: unusedCommand(draft) }
          change({ actions: [...draft.actions, a] }); setAction(a.id)
        }}>{t('Добавить действие')}</button>
        {!!draft.actions.length && <label>{t('Действие')}<select value={actionId} onChange={e => setAction(e.target.value)}>
          <option value="">{t('Выберите действие')}</option>
          {draft.actions.map(a => <option key={a.id} value={a.id}>{actionLabel(a, t)}</option>)}</select></label>}
        {action && <><ActionEditor action={action} items={items} update={delta =>
          change({ actions: draft.actions.map(a => a.id === action.id ? { ...a, ...delta } : a) })} />
          <button onClick={() => {
            const actions = draft.actions.filter(a => a.id !== actionId)
            change({ actions }); setAction('')
          }}>{t('Удалить действие')}</button></>}
      </>}
      </section>
    </div>
  </div>
}
