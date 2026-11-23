import { useTranslation } from './i18n'
import { Component, lazy, Suspense, type ReactNode } from 'react'
import type { Plugin, WidgetInstance } from './plugin'

const modules = import.meta.glob<{ default: Plugin }>('../../plugins/*/index.tsx')

function makeView(load: () => Promise<{ default: Plugin }>) {
  return lazy(async () => {
    const { default: plugin } = await load()
    function View({ instance, mode, saveSettings }: ViewProps) {
      const Part = plugin[mode]
      if (!Part) throw new Error(`Plugin component missing: ${mode}`)
      return <Part instance={instance} saveSettings={saveSettings} />
    }
    return { default: View }
  })
}

const views = Object.fromEntries(Object.entries(modules).map(([path, load]) =>
  [path.split('/').at(-2)!, makeView(load)]))

class Boundary extends Component<{ children: ReactNode; errorLabel: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <p role="status">{this.props.errorLabel}</p> : this.props.children
  }
}

interface ViewProps {
  instance: WidgetInstance
  mode: keyof Plugin
  saveSettings: (settings: WidgetInstance['settings']) => Promise<void>
}

export function PluginView(props: ViewProps) {
  const { t } = useTranslation()
  const View = views[props.instance.plugin_id]
  if (!View) return <p>{t('Плагин недоступен')}</p>
  return <Boundary errorLabel={t('Ошибка виджета')} key={props.instance.id + props.mode}>
    <Suspense fallback={<p>{t('Загрузка…')}</p>}><View {...props} /></Suspense>
  </Boundary>
}
