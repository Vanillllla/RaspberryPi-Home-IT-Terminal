import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { Desktop } from './api'

interface Props {
  desktops: Desktop[]
  active: Desktop
  blocked: boolean
  select: (id: number) => void
  render: (desktop: Desktop, interactive: boolean) => ReactNode
}

type Peer = { desktop: Desktop; side: number }
type Swipe = { pointer: number; x: number; y: number; width: number }
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function DesktopPager({ desktops, active, blocked, select, render }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const swipe = useRef<Swipe | null>(null)
  const offset = useRef(0)
  const animation = useRef<Animation | null>(null)
  const previous = useRef(active)
  const [peer, setPeer] = useState<Peer | null>(null)
  const index = desktops.findIndex(d => d.id === active.id)

  function settle(from: number) {
    animation.current?.cancel()
    animation.current = null
    track.current!.style.transform = ''
    offset.current = 0
    if (!from || reducedMotion()) {
      setPeer(null)
      return
    }
    const slide = track.current!.animate([
      { transform: 'translateX(' + from + 'px)' }, { transform: 'translateX(0)' },
    ], { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' })
    animation.current = slide
    slide.onfinish = () => {
      if (animation.current !== slide) return
      animation.current = null
      setPeer(null)
    }
  }

  // Rebase the track on the new active page, keeping the outgoing page at its
  // current pixel position on the first frame, including after a partial swipe.
  useLayoutEffect(() => {
    const old = previous.current
    previous.current = active
    if (active.id === old.id) return
    swipe.current = null
    const oldIndex = desktops.findIndex(d => d.id === old.id)
    if (oldIndex < 0) { settle(0); return }
    const direction = Math.sign(index - oldIndex)
    setPeer({ desktop: old, side: -direction })
    settle(direction * track.current!.clientWidth + offset.current)
  }, [active, desktops, index])

  useLayoutEffect(() => {
    if (blocked) {
      swipe.current = null
      settle(0)
    }
  }, [blocked])
  useLayoutEffect(() => () => animation.current?.cancel(), [])

  function cancel(e: PointerEvent) {
    if (swipe.current?.pointer !== e.pointerId) return
    swipe.current = null
    settle(offset.current)
  }

  return <div className="pager" onPointerDown={e => {
    if (blocked || animation.current || !e.isPrimary || e.button !== 0 || swipe.current) return
    if ((e.target as Element).closest('article,button,.moving')) return
    swipe.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, width: e.currentTarget.clientWidth }
    e.currentTarget.setPointerCapture(e.pointerId)
  }} onPointerMove={e => {
    const start = swipe.current
    if (!start || start.pointer !== e.pointerId) return
    const dx = e.clientX - start.x
    const side = dx < 0 ? 1 : -1
    const neighbor = desktops[index + side]
    const horizontal = Math.abs(dx) >= 1.5 * Math.abs(e.clientY - start.y)
    const distance = horizontal && neighbor && !reducedMotion()
      ? Math.sign(dx) * Math.min(Math.abs(dx), start.width) : 0
    if (distance && peer?.desktop.id !== neighbor.id) setPeer({ desktop: neighbor, side })
    offset.current = distance
    track.current!.style.transform = 'translateX(' + distance + 'px)'
  }} onPointerUp={e => {
    const start = swipe.current
    if (!start || start.pointer !== e.pointerId) return
    swipe.current = null
    const dx = e.clientX - start.x
    const neighbor = desktops[index + (dx < 0 ? 1 : -1)]
    if (!blocked && neighbor && Math.abs(dx) >= 60 && Math.abs(dx) >= 1.5 * Math.abs(e.clientY - start.y)) {
      select(neighbor.id)
    } else {
      settle(offset.current)
    }
  }} onPointerCancel={cancel} onLostPointerCapture={cancel}>
    <div className="page-track" ref={track}>
      {[{ desktop: active, side: 0 }, ...(peer && peer.desktop.id !== active.id ? [peer] : [])].map(page =>
        <section key={page.desktop.id} className={page.side ? 'page adjacent' : 'page'}
          style={page.side ? { left: page.side * 100 + '%' } : undefined}
          aria-label={page.desktop.name} inert={page.side !== 0}>
          {render(page.desktop, !page.side && !blocked)}
        </section>)}
    </div>
  </div>
}
