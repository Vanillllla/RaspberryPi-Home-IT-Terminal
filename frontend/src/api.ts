import { getLanguage, translate } from './i18n'
import type { ElementType, Published, WidgetInstance } from './engine/model'

export interface Desktop { id: number; name: string; rows: number; default_name?: boolean }
export interface State {
  revision: number; max_rows: number; columns: number; desktops: Desktop[]
  widgets: WidgetInstance[]; projects: Published[]; elements: ElementType[]
  operations: Record<string, number>; diagnostics: Record<string, string>
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const file = body instanceof Blob
  const language = getLanguage()
  const t = translate(language)
  const headers: Record<string, string> = { 'Accept-Language': language }
  if (!file && body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch('/api/' + path, {
    method,
    cache: "no-store",
    headers,
    body: file ? body : JSON.stringify(body),
  }).catch(() => { throw new Error(t('Не удалось выполнить запрос')) })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    if (Array.isArray(error.detail)) {
      const issue = error.detail[0]
      throw new ApiError(issue ? [issue.loc?.slice(1).join('.'), issue.msg].filter(Boolean).join(' · ')
        : t('Проверьте введённые данные'), response.status)
    }
    throw new ApiError(typeof error.detail === 'string' ? error.detail : t('Не удалось выполнить запрос'), response.status)
  }
  return response.json()
}
