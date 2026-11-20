import { Component, lazy, Suspense, type ReactNode } from 'react'
import type { Plugin, WidgetInstance } from './plugin'

const modules = import.meta.glob<{ default: Plugin }>('../../plugins/*/index.tsx')

function makeView(load: () => Promise<{ default: Plugin }>) {
  return lazy(async () => {
    const { default: plugin } = await load()
    function View({ instance, mode, saveSettings }: ViewProps) {
      const Part = plugin[mode]
      if (!Part) throw new Error('Компонент отсутствует')
      return <Part instance={instance} saveSettings={saveSettings} />
    }
    return { default: View }
  })
}

const views = Object.fromEntries(Object.entries(modules).map(([path, load]) =>
  [path.split('/').at(-2)!, makeView(load)]))

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <p role="status">Ошибка виджета</p> : this.props.children
  }
}

interface ViewProps {
  instance: WidgetInstance
  mode: keyof Plugin
  saveSettings: (settings: WidgetInstance['settings']) => Promise<void>
}

export function PluginView(props: ViewProps) {
  const View = views[props.instance.plugin_id]
  if (!View) return <p>Плагин недоступен</p>
  return <Boundary key={props.instance.id + props.mode}>
    <Suspense fallback={<p>Загрузка…</p>}><View {...props} /></Suspense>
  </Boundary>
}
