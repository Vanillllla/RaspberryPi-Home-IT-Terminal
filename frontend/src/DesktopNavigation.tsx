import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Desktop } from './api'

interface Props {
  desktops: Desktop[]
  active: Desktop
  open: boolean
  error: string
  busy: boolean
  setOpen: (open: boolean) => void
  select: (id: number) => void
  create: () => void
  rename: () => void
  remove: () => void
}

export function DesktopNavigation({ desktops, active, open, busy, error, setOpen, select, create, rename, remove }: Props) {
  const tab = useRef<HTMLButtonElement>(null)
  const current = useRef<HTMLButtonElement>(null)
  const start = useRef<{ id: number; x: number; y: number } | null>(null)
  const moved = useRef(false)

  useLayoutEffect(() => {
    if (open) current.current?.focus()
  }, [open, active.id])

  useEffect(() => {
    if (!open) return
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        tab.current?.focus()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, setOpen])

  function close() {
    setOpen(false)
    tab.current?.focus()
  }

  return <div className="desktop-navigation">
    <button ref={tab} className="desktop-tab" aria-expanded={open} aria-controls="desktop-drawer"
      onPointerDown={e => {
        if (!e.isPrimary || e.button !== 0) return
        moved.current = false
        start.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={e => {
        const origin = start.current
        if (origin?.id !== e.pointerId) return
        const dx = e.clientX - origin.x
        const dy = e.clientY - origin.y
        if (Math.hypot(dx, dy) > 10) moved.current = true
        if (dy >= 32 && dy >= Math.abs(dx) * 1.5) {
          start.current = null
          setOpen(true)
        }
      }}
      onLostPointerCapture={() => { start.current = null }}
      onClick={e => {
        if (!e.detail || !moved.current) setOpen(!open)
      }}>
      Рабочие столы <span className="tab-chevron" aria-hidden="true" />
    </button>
    {open && <div className="drawer-backdrop" onClick={close} />}
    <nav id="desktop-drawer" aria-label="Рабочие столы" hidden={!open}>
      <div className="desktop-list">
        {desktops.map(d => <button key={d.id} ref={d.id === active.id ? current : undefined}
          aria-current={d.id === active.id ? 'page' : undefined}
          onClick={() => { select(d.id); close() }}>{d.name}</button>)}
      </div>
      <div className="desktop-actions">
        <button disabled={busy} onClick={create}>Создать рабочий стол</button>
        <button disabled={busy} onClick={rename} aria-haspopup="dialog">Переименовать</button>
        <button disabled={busy || desktops.length < 2} onClick={remove} aria-haspopup="dialog"
          title={desktops.length === 1 ? 'Последний рабочий стол удалить нельзя' : undefined}>Удалить рабочий стол</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </nav>
  </div>
}
