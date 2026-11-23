import { useTranslation } from './i18n'
import { cardAppearance } from './appearance'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { placementError } from './layout'
import type { WidgetInstance } from './plugin'

interface Props {
  widgets: WidgetInstance[]
  columns: number
  maxRows: number
  reportCellSize?: (size: number) => void
  reportRows?: (rows: number) => void
  interactive: boolean
  title: (widget: WidgetInstance) => string
  openActions: (id: number) => void
  render: (widget: WidgetInstance) => ReactNode
  move: (id: number, slot: number, rows: number) => Promise<void>
}

interface Press {
  pointer: number
  startX: number
  startY: number
  gripX: number
  gripY: number
  tile: HTMLElement
  fromHandle: boolean
  timer?: number
  dragging: boolean
}

const controlSelector = [
  'button', 'a[href]', 'input', 'textarea', 'select', 'label', 'summary', '[tabindex]',
  '[contenteditable]:not([contenteditable="false"])', '[draggable="true"]', 'audio[controls]', 'video[controls]',
  ...['button', 'link', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'textbox',
    'combobox', 'listbox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab']
    .map(role => '[role~="' + role + '"]'),
].join(',')

export function Grid({ widgets, columns, maxRows, reportRows, reportCellSize, interactive, title, openActions, render, move }: Props) {
  const { t } = useTranslation()
  const board = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = viewport.current!
    const measure = () => {
      const width = element.clientWidth, height = element.clientHeight
      setArea(previous => previous.width === width && previous.height === height ? previous : { width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Tile padding provides the gutters inside each square's footprint.
  const preferredWidth = Math.max(720, area.width)
  const savedRows = widgets.reduce((bottom, w) => Math.max(bottom, Math.floor(w.slot / columns) + w.height), 0)
  const rows = Math.min(maxRows, Math.max(1, savedRows, Math.floor(area.height * columns / preferredWidth)))
  const boardWidth = Math.min(preferredWidth, area.height * columns / rows)
  useLayoutEffect(() => { reportRows?.(rows) }, [reportRows, rows])

  useLayoutEffect(() => { if (boardWidth > 0) reportCellSize?.(boardWidth / columns) }, [reportCellSize, boardWidth, columns])

  const press = useRef<Press | null>(null)
  const suppressClick = useRef(false)
  const [picked, setPicked] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [target, setTarget] = useState<number | null>(null)
  const [pending, setPending] = useState<{ id: number; slot: number } | null>(null)
  const selected = widgets.find(w => w.id === (dragging ?? picked))

  function reset() {
    clearTimeout(press.current?.timer)
    press.current = null
    setDragging(null)
    setPicked(null)
    setTarget(null)
  }
  useLayoutEffect(() => {
    if (!interactive) {
      suppressClick.current = true
      reset()
    }
  }, [interactive])
  useLayoutEffect(() => { reset() }, [rows, boardWidth])
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (interactive && e.key === 'Escape') {
        suppressClick.current = true
        reset()
      }
    }
    // Keep native scrolling until a hold claims this touch sequence.
    const surface = board.current!
    function touchMove(e: TouchEvent) {
      if (press.current?.dragging && e.cancelable) e.preventDefault()
    }
    surface.addEventListener('touchmove', touchMove, { passive: false })
    window.addEventListener('keydown', escape)
    return () => {
      surface.removeEventListener('touchmove', touchMove)
      window.removeEventListener('keydown', escape)
      clearTimeout(press.current?.timer)
    }
  }, [interactive])

  function fits(w: WidgetInstance, x: number, y: number) {
    return !placementError(widgets, columns, rows, w.id, x, y, w.width, w.height)
  }

  // All coordinates are relative to the board. Scaling around the grip keeps
  // the same point of the lifted card underneath the pointer.
  function follow(e: PointerEvent, w: WidgetInstance, grip: Press) {
    const bounds = board.current!.getBoundingClientRect()
    const cell = bounds.width / columns
    const left = e.clientX - bounds.left - grip.gripX
    const top = e.clientY - bounds.top - grip.gripY
    grip.tile.style.setProperty('--free-x', left + 'px')
    grip.tile.style.setProperty('--free-y', top + 'px')
    const x = Math.round(left / cell), y = Math.round(top / cell)
    const visible = viewport.current!.getBoundingClientRect()
    const inside = e.clientX >= Math.max(visible.left, bounds.left) && e.clientX < Math.min(visible.right, bounds.right) &&
      e.clientY >= Math.max(0, bounds.top) && e.clientY < Math.min(window.innerHeight, bounds.bottom)
    return inside && fits(w, x, y) ? y * columns + x : null
  }

  async function finish(w: WidgetInstance, slot: number | null) {
    reset()
    if (slot === null || slot === w.slot || !interactive) return
    setPending({ id: w.id, slot })
    try { await move(w.id, slot, rows) }
    finally { setPending(null) }
  }

  function cancel(e: PointerEvent) {
    if (press.current?.pointer !== e.pointerId) return
    suppressClick.current = true
    reset()
  }

  function lift(grip: Press, w: WidgetInstance) {
    grip.dragging = true
    suppressClick.current = true
    setPicked(null)
    setDragging(w.id)
    setTarget(w.slot)
  }

  function start(e: PointerEvent<HTMLElement>, w: WidgetInstance) {
    if (!e.isPrimary || e.button !== 0 || press.current) return
    suppressClick.current = false
    if (!interactive || pending || !(e.target instanceof Element)) return
    const origin = e.target
    if (!e.currentTarget.contains(origin)) return
    const fromHandle = e.currentTarget.querySelector('.handle')!.contains(origin)
    if (!fromHandle && origin.closest(controlSelector)) return
    if (origin instanceof HTMLElement && origin.classList.contains('widget-scroll')) {
      const bounds = origin.getBoundingClientRect()
      // Leave pointer capture to the browser when pressing a native scrollbar.
      if (e.clientX >= bounds.left + origin.clientWidth || e.clientY >= bounds.top + origin.clientHeight) return
    }

    // Capturing on the original target preserves its short-click action.
    origin.setPointerCapture(e.pointerId)
    const tile = e.currentTarget.parentElement!
    const rect = tile.getBoundingClientRect()
    const bounds = board.current!.getBoundingClientRect()
    const gripX = e.clientX - rect.left, gripY = e.clientY - rect.top
    tile.style.transformOrigin = gripX + 'px ' + gripY + 'px'
    tile.style.setProperty('--free-x', rect.left - bounds.left + 'px')
    tile.style.setProperty('--free-y', rect.top - bounds.top + 'px')
    const grip: Press = {
      pointer: e.pointerId, startX: e.clientX, startY: e.clientY, gripX, gripY, tile, fromHandle, dragging: false,
    }
    press.current = grip
    if (!fromHandle) grip.timer = window.setTimeout(() => lift(grip, w), 350)
  }

  function crossedThreshold(e: PointerEvent, grip: Press) {
    return Math.hypot(e.clientX - grip.startX, e.clientY - grip.startY) >= (grip.fromHandle ? 5 : 10)
  }

  function pointerMove(e: PointerEvent, w: WidgetInstance) {
    const grip = press.current
    if (!grip || grip.pointer !== e.pointerId) return
    if (!grip.dragging) {
      if (!crossedThreshold(e, grip)) return
      if (!grip.fromHandle) return cancel(e)
      lift(grip, w)
    }
    setTarget(follow(e, w, grip))
  }

  function pointerUp(e: PointerEvent, w: WidgetInstance) {
    const grip = press.current
    if (!grip || grip.pointer !== e.pointerId) return
    if (grip.dragging) void finish(w, follow(e, w, grip))
    else if (crossedThreshold(e, grip)) cancel(e)
    else { clearTimeout(grip.timer); press.current = null }
  }

  function geometry(slot: number, width: number, height: number): CSSProperties {
    const unit = 100 / columns
    return {
      '--x': (slot % columns) * unit + 'cqw',
      '--y': Math.floor(slot / columns) * unit + 'cqw',
      width: width * unit + 'cqw', height: height * unit + 'cqw',
    } as CSSProperties
  }

  return <>
    <div className="grid-scroll-controls" aria-label={t('Прокрутка сетки')}>
      <button aria-label={t('Прокрутить сетку влево')} onClick={() => viewport.current?.scrollBy({ left: -240 })}>←</button>
      <span>{t('Область сетки')}</span>
      <button aria-label={t('Прокрутить сетку вправо')} onClick={() => viewport.current?.scrollBy({ left: 240 })}>→</button>
    </div>
    <div className="board-scroll" ref={viewport}>
      <div ref={board} className={'board' + (selected ? ' moving' : '')}
        style={{ width: boardWidth, aspectRatio: columns + '/' + rows }}>
        <div className="grid-surface" />
        {selected && target !== null && <div className="grid-target" style={geometry(target, selected.width, selected.height)} />}
        {widgets.map(w => <div key={w.id} data-slot={w.slot} data-widget={w.id}
          className={'tile' + (dragging === w.id ? ' lifted' : '') + (selected?.id === w.id ? ' selected' : '')}
          style={geometry(pending?.id === w.id ? pending.slot : w.slot, w.width, w.height)}>
          <article data-palette={cardAppearance(w.appearance).cardPalette} onPointerDownCapture={e => start(e, w)} onPointerMove={e => pointerMove(e, w)}
            onPointerUp={e => pointerUp(e, w)} onPointerCancel={cancel} onLostPointerCapture={cancel}
            onContextMenu={e => { if (press.current?.dragging) e.preventDefault() }}
            onClickCapture={e => {
              if (e.detail !== 0 && suppressClick.current) {
                e.preventDefault()
                e.stopPropagation()
              }
            }}>
            <div className="card-heading">
              <button className="handle" disabled={!interactive || pending !== null}
                aria-label={t('Переместить: {title}', { title: title(w) })} aria-pressed={selected?.id === w.id}
                title={t('Потяните для переноса или нажмите и выберите ячейку')}
                onClick={() => {
                  setPicked(picked === w.id ? null : w.id)
                  setTarget(null)
                }}>
                <span className="grip" aria-hidden="true">⠿</span>
              </button>
              {!cardAppearance(w.appearance).hideTitle &&
                <span className="card-title" title={title(w)}><span data-palette={cardAppearance(w.appearance).titlePalette}>{title(w)}</span></span>}
              <button className="widget-actions" aria-label={t('Действия с виджетом')} aria-haspopup="dialog"
                title={t('Действия с виджетом')} onClick={() => openActions(w.id)}>⋯</button>
            </div>
            <div className="widget-scroll">{render(w)}</div>
          </article>
        </div>)}
        {picked !== null && selected && Array.from({ length: columns * rows }, (_, slot) =>
          slot !== selected.slot && fits(selected, slot % columns, Math.floor(slot / columns)) &&
          <button className="drop" key={slot} style={geometry(slot, 1, 1)} aria-label={t('В ячейку {number}', { number: slot + 1 })}
            onFocus={() => setTarget(slot)} onPointerEnter={() => setTarget(slot)}
            onClick={() => void finish(selected, slot)}>{slot + 1}</button>)}
      </div>
    </div>
  </>
}
