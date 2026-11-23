import { useEffect, useRef, useState, type PointerEvent, type MouseEvent, type RefObject } from 'react'
import type { Frame, Item } from './model'
import { canPlace } from './ElementLayout'

type Mode = 'add' | 'move' | 'resize'
interface Press { item: Item; mode: Mode; pointer: number; x: number; y: number; moved: boolean }
const doubleClickDelay = 500

// A span of zero lies on a grid line. A span of one puts the stroke at the cell center.
export function dividerFrame(item: Item, mode: Mode, dx: number, dy: number, width: number, height: number): Frame {
  const frame = { ...item.frame! }
  const vertical = item.orientation === 'vertical'
  const along = vertical ? 'y' : 'x', across = vertical ? 'x' : 'y'
  const length = vertical ? 'height' : 'width', thickness = vertical ? 'width' : 'height'
  const travel = vertical ? dy : dx, offset = vertical ? dx : dy
  if (mode === 'resize') {
    frame[length] = Math.max(1, Math.min((vertical ? height : width) - frame[along], frame[length] + Math.round(travel)))
  } else {
    const center = mode === 'add' ? offset : frame[across] + frame[thickness] / 2 + offset
    const snapped = Math.round(center * 2) / 2
    frame[across] = Math.floor(snapped)
    frame[thickness] = (snapped - frame[across]) * 2
    frame[along] = mode === 'add' ? Math.floor(travel) : frame[along] + Math.round(travel)
  }
  return frame
}

export function useElementDrag(surface: RefObject<HTMLDivElement | null>, items: Item[], width: number, height: number,
  place: (item: Item, frame: Frame) => void) {
  const press = useRef<Press | null>(null)
  const suppress = useRef(false)
  const pendingClick = useRef<number>(undefined)
  const [target, setTarget] = useState<{ item: Item; frame: Frame; valid: boolean } | null>(null)

  function locate(e: PointerEvent, start: Press) {
    const node = surface.current
    if (!node) return null
    const rect = node.getBoundingClientRect()
    const frame = { ...start.item.frame! }
    if (start.mode !== 'resize' && !node.contains(document.elementFromPoint(e.clientX, e.clientY))) return null
    if (start.item.kind === 'divider') {
      const x = (e.clientX - (start.mode === 'add' ? rect.left : start.x)) * width / rect.width
      const y = (e.clientY - (start.mode === 'add' ? rect.top : start.y)) * height / rect.height
      const line = dividerFrame(start.item, start.mode, x, y, width, height)
      return { item: start.item, frame: line, valid: canPlace(start.item, line, items, width, height) }
    }
    const dx = Math.round((e.clientX - start.x) * width / rect.width)
    const dy = Math.round((e.clientY - start.y) * height / rect.height)
    if (start.mode === 'resize') {
      frame.width = Math.max(1, Math.min(width - frame.x, frame.width + dx))
      frame.height = Math.max(1, Math.min(height - frame.y, frame.height + dy))
    } else if (start.mode === 'move') {
      frame.x += dx
      frame.y += dy
    } else {
      frame.x = Math.floor((e.clientX - rect.left) * width / rect.width)
      frame.y = Math.floor((e.clientY - rect.top) * height / rect.height)
    }
    return { item: start.item, frame, valid: canPlace(start.item, frame, items, width, height) }
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
    return () => {
      window.removeEventListener('keydown', escape, true)
      window.clearTimeout(pendingClick.current)
    }
  }, [])

  function cancelClick() {
    window.clearTimeout(pendingClick.current)
  }

  function interrupted(e: PointerEvent<HTMLButtonElement>) {
    if (press.current?.pointer === e.pointerId) cancel()
  }

  function handlers(mode: Mode, getItem: () => Item, click: () => void, doubleClick?: (button: HTMLButtonElement) => void) {
    return {
      onPointerDown(e: PointerEvent<HTMLButtonElement>) {
        if (!e.isPrimary || e.button !== 0 || press.current) return
        suppress.current = false
        press.current = { item: getItem(), mode, pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      },
      onPointerMove(e: PointerEvent<HTMLButtonElement>) {
        const start = press.current
        if (!start || start.pointer !== e.pointerId) return
        if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3) return
        start.moved = suppress.current = true
        setTarget(locate(e, start))
      },
      onPointerUp(e: PointerEvent<HTMLButtonElement>) {
        const start = press.current
        if (!start || start.pointer !== e.pointerId) return
        const drop = start.moved && locate(e, start)
        cancel()
        if (drop && drop.valid) place(drop.item, drop.frame)
      },
      onPointerCancel: interrupted,
      onLostPointerCapture: interrupted,
      onClick(e: MouseEvent) {
        if (!e.detail) {
          cancelClick()
          click()
          return
        }
        if (suppress.current) return
        if (!doubleClick) click()
        else if (e.detail === 1) pendingClick.current = window.setTimeout(click, doubleClickDelay)
      },
      onDoubleClick(e: MouseEvent<HTMLButtonElement>) {
        if (doubleClick && !suppress.current) {
          cancelClick()
          doubleClick(e.currentTarget)
        }
      },
    }
  }
  return { target, handlers, cancelClick }
}
