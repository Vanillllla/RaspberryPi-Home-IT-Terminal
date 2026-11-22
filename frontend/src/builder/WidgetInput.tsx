import { Fragment, useRef } from 'react'
import type { Item } from './model'

interface Props {
  item: Item
  value: string
  change: (value: string) => void
}

const validOctet = (value: string) => /^[0-9]{0,3}$/.test(value) && Number(value) <= 255

export function WidgetInput({ item, value, change }: Props) {
  const fields = useRef<HTMLDivElement>(null)
  const ipv4 = item.inputMode === 'ipv4'
  const placeholder = item.placeholder || (ipv4 ? 'Введите IP-адрес' : 'Введите текст')
  const label = item.label && item.label !== 'Поле ввода' ? item.label : placeholder
  if (!ipv4) return <input className="built-input" type="text" aria-label={label} placeholder={placeholder}
    maxLength={2000} value={value} onChange={event => change(event.currentTarget.value)} />

  const parts = value.split('.')
  const octets = Array.from({ length: 4 }, (_, index) => parts[index] ?? '')
  function focus(index: number) {
    fields.current?.querySelectorAll('input')[index]?.focus()
  }
  function update(index: number, values: string[]) {
    if (index + values.length > 4 || !values.every(validOctet)) return
    const next = [...octets]
    next.splice(index, values.length, ...values)
    change(next.join('.').replace(/\.+$/, ''))
  }

  return <div className="built-input built-ipv4" role="group" aria-label={label}>
    <div ref={fields} className="ipv4-octets">
      {octets.map((octet, index) => <Fragment key={index}>
        {index > 0 && <span aria-hidden="true">.</span>}
        <input type="text" inputMode="numeric" autoComplete="off" aria-label={label + ' · октет ' + (index + 1)}
          maxLength={3} value={octet} onChange={event => {
            const next = event.currentTarget.value
            if (!validOctet(next)) return
            update(index, [next])
            if (next.length === 3) focus(index + 1)
          }} onKeyDown={event => {
            if (event.key === '.') {
              event.preventDefault()
              if (octet) focus(index + 1)
            }
            if (event.key === 'Backspace' && !octet) focus(index - 1)
          }} onPaste={event => {
            const pasted = event.clipboardData.getData('text').trim()
            if (!pasted.includes('.')) return
            event.preventDefault()
            const parts = pasted.split('.')
            if (!parts.every(part => part && validOctet(part))) return
            const start = parts.length === 4 ? 0 : index
            update(start, parts)
            focus(Math.min(start + parts.length, 3))
          }} />
      </Fragment>)}
    </div>
    {!value && <span className="ipv4-placeholder" aria-hidden="true">{placeholder}</span>}
  </div>
}
