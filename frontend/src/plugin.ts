import type { ComponentType } from 'react'

export interface WidgetInstance {
  id: number
  desktop_id: number
  plugin_id: string
  slot: number
  width: number
  height: number
  settings: Record<string, unknown>
  appearance: Record<string, unknown>
}

export interface WidgetProps {
  instance: WidgetInstance
}

export interface Plugin {
  Widget: ComponentType<WidgetProps>
  Details?: ComponentType<WidgetProps>
  Settings?: ComponentType<WidgetProps & {
    saveSettings: (settings: WidgetInstance['settings']) => Promise<void>
  }>
}

export { WidgetSlider, WidgetSwitch } from './WidgetControls'
export { useTranslation } from './i18n'
