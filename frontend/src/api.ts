import type { Template } from './builder/model'
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
  templates: Template[]
  plugins: Manifest[]
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const file = body instanceof Blob
  const response = await fetch('/api/' + path, {
    method,
    headers: file || body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: file ? body : JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    if (Array.isArray(error.detail)) {
      const issue = error.detail[0]
      throw new Error([issue?.loc?.slice(1).join('.'), issue?.msg].filter(Boolean).join(' · '))
    }
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Не удалось выполнить запрос')
  }
  return response.json()
}
