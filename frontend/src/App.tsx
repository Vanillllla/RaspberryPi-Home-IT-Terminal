import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api, type Desktop, type State } from './api'
import { DesktopPager } from './DesktopPager'
import { Grid } from './Grid'
import { PluginView } from './PluginView'
import type { WidgetInstance } from './plugin'

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current!.showModal() }, [])
  return <dialog ref={dialog} onCancel={close} aria-labelledby="dialog-title">
    <div className="modal-head"><h2 id="dialog-title">{title}</h2>
      <button onClick={close} aria-label="Закрыть">×</button></div>
    {children}
  </dialog>
}

type Panel = { mode: 'add' } | { mode: 'actions' | 'Settings' | 'Details'; id: number }

export function App() {
  const [data, setData] = useState<State | null>(null)
  const [active, setActive] = useState(() => Number(sessionStorage.getItem('desktop')))
  const [panel, setPanel] = useState<Panel | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const reload = useCallback(async () => setData(await api<State>('state')), [])
  useEffect(() => { reload().catch(e => setError(e.message)) }, [reload])
  const desktop = data?.desktops.find(d => d.id === active) ?? data?.desktops[0]

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

  async function mutate(action: () => Promise<unknown>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await action()
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
      await reload().catch(() => {})
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  function view(widget: WidgetInstance, mode: 'Widget' | 'Details' | 'Settings') {
    const manifest = data?.plugins.find(p => p.id === widget.plugin_id)
    if (!manifest) return <p>Плагин недоступен. Размещение сохранено.</p>
    return <PluginView instance={widget} mode={mode} saveSettings={async settings => {
      await api('widgets/' + widget.id + '/settings', 'PUT', { settings })
      await reload()
    }} />
  }

  function renderCard(widget: WidgetInstance) {
    const capabilities = data?.plugins.find(p => p.id === widget.plugin_id)?.capabilities ?? []
    return <>
      {view(widget, 'Widget')}
      {capabilities.includes('details') && <button onClick={() => setPanel({ mode: 'Details', id: widget.id })}>
        Подробнее
      </button>}
      <button className="widget-actions" aria-label="Действия с виджетом" aria-haspopup="dialog"
        title="Действия с виджетом" onClick={() => setPanel({ mode: 'actions', id: widget.id })}>⋯</button>
    </>
  }

  const opened = panel && panel.mode !== 'add' && data?.widgets.find(w => w.id === panel.id)
  return <>
    <header><span aria-hidden="true">&gt;_</span> Pi Terminal</header>
    <main>
      {error && <p role="alert">{error} <button onClick={() => void mutate(async () => {})}>Обновить</button></p>}
      {desktop && data ? <>
        <div className="toolbar">
          <nav aria-label="Рабочие столы">
            {data.desktops.map(d => <button key={d.id} ref={desktop.id === d.id ? activeButton : undefined} aria-current={desktop.id === d.id ? 'page' : undefined}
              onClick={() => select(d.id)}>{d.name}</button>)}
            <button disabled={busy} onClick={() => void mutate(async () => {
              const next = await api<Desktop>('desktops', 'POST')
              select(next.id)
            })}>+ Новый стол</button>
          </nav>
          <h1>{desktop.name}</h1>
          <button className="primary add" onClick={() => setPanel({ mode: 'add' })}>+ Виджет</button>
        </div>
        <DesktopPager desktops={data.desktops} active={desktop} select={select} blocked={panel !== null}
          render={(page, interactive) => (
            <Grid interactive={interactive && !busy} widgets={data.widgets.filter(w => w.desktop_id === page.id)}
              title={w => data.plugins.find(p => p.id === w.plugin_id)?.name ?? w.plugin_id}
              move={(id, slot) => void mutate(() => api('widgets/' + id + '/position', 'PUT', { slot }))}
              render={renderCard} />
          )} />
      </> : !error && <p>Загрузка рабочего стола…</p>}
    </main>
    {panel?.mode === 'add' && data && desktop && <Modal title="Добавить виджет" close={() => setPanel(null)}>
      {data.plugins.length === 0 && <p>Доступных плагинов пока нет.</p>}
      {data.plugins.map(p => <button className="choice" key={p.id} disabled={busy}
        onClick={() => void mutate(async () => {
          await api('desktops/' + desktop.id + '/widgets', 'POST', { plugin_id: p.id })
          setPanel(null)
        })}><strong>{p.name}</strong><small>{p.description}</small></button>)}
      {error && <p role="alert">{error}</p>}
    </Modal>}
    {opened && panel.mode === 'actions' && <Modal title="Действия с виджетом" close={() => setPanel(null)}>
      {data?.plugins.find(p => p.id === opened.plugin_id)?.capabilities.includes('settings') &&
        <button className="choice" onClick={() => setPanel({ mode: 'Settings', id: opened.id })}>Настройки</button>}
      <button className="choice remove-widget" disabled={busy} onClick={() => void mutate(async () => {
        setPanel(null)
        await api('widgets/' + opened.id, 'DELETE')
      })}>Удалить виджет</button>
    </Modal>}
    {opened && panel.mode !== 'actions' && <Modal title={panel.mode === 'Settings' ? 'Настройки' : 'Подробнее'}
      close={() => setPanel(null)}><div className={panel.mode === 'Details' ? 'details-view' : undefined}>{view(opened, panel.mode)}</div></Modal>}
  </>
}
