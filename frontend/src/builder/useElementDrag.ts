import { useEffect, useRef, useState, type PointerEvent, type MouseEvent, type RefObject } from 'react'
import type { Cell, Item } from './model'
import { canPlace } from './ElementLayout'

export function useElementDrag(surface: RefObject<HTMLDivElement | null>, items: Item[], width: number, height: number,
  place: (item: Item, cell: Cell) => void) {
  const press = useRef<{ item: Item; pointer: number; x: number; y: number; moved: boolean } | null>(null)
  const suppress = useRef(false)
  const [target, setTarget] = useState<{ item: Item; cell: Cell; span: number; valid: boolean } | null>(null)

  function locate(e: PointerEvent, item: Item) {
    const node = surface.current
    if (!node || !node.contains(document.elementFromPoint(e.clientX, e.clientY))) return null
    const rect = node.getBoundingClientRect()
    const cell = {
      x: Math.floor(((e.clientX - rect.left) * node.offsetWidth / rect.width + node.scrollLeft) * width / node.clientWidth),
      y: Math.floor(((e.clientY - rect.top) * node.offsetHeight / rect.height + node.scrollTop) * height / node.clientHeight),
    }
    if (cell.x < 0 || cell.x >= width || cell.y < 0 || cell.y >= height) return null
    return { item, cell, span: Math.min(width - cell.x, item.span ?? 1), valid: canPlace(item, cell, items, width, height) }
  }

  function cancel() {
    press.current = null
    setTarget(null)
  }

  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && press.current) {
        event.preventDefault()
        suppress.current = true
        cancel()
      }
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [])

  function interrupted(e: PointerEvent<HTMLButtonElement>) {
    if (press.current?.pointer === e.pointerId) cancel()
  }

  function handlers(getItem: () => Item, click: () => void) {
    return {
      onPointerDown(e: PointerEvent<HTMLButtonElement>) {
        if (!e.isPrimary || e.button !== 0 || press.current) return
        suppress.current = false
        press.current = { item: getItem(), pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      },
      onPointerMove(e: PointerEvent<HTMLButtonElement>) {
        const start = press.current
        if (!start || start.pointer !== e.pointerId) return
        if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return
        start.moved = suppress.current = true
        setTarget(locate(e, start.item))
      },
      onPointerUp(e: PointerEvent<HTMLButtonElement>) {
        const start = press.current
        if (!start || start.pointer !== e.pointerId) return
        const drop = start.moved && locate(e, start.item)
        cancel()
        if (drop && drop.valid) place(start.item, drop.cell)
      },
      onPointerCancel: interrupted,
      onLostPointerCapture: interrupted,
      onClick(e: MouseEvent) { if (!e.detail || !suppress.current) click() },
    }
  }
  return { target, handlers }
}
