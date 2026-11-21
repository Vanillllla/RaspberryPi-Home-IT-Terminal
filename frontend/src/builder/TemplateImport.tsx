import { useRef, useState } from 'react'
import { api } from '../api'
import type { Template } from './model'

interface Props {
  setBusy: (busy: boolean) => void
  imported: (template: Template) => void
  open: (id: string) => void
}

export function TemplateImport({ setBusy, imported, open }: Props) {
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
      if (!file) throw new Error(directory ? 'В папке отсутствует template.json' : 'Выберите ZIP-архив')
      if (directory && (files.length !== 1 || !file.webkitRelativePath)) {
        throw new Error('Выберите папку с одним файлом template.json')
      }
      const query = directory ? '?' + new URLSearchParams({ path: file.webkitRelativePath }) : ''
      const content = file.slice(0, file.size, directory ? 'application/json' : 'application/zip')
      const template = await api<Template>('templates/import' + query, 'POST', content)
      imported(template)
      setResult(template)
      setChoosing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить шаблон')
    } finally {
      setBusy(false)
    }
  }

  return <div className="template-import">
    <button type="button" aria-expanded={choosing} onClick={() => {
      setChoosing(!choosing); setResult(null); setError('')
    }}>Загрузить шаблон</button>
    {choosing && <div className="import-options">
      <button type="button" onClick={() => folder.current?.click()}>Выбрать папку</button>
      <button type="button" onClick={() => zip.current?.click()}>Выбрать ZIP</button>
    </div>}
    <input hidden type="file" ref={el => { folder.current = el; el?.setAttribute('webkitdirectory', '') }}
      aria-label="Папка шаблона" onChange={e => void upload(e.currentTarget, true)} />
    <input hidden type="file" ref={zip} accept=".zip" aria-label="ZIP шаблона" onChange={e => void upload(e.currentTarget, false)} />
    {error && <p role="alert">{error}</p>}
    {result && <div className="import-result"><span role="status">Шаблон «{result.name}» загружен.</span>
      <button type="button" onClick={() => { open(result.id); setResult(null) }}>Открыть в конструкторе</button>
    </div>}
  </div>
}
