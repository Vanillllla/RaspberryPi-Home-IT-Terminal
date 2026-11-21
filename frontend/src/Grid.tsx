import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { placementError } from './layout'
import type { WidgetInstance } from './plugin'

interface Props {
  widgets: WidgetInstance[]
  columns: number
  rows: number
  interactive: boolean
  title: (widget: WidgetInstance) => string
  render: (widget: WidgetInstance) => ReactNode
  move: (id: number, slot: number) => Promise<void>
}

interface Press {
  pointer: number
  startX: number
  startY: number
  gripX: number
  gripY: number
  tile: HTMLElement
  timer: number
  dragging: boolean
}

export function Grid({ widgets, columns, rows, interactive, title, render, move }: Props) {
  const board = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
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
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (interactive && e.key === 'Escape') {
        suppressClick.current = true
        reset()
      }
    }
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('keydown', escape); clearTimeout(press.current?.timer) }
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
    const inside = e.clientX >= visible.left && e.clientX < visible.right &&
      e.clientY >= Math.max(0, bounds.top) && e.clientY < Math.min(window.innerHeight, bounds.bottom)
    return inside && fits(w, x, y) ? y * columns + x : null
  }

  async function finish(w: WidgetInstance, slot: number | null) {
    reset()
    if (slot === null || slot === w.slot || !interactive) return
    setPending({ id: w.id, slot })
    try { await move(w.id, slot) }
    finally { setPending(null) }
  }

  function cancel(e: PointerEvent) {
    if (press.current?.pointer !== e.pointerId) return
    suppressClick.current = true
    reset()
  }

  function start(e: PointerEvent<HTMLButtonElement>, w: WidgetInstance) {
    if (!interactive || pending || !e.isPrimary || e.button !== 0 || press.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    suppressClick.current = false
    const tile = e.currentTarget.closest<HTMLElement>('.tile')!
    const rect = tile.getBoundingClientRect()
    const bounds = board.current!.getBoundingClientRect()
    const gripX = e.clientX - rect.left, gripY = e.clientY - rect.top
    tile.style.transformOrigin = gripX + 'px ' + gripY + 'px'
    tile.style.setProperty('--free-x', rect.left - bounds.left + 'px')
    tile.style.setProperty('--free-y', rect.top - bounds.top + 'px')
    press.current = {
      pointer: e.pointerId, startX: e.clientX, startY: e.clientY, gripX, gripY, tile, dragging: false,
      timer: window.setTimeout(() => {
        if (!press.current) return
        press.current.dragging = true
        suppressClick.current = true
        setPicked(null)
        setDragging(w.id)
        setTarget(w.slot)
      }, 350),
    }
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
    <div className="grid-scroll-controls" aria-label="Прокрутка сетки">
      <button aria-label="Прокрутить сетку влево" onClick={() => viewport.current?.scrollBy({ left: -240 })}>←</button>
      <span>Область сетки</span>
      <button aria-label="Прокрутить сетку вправо" onClick={() => viewport.current?.scrollBy({ left: 240 })}>→</button>
    </div>
    <div className="board-scroll" ref={viewport}>
      <div ref={board} className={'board' + (selected ? ' moving' : '')}
        style={{ aspectRatio: columns + '/' + rows, backgroundSize: (100 / columns) + '% ' + (100 / rows) + '%' }}>
        <div className="grid-surface" />
        {selected && target !== null && <div className="grid-target" style={geometry(target, selected.width, selected.height)} />}
        {widgets.map(w => <div key={w.id} data-slot={w.slot} data-widget={w.id}
          className={'tile' + (dragging === w.id ? ' lifted' : '') + (selected?.id === w.id ? ' selected' : '')}
          style={geometry(pending?.id === w.id ? pending.slot : w.slot, w.width, w.height)}>
          <article>
            <button className="handle" disabled={!interactive || pending !== null} aria-label={'Переместить: ' + title(w)}
              aria-pressed={selected?.id === w.id} title="Удерживайте и перетащите или нажмите и выберите ячейку"
              onPointerDown={e => start(e, w)}
              onPointerMove={e => {
                const grip = press.current
                if (!grip || grip.pointer !== e.pointerId) return
                if (grip.dragging) setTarget(follow(e, w, grip))
                else if (Math.hypot(e.clientX - grip.startX, e.clientY - grip.startY) > 10) cancel(e)
              }}
              onPointerCancel={cancel} onLostPointerCapture={cancel}
              onPointerUp={e => {
                const grip = press.current
                if (!grip || grip.pointer !== e.pointerId) return
                if (grip.dragging) void finish(w, follow(e, w, grip))
                else if (Math.hypot(e.clientX - grip.startX, e.clientY - grip.startY) > 10) cancel(e)
                else { clearTimeout(grip.timer); press.current = null }
              }}
              onClick={e => {
                if (interactive && (e.detail === 0 || !suppressClick.current)) {
                  setPicked(picked === w.id ? null : w.id)
                  setTarget(null)
                }
              }}>
              <span className="grip" aria-hidden="true">⠿</span><span>{title(w)}</span>
            </button>
            {render(w)}
          </article>
        </div>)}
        {picked !== null && selected && Array.from({ length: columns * rows }, (_, slot) =>
          slot !== selected.slot && fits(selected, slot % columns, Math.floor(slot / columns)) &&
          <button className="drop" key={slot} style={geometry(slot, 1, 1)} aria-label={'В ячейку ' + (slot + 1)}
            onFocus={() => setTarget(slot)} onPointerEnter={() => setTarget(slot)}
            onClick={() => void finish(selected, slot)}>{slot + 1}</button>)}
      </div>
    </div>
  </>
}
