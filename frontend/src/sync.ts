import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type State } from './api'

interface Change {
  kind: 'desktops' | 'widgets' | 'templates' | 'integrations' | 'plugin'
  id?: number | string
  plugin?: string
}

type Message = { type: 'ready'; revision: number }
  | { type: 'changes'; revision: number; changes: Change[] }

const eventName = 'dashboard-state-changes'

// A null batch means that a reconnect may have missed any kind of change.
export function onSharedChange(filter: Change, refresh: () => void) {
  const listener = (event: Event) => {
    const changes = (event as CustomEvent<Change[] | null>).detail
    if (!changes || changes.some(change => change.kind === filter.kind
      && (filter.plugin === undefined || change.plugin === filter.plugin)
      && (filter.id === undefined || change.id === undefined || change.id === filter.id))) refresh()
  }
  window.addEventListener(eventName, listener)
  return () => window.removeEventListener(eventName, listener)
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
  const templates = next.revision < previous.revision ? next.templates
    : shareRecords(previous.templates, next.templates, (a, b) => a.revision === b.revision)
  const plugins = shareRecords(previous.plugins, next.plugins)
  return { ...next, desktops, widgets, templates, plugins }
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
    let resync = false
    let forceRead = false
    const changes = new Map<string, Change>()

    function schedule(delay = 60) {
      if (batch !== undefined || disposed) return
      batch = window.setTimeout(() => {
        batch = undefined
        const reset = resync
        const events = [...changes.values()]
        resync = false
        changes.clear()
        if (reset || events.length) {
          window.dispatchEvent(new CustomEvent(eventName, { detail: reset ? null : events }))
        }
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
      current.onmessage = event => {
        if (disposed || current !== socket) return
        received = Date.now()
        const message: Message = JSON.parse(event.data)
        if (message.type === 'ready') {
          attempt = 0
          target = message.revision
          resync = true
          forceRead = true
        } else {
          for (const change of message.changes) {
            changes.set(JSON.stringify([change.kind, change.plugin, change.id]), change)
          }
          if (message.changes.some(change => ['desktops', 'widgets', 'templates'].includes(change.kind))) {
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
    const watchdog = window.setInterval(wake, 15_000)
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      disposed = true
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
