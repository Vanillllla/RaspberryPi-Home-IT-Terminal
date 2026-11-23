import { useEffect, useState } from 'react'
import { useTranslation, WidgetSwitch, type Plugin, type WidgetProps } from '@terminal/plugin'
import './wireguard.css'

interface Profile {
  id: string
  name: string
  target: string
  connected: boolean
  ping?: number | null
  error?: boolean
}

interface Schedule {
  automatic: boolean
  interval: number
}

const words = {
  ru: {
    empty: 'Добавьте конфигурацию в «Подробнее».', offline: 'Не подключено', timeout: 'Нет ответа',
    ms: 'мс', read: 'Не удалось получить состояние', load: 'Загрузка…', upload: 'Добавить файлы WireGuard (.conf)',
    remove: 'Удалить', working: 'Подождите…', failed: 'Не удалось выполнить запрос', gateway: 'Узел для проверки',
    unchecked: 'Не проверено', check: 'Проверить', checking: 'Проверка…', automatic: 'Автоматическая проверка пинга',
    interval: 'Интервал, секунд', save: 'Сохранить',
  },
  en: {
    empty: 'Add a configuration in Details.', offline: 'Disconnected', timeout: 'No reply',
    ms: 'ms', read: 'Could not read the status', load: 'Loading…', upload: 'Add WireGuard files (.conf)',
    remove: 'Remove', working: 'Please wait…', failed: 'Request failed', gateway: 'Ping target',
    unchecked: 'Not checked', check: 'Check', checking: 'Checking…', automatic: 'Automatic ping checks',
    interval: 'Interval, seconds', save: 'Save',
  },
}

function useProfiles(id: number, monitor: boolean) {
  const { language } = useTranslation()
  const copy = words[language]
  const path = '/api/plugins/wireguard/' + id
  const changed = 'wireguard-profiles-' + id
  const checkRequested = 'wireguard-check-' + id
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [checking, setChecking] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let active: AbortController | undefined
    let currentSchedule: Schedule | null = null
    let hasProfiles = false

    async function load(probe: boolean) {
      clearTimeout(timer)
      active?.abort()
      const controller = new AbortController()
      active = controller
      setChecking(probe)
      let checkImmediately = false
      try {
        const options = { signal: controller.signal, cache: 'no-store' as const, headers: { 'Accept-Language': language } }
        const [response, settings] = await Promise.all([
          fetch(path + '/profiles?probe=' + probe, options),
          probe ? null : fetch(path + '/schedule', options),
        ])
        if (!response.ok || (settings && !settings.ok)) throw Error()
        const list: Profile[] = await response.json()
        const nextSchedule: Schedule | null = settings ? await settings.json() : currentSchedule
        if (controller.signal.aborted) return
        if (settings) {
          currentSchedule = nextSchedule
          setSchedule(nextSchedule)
        }
        hasProfiles = list.length > 0
        checkImmediately = !probe && list.some(p => p.connected)
        setProfiles(previous => {
          if (probe) return list
          const last = new Map(previous?.map(p => [p.id, p]))
          return list.map(p => ({ ...p, ping: p.connected ? last.get(p.id)?.ping : undefined }))
        })
        setLoadError(false)
      } catch {
        if (!controller.signal.aborted) setLoadError(true)
      } finally {
        if (!controller.signal.aborted) {
          active = undefined
          setChecking(false)
          if (monitor && currentSchedule?.automatic && hasProfiles) {
            timer = setTimeout(check, checkImmediately ? 0 : currentSchedule.interval * 1000)
          }
        }
      }
    }

    function refresh() { void load(false) }
    function check() {
      if (!active && hasProfiles) void load(true)
    }
    refresh()
    window.addEventListener(changed, refresh)
    if (monitor) window.addEventListener(checkRequested, check)
    return () => {
      active?.abort()
      clearTimeout(timer)
      window.removeEventListener(changed, refresh)
      window.removeEventListener(checkRequested, check)
    }
  }, [path, changed, checkRequested, monitor, language])

  async function request(suffix: string, options: RequestInit) {
    const res = await fetch(path + suffix, {
      ...options, headers: { 'Accept-Language': language, ...options.headers },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(typeof data.detail === 'string' ? data.detail : copy.failed)
    }
  }

  async function update(task: () => Promise<void>) {
    setError('')
    setBusy(true)
    try {
      await task()
    } catch (e) {
      setError(e instanceof TypeError || !(e instanceof Error) ? copy.failed : e.message)
    } finally {
      window.dispatchEvent(new Event(changed))
      setBusy(false)
    }
  }
  return { copy, language, profiles, schedule, checking, busy, error: error || (loadError ? copy.read : ''), request, update,
    check: () => window.dispatchEvent(new Event(checkRequested)),
  }
}

function Widget({ instance }: WidgetProps) {
  const { copy, language, profiles, checking, check, busy, error, request, update } = useProfiles(instance.id, true)
  return <div className="wg-card">
    <div className="wg-results">
      {error && <p role="alert">{error}</p>}
      {!profiles && !error && <p>{copy.load}</p>}
      {profiles?.length === 0 && <p>{copy.empty}</p>}
      {profiles?.map(p => <fieldset key={p.id} className="wg-row" disabled={busy}>
        <WidgetSwitch label={p.name} checked={p.connected} onChange={on =>
          void update(() => request('/profiles/' + p.id + '/connection/' + (on ? 'up' : 'down'), { method: 'PUT' }))} />
        <span className="wg-status" data-reachable={p.connected && typeof p.ping === 'number'} title={copy.gateway + ' · ' + p.target}>
          {p.error ? copy.read : !p.connected ? copy.offline : p.ping === undefined ? copy.unchecked : p.ping === null ? copy.timeout :
            p.ping.toLocaleString(language, { maximumFractionDigits: 2 }) + ' ' + copy.ms}
        </span>
      </fieldset>)}
    </div>
    <button className="wg-check" type="button" disabled={busy || checking || !profiles?.length} onClick={check}>
      {checking ? copy.checking : copy.check}
    </button>
  </div>
}

function Details({ instance }: WidgetProps) {
  const { copy, profiles, schedule, busy, error, request, update } = useProfiles(instance.id, false)
  return <div className="wg-details">
    {schedule && <form key={schedule.automatic + ':' + schedule.interval} onSubmit={event => {
      event.preventDefault()
      const fields = new FormData(event.currentTarget)
      void update(() => request('/schedule', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automatic: fields.has('automatic'), interval: Number(fields.get('interval')) }),
      }))
    }}>
      <fieldset className="wg-schedule" disabled={busy}>
        <label><input type="checkbox" name="automatic" defaultChecked={schedule.automatic} />{copy.automatic}</label>
        <label>{copy.interval}<input type="number" name="interval" min={1} max={3600} required defaultValue={schedule.interval} /></label>
        <button type="submit">{copy.save}</button>
      </fieldset>
    </form>}
    <label>{copy.upload}
      <input type="file" multiple accept=".conf" disabled={busy} onChange={e => {
        const files = Array.from(e.currentTarget.files ?? [])
        e.currentTarget.value = ''
        void update(async () => {
          const failures: string[] = []
          for (const file of files) {
            try {
              const name = file.name.replace(/\.conf$/i, '')
              await request('/profiles?name=' + encodeURIComponent(name), {
                method: 'POST', headers: { 'Content-Type': 'application/x-wireguard' }, body: file,
              })
            } catch (err) {
              failures.push(file.name + ' — ' + (err instanceof Error && !(err instanceof TypeError) ? err.message : copy.failed))
            }
          }
          if (failures.length) throw new Error(failures.join('\n'))
        })
      }} />
    </label>
    {busy && <p role="status">{copy.working}</p>}
    {error && <p role="alert">{error}</p>}
    {profiles?.map(p => <div className="wg-row" key={p.id}>
      <div><strong>{p.name}</strong><small>{copy.gateway} · {p.target}</small></div>
      <button type="button" disabled={busy} aria-label={copy.remove + ' ' + p.name}
        onClick={() => void update(() => request('/profiles/' + p.id, { method: 'DELETE' }))}>{copy.remove}</button>
    </div>)}
  </div>
}

export default { Widget, Details } satisfies Plugin
