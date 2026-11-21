import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api, type Desktop, type State } from './api'
import { Builder } from './builder/Builder'
import { TemplateCard } from './builder/TemplateCard'
import type { Inputs, Outputs } from './builder/model'
import { DesktopPager } from './DesktopPager'
import { placementError } from './layout'
import { AlignmentSettings, contentAlignment } from './AlignmentSettings'
import { SizeSettings } from './SizeSettings'
import { Grid } from './Grid'
import { PluginView } from './PluginView'
import type { WidgetInstance } from './plugin'

function Modal({ title, close, children, pending = false }: { title: string; close: () => void; children: ReactNode; pending?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current!.showModal() }, [])
  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); if (!pending) close() }} aria-labelledby="dialog-title">
    <div className="modal-head"><h2 id="dialog-title">{title}</h2>
      <button disabled={pending} onClick={close} aria-label="Закрыть">×</button></div>
    {children}
  </dialog>
}

type Theme = 'light' | 'dark'
const themeKey = 'pi-terminal-theme'

type Panel = { mode: 'add' | 'panel-settings' | 'builder' } | { mode: 'delete-desktop'; selected: number | null } | { mode: 'actions' | 'Settings' | 'Details'; id: number }

export function App() {
  const [data, setData] = useState<State | null>(null)
  const [active, setActive] = useState(() => Number(sessionStorage.getItem('desktop')))
  const [panel, setPanel] = useState<Panel | null>(null)
  const [error, setError] = useState('')
  const [rows, setRows] = useState(1)
  const [busy, setBusy] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => {
    try { return localStorage.getItem(themeKey) === 'dark' ? 'dark' : 'light' }
    catch { return 'light' }
  })
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

  function chooseTheme(value: Theme) {
    setTheme(value)
    try { localStorage.setItem(themeKey, value) }
    catch { /* Keep the current selection when browser storage is unavailable. */ }
  }

  const lock = useRef(false)
  const reload = useCallback(async () => setData(await api<State>('state')), [])
  useEffect(() => { reload().catch(e => setError(e.message)) }, [reload])
  const desktop = data?.desktops.find(d => d.id === active) ?? data?.desktops[0]

  const catalogVersion = data?.templates?.reduce((sum, t) => sum + t.revision, 0)
  useEffect(() => {
    if (catalogVersion === undefined || panel?.mode === 'builder') return
    let disposed = false
    let checking = false
    async function check() {
      if (document.hidden || checking) return
      checking = true
      try {
        const version = await api<number>('templates/version')
        if (!disposed && version !== catalogVersion) await reload()
      } catch { /* Retry on the next tick when the server is available again. */ }
      finally { checking = false }
    }
    const timer = window.setInterval(check, 5000)
    document.addEventListener('visibilitychange', check)
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', check) }
  }, [catalogVersion, panel?.mode, reload])

  const activeButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const button = activeButton.current
    const nav = button?.parentElement
    if (!button || !nav) return
    const reveal = () => {
      const item = button.getBoundingClientRect()
      const bounds = nav.getBoundingClientRect()
      if (item.left < bounds.left) nav.scrollLeft += item.left - bounds.left
      else if (item.right > bounds.right) nav.scrollLeft += item.right - bounds.right
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [desktop?.id])

  function select(id: number) {
    setActive(id)
    sessionStorage.setItem('desktop', String(id))
  }
  const switchBy = useCallback((offset: number) => {
    if (!data || !desktop) return
    const index = data.desktops.indexOf(desktop) + offset
    if (data.desktops[index]) select(data.desktops[index].id)
  }, [data, desktop])
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (panel || !e.ctrlKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return
      e.preventDefault()
      switchBy(e.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [panel, switchBy])

  async function runMutation(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
      await reload().catch(() => {})
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  function mutate(action: () => Promise<unknown>) {
    return runMutation(async () => {
      await action()
      await reload()
    })
  }

  function removeDesktop(id: number) {
    return runMutation(async () => {
      const next = await api<State>('desktops/' + id, 'DELETE')
      const current = next.desktops.find(d => d.id === desktop?.id)
      const neighbor = next.desktops.find(d => d.id > id) ?? next.desktops[next.desktops.length - 1]
      select((current ?? neighbor).id)
      setData(next)
      setPanel(null)
    })
  }

  function view(widget: WidgetInstance, mode: 'Widget' | 'Details' | 'Settings') {
    const manifest = data?.plugins.find(p => p.id === widget.plugin_id)
    if (!manifest) return <p>Плагин недоступен. Размещение сохранено.</p>
    return <PluginView instance={widget} mode={mode} saveSettings={async settings => {
      await api('widgets/' + widget.id + '/settings', 'PUT', { settings })
      await reload()
    }} />
  }

  const patchRuntime = useCallback((id: number, revision: number, group: 'inputs' | 'outputs', values: Inputs | Outputs) => {
    setData(current => {
      const widget = current?.widgets.find(w => w.id === id)
      if (!current || !widget || !current.templates.some(t => t.id === widget.plugin_id && t.revision === revision)) return current
      const settings = { ...widget.settings, [group]: { ...(widget.settings[group] as object), ...values } }
      return { ...current, widgets: current.widgets.map(w => w.id === id ? { ...w, settings } : w) }
    })
  }, [])

  function renderCard(widget: WidgetInstance) {
    const capabilities = data?.plugins.find(p => p.id === widget.plugin_id)?.capabilities ?? []
    const template = data?.templates.find(t => t.id === widget.plugin_id)
    const alignment = contentAlignment(widget.appearance)
    return <div className="widget-content" data-horizontal={alignment.horizontalAlign} data-vertical={alignment.verticalAlign}>
      {template ? <TemplateCard key={template.revision} template={template} instance={widget}
        active={desktop?.id === widget.desktop_id && panel?.mode !== 'builder'} patch={patchRuntime} /> : view(widget, 'Widget')}
      {capabilities.includes('details') && <button onClick={() => setPanel({ mode: 'Details', id: widget.id })}>
        Подробнее
      </button>}
    </div>
  }

  const opened = panel && 'id' in panel && data?.widgets.find(w => w.id === panel.id)
  return <>
    <main>
      {error && panel?.mode !== 'add' && panel?.mode !== 'delete-desktop' && <p role="alert">{error} <button onClick={() => void mutate(async () => {})}>Обновить</button></p>}
      {desktop && data ? <>
        <div className="toolbar">
          <div className="desktop-navigation">
            <nav aria-label="Рабочие столы">
              {data.desktops.map(d => <button key={d.id} ref={desktop.id === d.id ? activeButton : undefined} aria-current={desktop.id === d.id ? 'page' : undefined}
                onClick={() => select(d.id)}>{d.name}</button>)}
            </nav>
            <button className="nav-action" aria-label="Создать рабочий стол" title="Создать рабочий стол"
              disabled={busy} onClick={() => void mutate(async () => {
                const next = await api<Desktop>('desktops', 'POST')
                select(next.id)
              })}>+</button>
            <button className="nav-action" aria-label="Удалить рабочий стол" title="Удалить рабочий стол"
              aria-haspopup="dialog" disabled={busy} onClick={() => { setError(''); setPanel({ mode: 'delete-desktop', selected: null }) }}>
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
              </svg>
            </button>
            <button className="nav-action" aria-label="Настройки панели" title="Настройки панели" aria-haspopup="dialog"
              onClick={() => setPanel({ mode: 'panel-settings' })}>
              <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
                <path d="M10 3h4l.6 2.5 1.6.9 2.4-.7 2 3.5-1.8 1.8v2l1.8 1.8-2 3.5-2.4-.7-1.6.9L14 21h-4l-.6-2.5-1.6-.9-2.4.7-2-3.5L5.2 13v-2L3.4 9.2l2-3.5 2.4.7 1.6-.9Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
          <h1>{desktop.name}</h1>
          <div className="widget-buttons">
            <button disabled={busy} onClick={() => setPanel({ mode: 'builder' })}>Создать виджет</button>
            <button className="primary add" onClick={() => setPanel({ mode: 'add' })}>+ Виджет</button>
          </div>
        </div>
        <DesktopPager desktops={data.desktops} active={desktop} select={select} blocked={panel !== null}
          render={(page, interactive) => (
            <Grid columns={data.columns} maxRows={data.max_rows} reportRows={page.id === desktop.id ? setRows : undefined} interactive={interactive && !busy} widgets={data.widgets.filter(w => w.desktop_id === page.id)}
              title={w => data.templates.find(t => t.id === w.plugin_id)?.name ?? data.plugins.find(p => p.id === w.plugin_id)?.name ?? w.plugin_id}
              openActions={id => setPanel({ mode: 'actions', id })}
              move={(id, slot, rows) => mutate(() => api('widgets/' + id + '/position', 'PUT', { slot, rows }))}
              render={renderCard} />
          )} />
      </> : !error && <p>Загрузка рабочего стола…</p>}
    </main>
    {panel?.mode === 'delete-desktop' && data && <Modal title="Удалить рабочий стол" pending={busy}
      close={() => { setError(''); setPanel(null) }}>
      <form onSubmit={e => {
        e.preventDefault()
        if (panel.selected !== null) void removeDesktop(panel.selected)
      }}>
        <fieldset className="desktop-options" disabled={busy}>
          <legend>Выберите рабочий стол</legend>
          {data.desktops.map(d => <label key={d.id}>
            <input type="radio" name="delete-desktop" checked={panel.selected === d.id}
              onChange={() => { setError(''); setPanel({ mode: 'delete-desktop', selected: d.id }) }} />
            {d.name}
          </label>)}
        </fieldset>
        <p>Виджеты выбранного стола будут удалены вместе с ним.</p>
        {data.desktops.length === 1 && <p>Вместо последнего стола появится пустой.</p>}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={() => { setError(''); setPanel(null) }}>Отмена</button>
          <button className="primary" disabled={busy || !data.desktops.some(d => d.id === panel.selected)}>ОК</button>
        </div>
      </form>
    </Modal>}
    {panel?.mode === 'panel-settings' && <Modal title="Настройки панели" close={() => setPanel(null)}>
      <fieldset className="theme-settings">
        <legend>Тема</legend>
        {(['light', 'dark'] as const).map(value => <label key={value}>
          <input type="radio" name="theme" checked={theme === value} onChange={() => chooseTheme(value)} />
          {value === 'light' ? 'Светлая' : 'Тёмная'}
        </label>)}
      </fieldset>
    </Modal>}
    {panel?.mode === 'builder' && data && <Modal title="Конструктор виджетов" pending={busy} close={() => setPanel(null)}>
      <Builder templates={data.templates} busy={busy} setBusy={setBusy} saved={async template => {
        try {
          await reload()
        } catch (e) {
          // The write already succeeded. Keep the saved template available if the refresh fails.
          setData(current => current && { ...current, templates: [...current.templates.filter(t => t.id !== template.id), template] })
          setError(e instanceof Error ? e.message : 'Не удалось обновить рабочий стол')
        }
        setPanel(null)
      }} />
    </Modal>}
    {panel?.mode === 'add' && data && desktop && <Modal title="Добавить виджет" close={() => { setError(''); setPanel(null) }}>
      {data.plugins.length === 0 && data.templates.length === 0 && <p>Доступных плагинов пока нет.</p>}
      {[...data.plugins, ...data.templates.map(t => ({ id: t.id, name: t.name, description: 'Пользовательский шаблон' }))].map(p => <button className="choice" key={p.id} disabled={busy}
        onClick={() => void mutate(async () => {
          await api('desktops/' + desktop.id + '/widgets', 'POST', { plugin_id: p.id, rows })
          setPanel(null)
        })}><strong>{p.name}</strong><small>{p.description}</small></button>)}
      {error && <p role="alert">{error}</p>}
    </Modal>}
    {opened && panel.mode === 'actions' && <Modal title="Действия с виджетом" close={() => setPanel(null)}>
      <button className="choice" onClick={() => setPanel({ mode: 'Settings', id: opened.id })}>Настройки</button>
      <button className="choice remove-widget" disabled={busy} onClick={() => void mutate(async () => {
        setPanel(null)
        await api('widgets/' + opened.id, 'DELETE')
      })}>Удалить виджет</button>
    </Modal>}
    {data && desktop && opened && panel.mode !== 'actions' && <Modal title={panel.mode === 'Settings' ? 'Настройки' : 'Подробнее'}
      close={() => setPanel(null)}>{panel.mode === 'Details' ? <div className="details-view">{view(opened, 'Details')}</div> : <>
        <SizeSettings key={opened.id} widget={opened} save={async (width, height) => {
          const reason = placementError(data.widgets.filter(w => w.desktop_id === opened.desktop_id),
            data.columns, rows, opened.id, opened.slot % data.columns,
            Math.floor(opened.slot / data.columns), width, height)
          if (reason) throw new Error(reason)
          await api('widgets/' + opened.id + '/size', 'PUT', { width, height, rows })
          await reload()
        }} />
        <AlignmentSettings key={'alignment-' + opened.id} appearance={opened.appearance} save={async (horizontalAlign, verticalAlign) => {
          await api('widgets/' + opened.id + '/alignment', 'PUT', { horizontalAlign, verticalAlign })
          await reload()
        }} />
        {data?.plugins.find(p => p.id === opened.plugin_id)?.capabilities.includes('settings') &&
          <section><h3>Настройки плагина</h3>{view(opened, 'Settings')}</section>}
      </>}</Modal>}
  </>
}
