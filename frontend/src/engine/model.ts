export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Values = Record<string, Json>
export type Properties = Record<string, Values>
export type Lang = 'ru' | 'en'
export type Label = Record<Lang, string>
export type ViewName = 'widget' | 'details' | 'settings'
export const viewLabels: Record<ViewName, Label> = {
  widget: { ru: 'Карточка', en: 'Widget' },
  details: { ru: 'Подробнее', en: 'Details' },
  settings: { ru: 'Настройки', en: 'Settings' },
}
export type Mode = 'event' | 'visible' | 'background'
export interface Property {
  type: 'boolean' | 'number' | 'string' | 'choice' | 'color' | 'json' | 'secret'
  label: Label
  description?: Label | null
  default: Json
  localized?: boolean
  min?: number | null
  max?: number | null
  options?: string[]
  optionLabels?: Record<string, Label>
}
export interface Frame { x: number; y: number; w: number; h: number }
export interface Layout { mode: 'fixed' | 'row' | 'column'; align: 'start' | 'center' | 'end' | 'stretch'; gap: number }
export interface ElementType {
  id: string; name: Label; description: Label; version: string
  defaultFrame: Frame; properties: Record<string, Property>
  events: Record<string, { description: Label; writes: string[] }>
  container: boolean; strings: Record<string, Label>
}
export interface Item {
  id: string; type: string; frame: Frame; grow: boolean; props: Values
  events: Record<string, string>; children: Item[]; layout: Layout
}
export interface View { width: number; height: number; layout: Layout; nodes: Item[] }
export interface Project {
  apiVersion: 1; id: string; version: string; author: string; icon: string
  name: Label; description: Label; width: number; height: number; appearance: Appearance
  views: { widget: View; details: View | null; settings: View | null }
  settings: Record<string, Property>; execution: { mode: Mode; interval: number; handler: string | null }
  dependencies: { elements: string[]; python: string[]; host: string[] }
  events: Record<string, string>; strings: Record<string, Label>; source: string
}
export type Published = Omit<Project, 'source'> & { revision: string }
export interface Appearance {
  customTitle?: string | null; hideTitle?: boolean | null; titlePalette?: string | null; cardPalette?: string | null
}
export interface WidgetInstance {
  id: number; desktop_id: number; project_id: string; slot: number; width: number; height: number
  appearance: Appearance; settings: Values; properties: Properties; config_version: number; configuredSecrets: string[]
  execution: { mode?: Mode; interval?: number }; error: string
}
export interface Signal { element?: string; name: string; changes?: Values }
export const CELL = 96
export const defaultLayout = (): Layout => ({ mode: 'fixed', align: 'start', gap: 8 })
export const newView = (): View => ({ width: 720, height: 480, layout: defaultLayout(), nodes: [] })

export function newProject(): Project {
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)), n => n.toString(16).padStart(2, '0')).join('')
  return {
    apiVersion: 1, id: 'widget-' + suffix, version: '1.0', author: '', icon: '',
    name: { ru: 'Новый виджет', en: 'New widget' }, description: { ru: '', en: '' }, width: 4, height: 3,
    views: { widget: newView(), details: null, settings: null }, execution: { mode: 'event', interval: 30, handler: null },
    appearance: {}, settings: {}, events: {}, strings: {}, dependencies: { elements: [], python: [], host: [] }, source: '',
  }
}

export function logicalSize(project: Project | Published, name: ViewName) {
  const view = project.views[name]!
  return name === 'widget' ? { width: project.width * CELL, height: project.height * CELL } : { width: view.width, height: view.height }
}

export function flat(nodes: Item[]): Item[] {
  return nodes.flatMap(node => [node, ...flat(node.children)])
}

export function updateItems(nodes: Item[], id: string, edit: (item: Item) => Item): Item[] {
  return nodes.map(node => node.id === id ? edit(node) : { ...node, children: updateItems(node.children, id, edit) })
}
