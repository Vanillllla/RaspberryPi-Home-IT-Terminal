import type { ElementProps } from '@terminal/element'
import { useState } from 'react'

export default function Input({ properties: p, language, emit }: ElementProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const format = String(p.format)
  function commit(input: HTMLInputElement) {
    if (draft === null) return
    if (format === 'ipv4' && draft && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(draft) ||
        format === 'ipv4' && draft.split('.').some(part => Number(part) > 255)) {
      input.setCustomValidity(language === 'ru' ? 'Введите IPv4-адрес' : 'Enter an IPv4 address')
    }
    if (!input.reportValidity()) return
    if (input.value !== p.value) emit('onChange', { value: input.value })
    setDraft(null)
  }
  return <input aria-label={String(p.label)} placeholder={String(p.placeholder)} disabled={!p.enabled}
    lang={language} type={format === 'ipv4' ? 'text' : format} value={draft ?? String(p.value)}
    onChange={e => { e.target.setCustomValidity(''); setDraft(e.target.value) }}
    onBlur={e => commit(e.currentTarget)} onKeyDown={e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget) }
      if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); e.currentTarget.setCustomValidity('') }
    }} />
}
