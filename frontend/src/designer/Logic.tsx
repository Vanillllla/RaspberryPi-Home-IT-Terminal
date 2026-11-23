import { useLayoutEffect, useRef, useState } from 'react'
import { useWords } from '../i18n'

export function handlerNames(source: string) {
  return [...source.matchAll(/^def\s+([A-Za-z]\w*)\s*\(/gm)].map(match => match[1])
}

export function HandlerField({ label, value, source, update, jump }: {
  label: string; value: string; source: string; update: (value: string) => void; jump: (name: string) => void
}) {
  const w = useWords()
  const valid = /^[A-Za-z][A-Za-z0-9_]*$/.test(value)
  return <div className="binding"><label>{label}<input list="known-handlers" value={value} placeholder={w('Имя функции', 'Function name')}
    onChange={e => update(e.target.value)} /></label><button type="button" disabled={!valid} onClick={() => jump(value)}>
    {handlerNames(source).includes(value) ? w('К функции', 'Go to function') : w('Создать функцию', 'Create function')}</button></div>
}

const tokens = /(#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:def|return|if|else|elif|for|in|while|import|from|as|and|or|not|try|except|raise|with|pass|True|False|None|class)\b|\b\d+(?:\.\d+)?\b)/gm

export function LogicEditor({ source, update, target, check }: {
  source: string; update: (code: string) => void; target: string; check: () => void
}) {
  const w = useWords()
  const input = useRef<HTMLTextAreaElement>(null)
  const paint = useRef<HTMLPreElement>(null)
  const [line, setLine] = useState(1)
  useLayoutEffect(() => {
    if (!target) return
    const area = input.current!
    const i = area.value.search(new RegExp('^def\\s+' + target + '\\s*\\(', 'm'))
    if (i < 0) return
    area.focus()
    area.setSelectionRange(i, area.value.indexOf('\n', i) < 0 ? area.value.length : area.value.indexOf('\n', i))
    area.scrollTop = Math.max(0, (area.value.slice(0, i).split('\n').length - 3) * 21)
  }, [target])
  return <section className="python-panel"><div className="subbar"><strong>logic/main.py</strong>
    <span>{w('Строка', 'Line')} {line}</span><button onClick={check}>{w('Проверить Python', 'Check Python')}</button></div>
    <div className="code-editor"><pre ref={paint} aria-hidden="true">{source.split(tokens).map((part, i) => {
      if (i % 2 === 0) return part
      const cls = part.startsWith('#') ? 'comment' : /^["']/.test(part) ? 'string' : 'keyword'
      return <span key={i} className={cls}>{part}</span>
    })}{'\n'}</pre>
      <textarea ref={input} aria-label={w('Модуль Python', 'Python module')} value={source} spellCheck={false} wrap="off"
        onSelect={e => setLine(source.slice(0, e.currentTarget.selectionStart).split('\n').length)}
        onChange={e => update(e.target.value)} onScroll={e => {
          paint.current!.scrollTop = e.currentTarget.scrollTop; paint.current!.scrollLeft = e.currentTarget.scrollLeft
        }} onKeyDown={e => {
          if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
          e.preventDefault()
          const el = e.currentTarget, start = el.selectionStart
          update(source.slice(0, start) + '    ' + source.slice(el.selectionEnd))
          requestAnimationFrame(() => el.setSelectionRange(start + 4, start + 4))
        }} /></div>
    <small>{w('Tab — отступ, Shift+Tab — выход из редактора.', 'Tab indents. Shift+Tab leaves the editor.')}</small>
  </section>
}
