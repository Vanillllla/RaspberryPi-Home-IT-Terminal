import { desktopName, pluginText, useTranslation } from './i18n'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api, type Desktop } from './api'
import { useSharedState } from './sync'
import { Builder } from './builder/Builder'
import { TemplateCard } from './builder/TemplateCard'
import { DesktopNavigation } from './DesktopNavigation'
import { DesktopPager } from './DesktopPager'
import { cardAppearance } from './appearance'
import { InstanceSettings } from './InstanceSettings'
import { Grid } from './Grid'
import { PluginView } from './PluginView'
import type { WidgetInstance } from './plugin'

function Modal({ title, close, children, pending = false }: { title: string; close: () => void; children: ReactNode; pending?: boolean }) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current!.showModal() }, [])
  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); if (!pending) close() }} aria-labelledby="dialog-title">
    <div className="modal-head"><h2 id="dialog-title">{title}</h2>
      <button disabled={pending} onClick={close} aria-label={t('Закрыть')}>×</button></div>
    {children}
  </dialog>
}

type Theme = 'light' | 'dark'
const themeKey = 'pi-terminal-theme'

type Panel =
  | { mode: 'desktops' | 'reorder-desktops' | 'add' | 'panel-settings' | 'builder' }
  | { mode: 'rename-desktop'; selected: number; name: string; expected: string }
  | { mode: 'delete-desktop'; selected: number | null }
  | { mode: 'actions' | 'Settings' | 'Details'; id: number }

export function App() {
  const { t, language, chooseLanguage } = useTranslation()
  const { data, reload } = useSharedState()
  const [active, setActive] = useState(() => Number(sessionStorage.getItem('desktop')))
  const [panel, setPanel] = useState<Panel | null>(null)
  const [error, setError] = useState('')
  const [initialError, setInitialError] = useState('')
  const [cellSize, setCellSize] = useState(80)
  const [rows, setRows] = useState(1)
  const [transfer, setTransfer] = useState<{ id: number; desktop_id: number; slot: number } | null>(null)
  const [busy, setBusy] = useState(false)
  // A reset belongs to the widget instance, even when its desktop is temporarily unmounted.
  const [resetTimers] = useState(() => new Map<string, number>())
  const [inputWrites] = useState(() => new Map<number, Promise<void>>())
  useEffect(() => () => {
    resetTimers.forEach(timer => window.clearTimeout(timer))
    resetTimers.clear()
  }, [resetTimers])
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
  useEffect(() => { reload().catch(e => setInitialError(e.message)) }, [reload])
  const desktop = data?.desktops.find(d => d.id === active) ?? data?.desktops[0]

  useEffect(() => {
    if (!data || !desktop) return
    if (!data.desktops.some(d => d.id === active)) select(desktop.id)
    if (panel && 'id' in panel && !data.widgets.some(w => w.id === panel.id)) setPanel(null)
  }, [active, data, desktop, panel])

  const drawerOpen = panel?.mode === 'desktops'
  const setDrawerOpen = useCallback((open: boolean) => {
    setError('')
    setPanel(open ? { mode: 'desktops' } : null)
  }, [])

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
      if (e.target instanceof HTMLInputElement) return
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
      setError(e instanceof Error ? e.message : t('Ошибка сохранения'))
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

  function moveWidget(widget: WidgetInstance, slot: number, rows: number, destination: number) {
    return runMutation(async () => {
      const { id, desktop_id, width, height, slot: originalSlot } = widget
      const placement = { id, slot, desktop_id: destination }
      const crossing = desktop?.id !== destination
      if (crossing) {
        setTransfer(placement)
        select(destination)
      }
      try {
        await api('widgets/' + id + '/position', 'PUT', { slot, rows, desktop_id: destination,
          expected: { desktop_id, slot: originalSlot, width, height } })
        await reload()
      } finally {
        setTransfer(null)
      }
    })
  }

  function removeDesktop(id: number) {
    return runMutation(async () => {
      await api('desktops/' + id, 'DELETE')
      const next = await reload()
      const current = next.desktops.find(d => d.id === desktop?.id)
      const index = data?.desktops.findIndex(d => d.id === id) ?? 0
      const neighbor = next.desktops[index] ?? next.desktops[next.desktops.length - 1]
      select((current ?? neighbor).id)
      setPanel(null)
    })
  }

  function view(widget: WidgetInstance, mode: 'Widget' | 'Details') {
    const manifest = data?.plugins.find(p => p.id === widget.plugin_id)
    if (!manifest) return <p>{widget.plugin_id.startsWith('template:') ? t('Шаблон недоступен.') : t('Плагин недоступен.')} {t('Размещение сохранено.')}</p>
    return <PluginView instance={widget} mode={mode} saveSettings={async settings => {
      await api('widgets/' + widget.id + '/settings', 'PUT', { settings })
      await reload()
    }} />
  }

  function renderCard(widget: WidgetInstance) {
    const capabilities = data?.plugins.find(p => p.id === widget.plugin_id)?.capabilities ?? []
    const template = data?.templates.find(t => t.id === widget.plugin_id)
    const alignment = cardAppearance(widget.appearance)
    return <div className="widget-content" data-horizontal={alignment.horizontalAlign} data-vertical={alignment.verticalAlign}>
      {template ? <TemplateCard key={template.revision} template={template} instance={widget}
        resetTimers={resetTimers} inputWrites={inputWrites}
        active={desktop?.id === widget.desktop_id && panel?.mode !== 'builder'} reload={reload} /> : view(widget, 'Widget')}
      {capabilities.includes('details') && <button onClick={() => setPanel({ mode: 'Details', id: widget.id })}>
        {t('Подробнее')}
      </button>}
    </div>
  }

  const localizedPlugins = data?.plugins.map(plugin => pluginText(plugin, language)) ?? []
  function defaultTitle(w: WidgetInstance) {
    return data?.templates.find(t => t.id === w.plugin_id)?.name
      ?? localizedPlugins.find(p => p.id === w.plugin_id)?.name ?? w.plugin_id
  }
  const opened = panel && 'id' in panel && data?.widgets.find(w => w.id === panel.id)
  return <>
    <main>
      {error && !drawerOpen && panel?.mode !== 'reorder-desktops' && panel?.mode !== 'rename-desktop' && panel?.mode !== 'add' && panel?.mode !== 'delete-desktop' && <p role="alert">{error} <button onClick={() => void mutate(async () => {})}>{t('Обновить')}</button></p>}
      {desktop && data ? <>
        <div className="toolbar">
          <DesktopNavigation desktops={data.desktops} active={desktop} open={drawerOpen} busy={busy}
            setOpen={setDrawerOpen} select={select} error={error}
            create={() => void runMutation(async () => {
              const next = await api<Desktop>('desktops', 'POST')
              await reload()
              select(next.id)
            })}
            rename={() => { setError(''); setPanel({ mode: 'rename-desktop', selected: desktop.id, name: desktopName(desktop, t), expected: desktop.name }) }}
            reorder={() => { setError(''); select(desktop.id); setPanel({ mode: 'reorder-desktops' }) }}
            remove={() => { setError(''); setPanel({ mode: 'delete-desktop', selected: null }) }} />
          <button className="nav-action" inert={drawerOpen} aria-label={t('Настройки панели')} title={t('Настройки панели')} aria-haspopup="dialog"
            onClick={() => setPanel({ mode: 'panel-settings' })}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
              <path d="M10 3h4l.6 2.5 1.6.9 2.4-.7 2 3.5-1.8 1.8v2l1.8 1.8-2 3.5-2.4-.7-1.6.9L14 21h-4l-.6-2.5-1.6-.9-2.4.7-2-3.5L5.2 13v-2L3.4 9.2l2-3.5 2.4.7 1.6-.9Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <h1 title={desktopName(desktop, t)}>{desktopName(desktop, t)}</h1>
          <div className="widget-buttons" inert={drawerOpen}>
            <button disabled={busy} onClick={() => setPanel({ mode: 'builder' })}>{t('Создать виджет')}</button>
            <button className="primary add" onClick={() => setPanel({ mode: 'add' })}>{t('+ Виджет')}</button>
          </div>
        </div>
        <DesktopPager desktops={data.desktops} active={desktop} select={select} blocked={panel !== null} animateNavigation={transfer?.desktop_id !== desktop.id}
          render={(page, interactive) => (
            <Grid reportCellSize={page.id === desktop.id ? setCellSize : undefined} columns={data.columns} maxRows={data.max_rows} reportRows={page.id === desktop.id ? setRows : undefined} interactive={interactive && !busy} widgets={transfer ? data.widgets.map(w => w.id === transfer.id ? { ...w, ...transfer } : w) : data.widgets}
              desktop={page} desktops={data.desktops}
              title={w => cardAppearance(w.appearance).customTitle || defaultTitle(w)}
              openActions={id => setPanel({ mode: 'actions', id })}
              move={moveWidget}
              render={renderCard} />
          )} />
      </> : initialError
        ? <p role="alert">{initialError} <button onClick={() => void mutate(async () => {})}>{t('Обновить')}</button></p>
        : <p>{t('Загрузка рабочего стола…')}</p>}
    </main>
    {panel?.mode === 'reorder-desktops' && data && <Modal title={t('Порядок рабочих столов')} pending={busy}
      close={() => setDrawerOpen(true)}>
      <ol className="desktop-order">
        {data.desktops.map((d, index) => <li key={d.id}>
          <span>{desktopName(d, t)}</span>
          {([-1, 1] as const).map(offset => {
            const neighbor = data.desktops[index + offset]
            const label = t(offset < 0 ? 'Переместить «{name}» выше' : 'Переместить «{name}» ниже', { name: desktopName(d, t) })
            return <button key={offset} aria-label={label} title={label} aria-disabled={busy || !neighbor}
              onClick={() => {
                if (busy || !neighbor) return
                const [first, second] = offset < 0 ? [neighbor.id, d.id] : [d.id, neighbor.id]
                void mutate(() => api('desktops/swap', 'POST', { first, second }))
              }}>{offset < 0 ? '↑' : '↓'}</button>
          })}
        </li>)}
      </ol>
      {error && <p role="alert">{error}</p>}
    </Modal>}
    {panel?.mode === 'rename-desktop' && data && <Modal title={t('Переименовать рабочий стол')} pending={busy}
      close={() => setDrawerOpen(true)}>
      <form className="rename-desktop" onSubmit={e => {
        e.preventDefault()
        const name = panel.name.trim()
        if (!data.desktops.some(d => d.id === panel.selected)) return
        if (!name) { setError(t('Введите название рабочего стола')); return }
        void runMutation(async () => {
          await api('desktops/' + panel.selected + '/name', 'PUT', { name, expected: panel.expected })
          await reload()
          setDrawerOpen(true)
        })
      }}>
        <div className="rename-field">
          <label htmlFor="rename-target">{t('Рабочий стол')}</label>
          <select id="rename-target" disabled={busy} value={data.desktops.some(d => d.id === panel.selected) ? panel.selected : ''} onChange={e => {
            const selected = data.desktops.find(d => d.id === Number(e.target.value))!
            setError('')
            setPanel({ mode: 'rename-desktop', selected: selected.id, name: desktopName(selected, t), expected: selected.name })
          }}>
            {!data.desktops.some(d => d.id === panel.selected) && <option value="" disabled>{t('Рабочий стол удалён')}</option>}
            {data.desktops.map(d => <option key={d.id} value={d.id}>{desktopName(d, t)}</option>)}
          </select>
        </div>
        <label>{t('Название')}
          <input disabled={busy} value={panel.name} onChange={e => { setError(''); setPanel({ ...panel, name: e.target.value }) }} />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          {error && data.desktops.some(d => d.id === panel.selected) && <button type="button" disabled={busy}
            onClick={() => void runMutation(async () => {
              const next = (await reload()).desktops.find(d => d.id === panel.selected)
              if (next) setPanel({ ...panel, name: desktopName(next, t), expected: next.name })
            })}>{t('Загрузить актуальные данные')}</button>}
          <button type="button" disabled={busy} onClick={() => setDrawerOpen(true)}>{t('Отмена')}</button>
          <button className="primary" disabled={busy || !data.desktops.some(d => d.id === panel.selected)}>{t('Сохранить')}</button>
        </div>
      </form>
    </Modal>}
    {panel?.mode === 'delete-desktop' && data && <Modal title={t('Удалить рабочий стол')} pending={busy}
      close={() => setDrawerOpen(true)}>
      <form onSubmit={e => {
        e.preventDefault()
        if (panel.selected !== null) void removeDesktop(panel.selected)
      }}>
        <fieldset className="desktop-options" disabled={busy}>
          <legend>{t('Выберите рабочий стол')}</legend>
          {data.desktops.map(d => <label key={d.id}>
            <input type="radio" name="delete-desktop" checked={panel.selected === d.id}
              onChange={() => { setError(''); setPanel({ mode: 'delete-desktop', selected: d.id }) }} />
            {desktopName(d, t)}
          </label>)}
        </fieldset>
        <p>{t('Виджеты выбранного стола будут удалены вместе с ним.')}</p>
        {data.desktops.length === 1 && <p>{t('Последний рабочий стол удалить нельзя.')}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={() => setDrawerOpen(true)}>{t('Отмена')}</button>
          <button className="primary" disabled={busy || data.desktops.length < 2 || !data.desktops.some(d => d.id === panel.selected)}>{t('ОК')}</button>
        </div>
      </form>
    </Modal>}
    {panel?.mode === 'panel-settings' && <Modal title={t('Настройки панели')} close={() => setPanel(null)}>
      <fieldset className="theme-settings">
        <legend>{t('Тема')}</legend>
        {(['light', 'dark'] as const).map(value => <label key={value}>
          <input type="radio" name="theme" checked={theme === value} onChange={() => chooseTheme(value)} />
          {value === 'light' ? t('Светлая') : t('Тёмная')}
        </label>)}
      </fieldset>
      <fieldset className="theme-settings">
        <legend>{t('Язык')}</legend>
        <label><input type="radio" name="language" checked={language === 'ru'}
          onChange={() => { chooseLanguage('ru'); setError('') }} /><span lang="ru">Русский</span></label>
        <label><input type="radio" name="language" checked={language === 'en'}
          onChange={() => { chooseLanguage('en'); setError('') }} /><span lang="en">English</span></label>
      </fieldset>
    </Modal>}
    {panel?.mode === 'builder' && data && <Modal title={t('Конструктор виджетов')} pending={busy} close={() => setPanel(null)}>
      <Builder cellSize={cellSize} columns={data.columns} maxRows={data.max_rows} templates={data.templates} busy={busy} setBusy={setBusy}
        refresh={reload}
        saved={async () => {
          setPanel(null)
          await reload().catch(() => setError(t('Не удалось обновить рабочий стол')))
        }} />
    </Modal>}
    {panel?.mode === 'add' && data && desktop && <Modal title={t('Добавить виджет')} close={() => { setError(''); setPanel(null) }}>
      {data.plugins.length === 0 && data.templates.length === 0 && <p>{t('Доступных плагинов пока нет.')}</p>}
      {[...localizedPlugins, ...data.templates.map(template => ({ id: template.id, name: template.name, description: template.description || t('Пользовательский шаблон') }))].map(p => <button className="choice" key={p.id} disabled={busy}
        onClick={() => void mutate(async () => {
          await api('desktops/' + desktop.id + '/widgets', 'POST', { plugin_id: p.id, rows })
          setPanel(null)
        })}><strong>{p.name}</strong><small>{p.description}</small></button>)}
      {error && <p role="alert">{error}</p>}
    </Modal>}
    {opened && panel.mode === 'actions' && <Modal title={t('Действия с виджетом')} close={() => setPanel(null)}>
      <button className="choice" onClick={() => setPanel({ mode: 'Settings', id: opened.id })}>{t('Настройки')}</button>
      <button className="choice remove-widget" disabled={busy} onClick={() => void mutate(async () => {
        setPanel(null)
        await api('widgets/' + opened.id, 'DELETE')
      })}>{t('Удалить виджет')}</button>
    </Modal>}
    {data && desktop && opened && panel.mode !== 'actions' && <Modal title={panel.mode === 'Settings' ? t('Настройки') : t('Подробнее')}
      pending={busy} close={() => setPanel(null)}>{panel.mode === 'Details' ? <div className="details-view">{view(opened, 'Details')}</div> :
        <InstanceSettings key={opened.id} widget={opened} defaultTitle={defaultTitle(opened)} busy={busy}
          pluginSettings={data.plugins.some(p => p.id === opened.plugin_id && p.capabilities.includes('settings'))}
          refresh={async () => (await reload()).widgets.find(w => w.id === opened.id)}
          save={async draft => {
            setBusy(true)
            try {
              await api('widgets/' + opened.id + '/configuration', 'PUT', {
                ...draft, rows: opened.desktop_id === desktop.id ? rows : undefined,
              })
              await reload()
              setPanel(null)
            } finally { setBusy(false) }
          }} />}</Modal>}
  </>
}
