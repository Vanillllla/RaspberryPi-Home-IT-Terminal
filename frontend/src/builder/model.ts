export const kinds = {
  text: 'Текст', button: 'Кнопка', switch: 'Переключатель', slider: 'Слайдер', indicator: 'Индикатор состояния',
  input: 'Поле ввода',
}
export const actionKinds = {
  time: 'Текущее время', reach: 'Проверка доступности', http: 'HTTP GET', python: 'Python',
}
export const colors = { green: 'Зелёный', yellow: 'Жёлтый', red: 'Красный' }
export type Kind = keyof typeof kinds
export type Color = keyof typeof colors
export type ActionKind = keyof typeof actionKinds
export type InputValue = string | number | boolean
export const inputFormats = {
  text: { label: 'Текст', placeholder: 'Введите текст' },
  number: { label: 'Число', placeholder: 'Введите число' },
  ipv4: { label: 'IPv4', placeholder: 'Введите IP-адрес' },
  date: { label: 'Дата', placeholder: 'Выберите дату' },
  time: { label: 'Время', placeholder: 'Выберите время' },
}
export type Inputs = Record<string, InputValue>
export type Outputs = Record<string, string>

export interface Cell { x: number; y: number }

export const subdivisions = 5
export interface Frame extends Cell { width: number; height: number }
export const fontFamilies = { system: 'inherit', serif: 'Georgia, serif', monospace: 'monospace' }

export interface Item {
  inputMode?: keyof typeof inputFormats
  placeholder?: string
  resetCommand?: string
  frame?: Frame | null
  fontFamily?: keyof typeof fontFamilies
  fontSize?: number
  cell?: Cell | null
  id: string; kind: Kind; label: string; command: string; checked: boolean; color: Color
  span?: number | null
  minimum: number; maximum: number; step: number; initial: number
}
export interface Action {
  id: string; kind: ActionKind; name: string; trigger: 'command' | 'timer'; command: string; interval: number
  host: string; port: number | null; url: string; path: string; code: string
  targets: { element: string; field: string }[]
}
export interface Draft { defaultWidth?: number; defaultHeight?: number; name: string; description?: string; rows: Item[][]; actions: Action[]; revision: number }
export interface Template extends Draft { id: string }

export function randomKey(bytes = 16) {
  // getRandomValues also works on a LAN connection without HTTPS.
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('')
}
export function newItem(kind: Kind): Item {
  return { id: 'e' + randomKey(5), kind, label: kinds[kind], command: '', checked: false,
    minimum: 0, maximum: 100, step: 1, initial: 0, color: 'green' }
}
export function newAction(kind: ActionKind): Action {
  return { id: 'a' + randomKey(5), kind, name: actionKinds[kind], trigger: kind === 'time' ? 'timer' : 'command',
    command: 'refresh', interval: 1, host: '', port: null, url: '', path: '',
    code: 'def run(context):\n    return {"text": "Доступен", "color": "green"}', targets: [] }
}

export function unusedCommand(draft: Draft) {
  const used = new Set([
    ...draft.actions.map(action => action.command),
    ...draft.rows.flat().map(item => item.command),
  ])
  if (!used.has('refresh')) return 'refresh'
  let number = 2
  while (used.has('refresh-' + number)) number++
  return 'refresh-' + number
}

export function actionLabel(action: Action) {
  return action.trigger === 'command' && action.command ? action.name + ' · ' + action.command : action.name
}
export function emptyDraft(): Draft {
  return { name: '', rows: [[]], actions: [], revision: 0 }
}

// Remove the share of the row gap that falls outside this cell's span.
export function cellStyle(item: Item, columns: number) {
  if (!item.span) return undefined
  const share = Math.min(1, item.span / columns)
  return { flex: `0 0 calc(${100 * share}% - ${1 - share} * var(--row-gap))` }
}
