import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type State } from './api'

interface Change { kind: 'desktops' | 'widgets' | 'projects'; id?: number | string }
type Message = { type: 'ready'; revision: number }
  | { type: 'changes'; revision: number; changes: Change[] }

const views = new Map<Element, number>()
const presenceEvent = 'widget-presence'
export function trackPresence(el: Element, id: number) {
  let active = true
  const observer = new IntersectionObserver(entries => {
    if (!active) return
    if (entries[entries.length - 1].isIntersecting) views.set(el, id)
    else views.delete(el)
    window.dispatchEvent(new Event(presenceEvent))
  })
  observer.observe(el)
  return () => { active = false; observer.disconnect(); views.delete(el); window.dispatchEvent(new Event(presenceEvent)) }
}

function shareRecords<T extends { id: number | string }>(previous: T[], next: T[],
  same = (a: T, b: T) => JSON.stringify(a) === JSON.stringify(b),
) {
  const byId = new Map(previous.map(item => [item.id, item]))
  const records = next.map(item => {
    const old = byId.get(item.id)
    return old && same(old, item) ? old : item
  })
  return previous.length === records.length && records.every((item, i) => item === previous[i]) ? previous : records
}

function reconcile(previous: State | null, next: State): State {
  if (!previous) return next
  const desktops = shareRecords(previous.desktops, next.desktops)
  const widgets = shareRecords(previous.widgets, next.widgets)
  const projects = shareRecords(previous.projects, next.projects, (a, b) => a.revision === b.revision)
  const elements = shareRecords(previous.elements, next.elements)
  return { ...next, desktops, widgets, projects, elements }
}

export function useSharedState() {
  const [data, setData] = useState<State | null>(null)
  const applied = useRef(-1)
  const pending = useRef<Promise<State> | null>(null)
  const queued = useRef(false)

  const reload = useCallback(() => {
    // A caller may have committed a write since the current GET started.
    if (pending.current) {
      queued.current = true
      return pending.current
    }
    async function read() {
      let next: State
      do {
        queued.current = false
        next = await api<State>('state')
        applied.current = next.revision
        const snapshot = next
        setData(previous => reconcile(previous, snapshot))
      } while (queued.current)
      return next
    }
    pending.current = read().finally(() => { pending.current = null })
    return pending.current
  }, [])

  useEffect(() => {
    let socket: WebSocket | undefined
    let disposed = false
    let retry: number
    let batch: number | undefined
    let attempt = 0
    let received = 0
    let target = -1
    let forceRead = false
    function presence() {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ visible: document.hidden ? [] : [...new Set(views.values())] }))
      }
    }

    function schedule(delay = 60) {
      if (batch !== undefined || disposed) return
      batch = window.setTimeout(() => {
        batch = undefined
        if (forceRead || target > applied.current) {
          forceRead = false
          void reload().catch(() => { forceRead = true; schedule(1000) })
        }
      }, delay)
    }

    function connect() {
      if (disposed) return
      const url = new URL('/api/events', location.href)
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const current = new WebSocket(url)
      socket = current
      received = Date.now()
      current.onopen = presence
      current.onmessage = event => {
        if (disposed || current !== socket) return
        received = Date.now()
        const message: Message = JSON.parse(event.data)
        if (message.type === 'ready') {
          attempt = 0
          target = message.revision
          forceRead = true
        } else {
          if (message.changes.length) {
            target = message.revision
          }
        }
        schedule()
      }
      current.onclose = () => {
        if (!disposed && current === socket) retry = window.setTimeout(connect, Math.min(10_000, 300 * 2 ** attempt++))
      }
    }

    function wake() {
      if (document.hidden || disposed) return
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        clearTimeout(retry)
        connect()
      } else if (Date.now() - received > 45_000) {
        const stale = socket
        socket = undefined
        stale.close()
        connect()
      }
    }

    connect()
    window.addEventListener(presenceEvent, presence)
    document.addEventListener('visibilitychange', presence)
    const watchdog = window.setInterval(wake, 15_000)
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      disposed = true
      window.removeEventListener(presenceEvent, presence)
      document.removeEventListener('visibilitychange', presence)
      socket?.close()
      clearTimeout(retry)
      clearTimeout(batch)
      clearInterval(watchdog)
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [reload])

  return { data, reload }
}
