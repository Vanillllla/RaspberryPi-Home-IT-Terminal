import type { WidgetInstance } from './plugin'

export interface Desktop { id: number; name: string; rows: number }
export interface Manifest {
  id: string
  name: string
  description: string
  capabilities: string[]
}
export interface State {
  max_rows: number
  columns: number
  desktops: Desktop[]
  widgets: WidgetInstance[]
  plugins: Manifest[]
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/' + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Не удалось выполнить запрос')
  }
  return response.json()
}
