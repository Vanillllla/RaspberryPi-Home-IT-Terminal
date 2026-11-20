import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { WidgetInstance } from './plugin'

interface Props {
  widgets: WidgetInstance[]
  interactive: boolean
  title: (widget: WidgetInstance) => string
  render: (widget: WidgetInstance) => ReactNode
  move: (id: number, slot: number) => void
}

interface Press {
  pointer: number
  x: number
  y: number
  timer: number
  dragging: boolean
}

export function Grid({ widgets, interactive, title, render, move }: Props) {
  const board = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(1)
  const [moving, setMoving] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const press = useRef<Press | null>(null)
  const suppressClick = useRef(false)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setColumns(Math.max(1, Math.min(4, Math.floor((entry.contentRect.width + 16) / 250)))))
    observer.observe(board.current!)
    return () => { observer.disconnect(); clearTimeout(press.current?.timer) }
  }, [])

  function reset() {
    clearTimeout(press.current?.timer)
    press.current = null
    setMoving(null)
    setHover(null)
  }
  useLayoutEffect(() => {
    if (!interactive) {
      suppressClick.current = true
      reset()
    }
  }, [interactive])
  useEffect(() => {
    if (!interactive) return
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        suppressClick.current = true
        reset()
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [interactive])

  const bySlot = new Map(widgets.map(w => [w.slot, w]))
  const last = Math.max(-1, ...bySlot.keys())
  const cells = Math.min(4096, columns * Math.max(2, Math.ceil((last + 2) / columns) + 1))

  function cellAt(e: PointerEvent) {
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-slot]')
    return target && board.current?.contains(target) ? Number(target.dataset.slot) : null
  }
  function finish(id: number, slot: number | null) {
    if (interactive && slot !== null && !bySlot.has(slot)) move(id, slot)
    reset()
  }
  function cancel(e: PointerEvent) {
    if (press.current?.pointer === e.pointerId) {
      suppressClick.current = true
      reset()
    }
  }
  function start(e: PointerEvent<HTMLButtonElement>, id: number) {
    if (!interactive || !e.isPrimary || e.button !== 0 || press.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    suppressClick.current = false
    press.current = {
      pointer: e.pointerId, x: e.clientX, y: e.clientY, dragging: false,
      timer: window.setTimeout(() => {
        if (!press.current) return
        press.current.dragging = true
        suppressClick.current = true
        setMoving(id)
      }, 350),
    }
  }
  function movedTooFar(e: PointerEvent, start: Press) {
    return Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10
  }

  return <div ref={board} className={'board' + (moving !== null ? ' moving' : '')}
    style={{ gridTemplateColumns: 'repeat(' + columns + ', minmax(0, 1fr))' }}>
    {Array.from({ length: cells }, (_, slot) => {
      const widget = bySlot.get(slot)
      return <div className={'cell' + (hover === slot && !widget ? ' target' : '')} key={slot} data-slot={slot}>
        {widget ? <article className={moving === widget.id ? 'selected' : ''}>
          <button className="handle" aria-label={'Переместить: ' + title(widget)}
            aria-pressed={moving === widget.id} title="Удерживайте и перетащите или нажмите и выберите ячейку"
            onPointerDown={e => start(e, widget.id)}
            onPointerMove={e => {
              const start = press.current
              if (start?.pointer !== e.pointerId) return
              if (start.dragging) setHover(cellAt(e))
              else if (movedTooFar(e, start)) cancel(e)
            }}
            onPointerCancel={cancel} onLostPointerCapture={cancel}
            onPointerUp={e => {
              const start = press.current
              if (start?.pointer !== e.pointerId) return
              if (start.dragging) finish(widget.id, cellAt(e))
              else if (movedTooFar(e, start)) cancel(e)
              else {
                clearTimeout(start.timer)
                press.current = null
              }
            }}
            onClick={e => {
              if (interactive && (e.detail === 0 || !suppressClick.current))
                setMoving(moving === widget.id ? null : widget.id)
            }}>
            <span className="grip" aria-hidden="true">⠿</span>{title(widget)}
          </button>
          {render(widget)}
        </article> : moving !== null && <button className="drop" onClick={() => finish(moving, slot)}>
          В ячейку {slot + 1}
        </button>}
      </div>
    })}
  </div>
}
