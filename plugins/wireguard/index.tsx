import { useEffect, useState } from 'react'
import { useTranslation, WidgetSwitch, type Plugin, type WidgetProps } from '@terminal/plugin'
import './wireguard.css'

interface Profile {
  id: string
  name: string
  target: string
  connected: boolean
  ping: number | null
  error?: boolean
}

const words = {
  ru: {
    empty: 'Добавьте конфигурацию в «Подробнее».', offline: 'Не подключено', timeout: 'Нет ответа',
    ms: 'мс', read: 'Не удалось получить состояние', load: 'Загрузка…', upload: 'Добавить файлы WireGuard (.conf)',
    remove: 'Удалить', working: 'Подождите…', failed: 'Не удалось выполнить запрос', gateway: 'Узел для проверки',
  },
  en: {
    empty: 'Add a configuration in Details.', offline: 'Disconnected', timeout: 'No reply',
    ms: 'ms', read: 'Could not read the status', load: 'Loading…', upload: 'Add WireGuard files (.conf)',
    remove: 'Remove', working: 'Please wait…', failed: 'Request failed', gateway: 'Ping target',
  },
}

function useProfiles(id: number, poll: boolean) {
  const { language } = useTranslation()
  const copy = words[language]
  const path = '/api/plugins/wireguard/' + id + '/profiles'
  const changed = 'wireguard-profiles-' + id
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let active: AbortController | undefined
    function load() {
      clearTimeout(timer)
      active?.abort()
      const controller = new AbortController()
      active = controller
      void (async () => {
        try {
          const res = await fetch(path, { signal: controller.signal, headers: { 'Accept-Language': language } })
          if (!res.ok) throw Error()
          const list: Profile[] = await res.json()
          if (!controller.signal.aborted) {
            setProfiles(list)
            setLoadError(false)
          }
        } catch {
          if (!controller.signal.aborted) setLoadError(true)
        } finally {
          if (poll && !controller.signal.aborted) timer = setTimeout(load, 5000)
        }
      })()
    }
    load()
    window.addEventListener(changed, load)
    return () => {
      active?.abort()
      clearTimeout(timer)
      window.removeEventListener(changed, load)
    }
  }, [path, changed, poll, language])

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
  return { copy, language, profiles, busy, error: error || (loadError ? copy.read : ''), request, update }
}

function Widget({ instance }: WidgetProps) {
  const { copy, language, profiles, busy, error, request, update } = useProfiles(instance.id, true)
  return <div className="wg-card">
    {error && <p role="alert">{error}</p>}
    {!profiles && !error && <p>{copy.load}</p>}
    {profiles?.length === 0 && <p>{copy.empty}</p>}
    {profiles?.map(p => <fieldset key={p.id} className="wg-row" disabled={busy}>
      <WidgetSwitch label={p.name} checked={p.connected} onChange={on =>
        void update(() => request('/' + p.id + '/connection/' + (on ? 'up' : 'down'), { method: 'PUT' }))} />
      <span className="wg-status" data-reachable={p.connected && p.ping !== null} title={copy.gateway + ' · ' + p.target}>
        {p.error ? copy.read : !p.connected ? copy.offline : p.ping === null ? copy.timeout :
          p.ping.toLocaleString(language, { maximumFractionDigits: 2 }) + ' ' + copy.ms}
      </span>
    </fieldset>)}
  </div>
}

function Details({ instance }: WidgetProps) {
  const { copy, profiles, busy, error, request, update } = useProfiles(instance.id, false)
  return <div className="wg-details">
    <label>{copy.upload}
      <input type="file" multiple accept=".conf" disabled={busy} onChange={e => {
        const files = Array.from(e.currentTarget.files ?? [])
        e.currentTarget.value = ''
        void update(async () => {
          const failures: string[] = []
          for (const file of files) {
            try {
              const name = file.name.replace(/\.conf$/i, '')
              await request('?name=' + encodeURIComponent(name), {
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
        onClick={() => void update(() => request('/' + p.id, { method: 'DELETE' }))}>{copy.remove}</button>
    </div>)}
  </div>
}

export default { Widget, Details } satisfies Plugin
