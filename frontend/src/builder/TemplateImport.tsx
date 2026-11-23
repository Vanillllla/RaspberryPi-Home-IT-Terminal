import { useTranslation } from '../i18n'
import { useRef, useState } from 'react'
import { api } from '../api'
import type { Template } from './model'

interface Props {
  setBusy: (busy: boolean) => void
  imported: () => Promise<unknown>
  open: (id: string) => void
}

export function TemplateImport({ setBusy, imported, open }: Props) {
  const { t } = useTranslation()
  const folder = useRef<HTMLInputElement>(null)
  const zip = useRef<HTMLInputElement>(null)
  const [choosing, setChoosing] = useState(false)
  const [result, setResult] = useState<Template | null>(null)
  const [error, setError] = useState('')

  async function upload(input: HTMLInputElement, directory: boolean) {
    const files = Array.from(input.files ?? [])
    input.value = ''
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const file = files[0]
      if (!file) throw new Error(directory ? t('В папке отсутствует template.json') : t('Выберите ZIP-архив'))
      if (directory && (files.length !== 1 || !file.webkitRelativePath)) {
        throw new Error(t('Выберите папку с одним файлом template.json'))
      }
      const query = directory ? '?' + new URLSearchParams({ path: file.webkitRelativePath }) : ''
      const content = file.slice(0, file.size, directory ? 'application/json' : 'application/zip')
      const template = await api<Template>('templates/import' + query, 'POST', content)
      await imported()
      setResult(template)
      setChoosing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Не удалось загрузить шаблон'))
    } finally {
      setBusy(false)
    }
  }

  return <div className="template-import">
    <button type="button" aria-expanded={choosing} onClick={() => {
      setChoosing(!choosing); setResult(null); setError('')
    }}>{t('Загрузить шаблон')}</button>
    {choosing && <div className="import-options">
      <button type="button" onClick={() => folder.current?.click()}>{t('Выбрать папку')}</button>
      <button type="button" onClick={() => zip.current?.click()}>{t('Выбрать ZIP')}</button>
    </div>}
    <input hidden type="file" ref={el => { folder.current = el; el?.setAttribute('webkitdirectory', '') }}
      aria-label={t('Папка шаблона')} onChange={e => void upload(e.currentTarget, true)} />
    <input hidden type="file" ref={zip} accept=".zip" aria-label={t('ZIP шаблона')} onChange={e => void upload(e.currentTarget, false)} />
    {error && <p role="alert">{error}</p>}
    {result && <div className="import-result"><span role="status">{t('Шаблон «{name}» загружен.', { name: result.name })}</span>
      <button type="button" onClick={() => { open(result.id); setResult(null) }}>{t('Открыть в конструкторе')}</button>
    </div>}
  </div>
}
