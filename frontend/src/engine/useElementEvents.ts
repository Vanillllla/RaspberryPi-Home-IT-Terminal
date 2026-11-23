import { useRef, useState } from 'react'
import type { Properties, Signal, Values } from './model'

type Input = { element: string; changes: Values }

/** Paint local input immediately and reconcile it with each server acknowledgement in order. */
export function useElementEvents(report: (message: string) => void) {
  const queues = useRef(new Map<number, Promise<void>>())
  const [pending, setPending] = useState<Record<number, Input[]>>({})

  function dispatch(id: number, event: Signal | undefined, submit: () => Promise<void>) {
    const input = event?.element && event.changes && Object.keys(event.changes).length
      ? { element: event.element, changes: event.changes } : null
    if (input) setPending(old => ({ ...old, [id]: [...(old[id] ?? []), input] }))

    const previous = queues.current.get(id) ?? Promise.resolve()
    const next = previous.then(submit).catch(error => {
      report(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (queues.current.get(id) === next) queues.current.delete(id)
      if (!input) return
      setPending(old => {
        const copy = { ...old }
        const remaining = old[id].filter(item => item !== input)
        if (remaining.length) copy[id] = remaining
        else delete copy[id]
        return copy
      })
    })
    queues.current.set(id, next)
  }

  function properties(id: number, confirmed: Properties): Properties {
    if (!pending[id]) return confirmed
    const current = { ...confirmed }
    for (const { element, changes } of pending[id]) {
      current[element] = { ...current[element], ...changes }
    }
    return current
  }

  return { dispatch, properties }
}
