import { getLanguage, translate, type Language } from './i18n'
import type { Template } from './builder/model'
import type { WidgetInstance } from './plugin'

export interface Desktop { id: number; name: string; rows: number; default_name?: boolean }
export interface Manifest {
  id: string
  name: string
  description: string
  translations?: Partial<Record<Language, { name: string; description: string }>>
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
  const language = getLanguage()
  const t = translate(language)
  const headers: Record<string, string> = { 'Accept-Language': language }
  if (!file && body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch('/api/' + path, {
    method,
    headers,
    body: file ? body : JSON.stringify(body),
  }).catch(() => { throw new Error(t('Не удалось выполнить запрос')) })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    if (Array.isArray(error.detail)) {
      const issue = error.detail[0]
      throw new Error(issue ? [issue.loc?.slice(1).join('.'), issue.msg].filter(Boolean).join(' · ')
        : t('Проверьте введённые данные'))
    }
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Не удалось выполнить запрос')
  }
  return response.json()
}
