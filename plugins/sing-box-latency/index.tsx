import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation, type Plugin, type WidgetProps } from '@terminal/plugin'
import './widget.css'

const messages = {
  ru: {
    empty: 'Добавьте профиль в меню «Подробнее».',
    checking: 'Проверка…', check: 'Проверить', unchecked: 'Нет замера',
    automatic: 'Автопроверка', interval: 'Интервал проверки, с', loadError: 'Не удалось загрузить профили.',
    disconnected: 'Нет соединения',
    heading: 'Профили sing-box',
    name: 'Название профиля',
    json: 'JSON-конфиг', link: 'Ссылка Hysteria 2', port: 'Локальный порт',
    source: 'Источник профиля', loaded: 'Источник сохранён', large: 'Файл должен быть меньше 250 КиБ.',
    add: 'Добавить профиль',
    remove: 'Удалить профиль',
    save: 'Сохранить профили',
    saving: 'Сохранение…',
    saved: 'Профили сохранены.',
    invalid: 'Укажите название и выберите источник для каждого профиля.',
    error: 'Не удалось сохранить профили.',
  },
  en: {
    empty: 'Add a profile in Details.',
    checking: 'Checking…', check: 'Check', unchecked: 'Not checked',
    automatic: 'Automatic checks', interval: 'Check interval, s', loadError: 'Could not load profiles.',
    disconnected: 'No connection',
    heading: 'sing-box profiles',
    name: 'Profile name',
    json: 'JSON configuration', link: 'Hysteria 2 link', port: 'Local port',
    source: 'Profile source', loaded: 'Source saved', large: 'The file must be smaller than 250 KiB.',
    add: 'Add profile',
    remove: 'Remove profile',
    save: 'Save profiles',
    saving: 'Saving…',
    saved: 'Profiles saved.',
    invalid: 'Enter a name and choose a source for each profile.',
    error: 'Could not save profiles.',
  },
}

interface Profile { id: string; name: string; kind: 'port' | 'json' | 'link' }
interface Result extends Profile { delay?: number | null }
interface Schedule { automatic: boolean; interval: number }
interface ProfileSettings { profiles: Profile[]; schedule: Schedule }
interface Draft { key: number; id?: string; name: string; kind: Profile['kind']; file?: File; link?: string }
const updateEvent = 'sing-box-latency-profiles'
const pluginPath = (id: number) => '/api/plugins/sing-box-latency/' + id

function Widget({ instance }: WidgetProps) {
  const { language } = useTranslation()
  const strings = messages[language]
  const [results, setResults] = useState<Result[] | null>(null)
  const milliseconds = new Intl.NumberFormat(language, {
    style: 'unit', unit: 'millisecond', maximumFractionDigits: 0,
  })

  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)
  const manual = useRef<() => void>(() => {})
  useEffect(() => {
    let timer: number
    let request: AbortController | undefined
    let active = true
    let settings: ProfileSettings | undefined
    const controller = new AbortController()

    function schedule() {
      window.clearTimeout(timer)
      if (settings?.schedule.automatic && settings.profiles.length) {
        timer = window.setTimeout(() => {
          if (document.hidden) schedule()
          else void refresh()
        }, settings.schedule.interval * 1000)
      }
    }

    async function refresh() {
      if (!settings?.profiles.length || request) return
      window.clearTimeout(timer)
      const current = new AbortController()
      request = current
      setChecking(true)
      try {
        const response = await fetch(pluginPath(instance.id) + '/latency', { cache: 'no-store', signal: current.signal })
        if (!response.ok) throw new Error()
        const next: Result[] = await response.json()
        if (active && request === current) setResults(next)
      } catch {
        if (active && request === current) setResults(old => old?.map(row => ({ ...row, delay: null })) ?? [])
      } finally {
        if (active && request === current) {
          request = undefined
          setChecking(false)
          schedule()
        }
      }
    }

    function apply(next: ProfileSettings) {
      request?.abort()
      request = undefined
      settings = next
      setFailed(false)
      setChecking(false)
      setResults(old => next.profiles.map(profile => ({ ...profile, delay: old?.find(row => row.id === profile.id)?.delay })))
      if (next.schedule.automatic && !document.hidden) void refresh()
      schedule()
    }

    function onSaved(event: Event) {
      const { id, settings } = (event as CustomEvent<{ id: number; settings: ProfileSettings }>).detail
      if (id === instance.id) {
        controller.abort()
        apply(settings)
      }
    }

    async function load() {
      try {
        const response = await fetch(pluginPath(instance.id) + '/profiles', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error()
        const next: ProfileSettings = await response.json()
        if (active && !controller.signal.aborted) apply(next)
      } catch {
        if (active && !controller.signal.aborted) setFailed(true)
      }
    }
    manual.current = () => { void refresh() }
    void load()
    window.addEventListener(updateEvent, onSaved)
    return () => {
      active = false
      controller.abort()
      request?.abort()
      window.clearTimeout(timer)
      window.removeEventListener(updateEvent, onSaved)
    }
  }, [instance.id])

  return <div className="sing-box-latency-card">
    {results?.length ? <ul className="sing-box-latency-rows" aria-live="polite">
      {results.map(profile => <li key={profile.id}><strong>{profile.name}</strong>
        <span className="widget-status" data-color={profile.delay === undefined ? undefined : profile.delay === null ? 'red' : 'green'}>
          {profile.delay === undefined ? strings.unchecked : profile.delay === null ? strings.disconnected : milliseconds.format(profile.delay)}
        </span>
      </li>)}
    </ul> : <p className="sing-box-latency-empty">{failed ? strings.loadError : results ? strings.empty : strings.checking}</p>}
    <button className="sing-box-latency-check" disabled={checking || !results?.length} onClick={() => manual.current()}>
      {checking ? strings.checking : strings.check}
    </button>
  </div>
}

function Details({ instance }: WidgetProps) {
  const { language } = useTranslation()
  const strings = messages[language]
  const [draft, setDraft] = useState<Draft[]>([])
  const [nextKey, setNextKey] = useState(0)
  const [status, setStatus] = useState<'' | 'saved' | 'invalid' | 'large' | 'error'>('')
  const [pending, setPending] = useState(true)
  const [ready, setReady] = useState(false)
  const [serverError, setServerError] = useState('')
  const [automatic, setAutomatic] = useState(true)
  const [interval, setIntervalSeconds] = useState('30')

  function reset({ profiles, schedule }: ProfileSettings) {
    setAutomatic(schedule.automatic)
    setIntervalSeconds(String(schedule.interval))
    setDraft(profiles.map((profile, key) => ({ ...profile, key })))
    setNextKey(profiles.length)
  }

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch(pluginPath(instance.id) + '/profiles', { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error()
        const settings: ProfileSettings = await response.json()
        if (!controller.signal.aborted) {
          reset(settings)
          setReady(true)
        }
      } catch {
        if (!controller.signal.aborted) setStatus('error')
      } finally {
        if (!controller.signal.aborted) setPending(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [instance.id])

  function update(key: number, delta: Partial<Draft>) {
    setStatus('')
    setServerError('')
    setDraft(rows => rows.map(row => row.key === key ? { ...row, ...delta } : row))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending || !ready) return
    setServerError('')
    if (draft.some(row => !row.name.trim() || !(row.id || row.file || row.link?.trim()))) {
      setStatus('invalid')
      return
    }
    if (draft.some(row => (row.file?.size ?? 0) > 250 * 1024)) {
      setStatus('large')
      return
    }
    setPending(true)
    setStatus('')
    try {
      const profiles = await Promise.all(draft.map(async row => ({
        id: row.id, name: row.name.trim(), config: await row.file?.text(), link: row.link?.trim() || undefined,
      })))
      const response = await fetch(pluginPath(instance.id) + '/profiles', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({ profiles, schedule: { automatic, interval: Number(interval) } }),
      })
      if (!response.ok) {
        const problem = await response.json()
        if (typeof problem.detail === 'string') setServerError(problem.detail)
        else setStatus('error')
        return
      }
      const settings: ProfileSettings = await response.json()
      reset(settings)
      setStatus('saved')
      window.dispatchEvent(new CustomEvent(updateEvent, { detail: { id: instance.id, settings } }))
    } catch {
      setStatus('error')
    } finally {
      setPending(false)
    }
  }

  return <form className="sing-box-latency-form" onSubmit={submit}>
    <h3>{strings.heading}</h3>
    <fieldset disabled={pending || !ready} aria-label={strings.heading}>
      <div className="sing-box-latency-schedule">
        <label><input type="checkbox" checked={automatic} onChange={e => { setAutomatic(e.target.checked); setStatus('') }} />{strings.automatic}</label>
        <label>{strings.interval}<input type="number" min={1} max={3600} step={1} required
          value={interval} onChange={e => { setIntervalSeconds(e.target.value); setStatus('') }} /></label>
      </div>
      {draft.map((profile, i) => <div className="sing-box-latency-profile" key={profile.key}>
        <label>{strings.name}<input value={profile.name} maxLength={100}
          aria-label={strings.name + ' ' + (i + 1)} onChange={e => update(profile.key, { name: e.target.value })} /></label>
        <select aria-label={strings.source + ' ' + (i + 1)} value={profile.kind} onChange={e =>
          update(profile.key, { kind: e.target.value as Draft['kind'], id: undefined, file: undefined, link: undefined })}>
          {profile.kind === 'port' && <option value="port">{strings.port}</option>}
          <option value="json">{strings.json}</option>
          <option value="link">{strings.link}</option>
        </select>
        {profile.kind === 'json' && <label>{strings.json}<input key={profile.id ?? 'new'} type="file" accept=".json,application/json"
          onChange={e => update(profile.key, { file: e.target.files?.[0] })} /></label>}
        {profile.kind === 'link' && <label>{strings.link}<input type="password" autoComplete="off" maxLength={4096}
          placeholder="hysteria2://…" value={profile.link ?? ''} onChange={e => update(profile.key, { link: e.target.value })} /></label>}
        {profile.id && <small>{strings.loaded}</small>}
        <button type="button" aria-label={strings.remove + ' ' + (i + 1)} onClick={() => {
          setStatus('')
          setServerError('')
          setDraft(rows => rows.filter(row => row.key !== profile.key))
        }}>{strings.remove}</button>
      </div>)}
      <div className="sing-box-latency-controls">
        <button type="button" disabled={draft.length >= 8} onClick={() => {
          setStatus('')
          setDraft(rows => [...rows, { key: nextKey, name: '', kind: 'json' }])
          setNextKey(nextKey + 1)
        }}>{strings.add}</button>
        <button className="primary" type="submit">{pending ? strings.saving : strings.save}</button>
      </div>
    </fieldset>
    {serverError && <p role="alert">{serverError}</p>}
    {status && <p role={status === 'saved' ? 'status' : 'alert'}>{strings[status]}</p>}
  </form>
}

export default { Widget, Details } satisfies Plugin
