import { useTranslation, useWords } from '../i18n'
import type { Library } from '../engine/Renderer'
import russian from '../../../docs/ru/PYTHON_API.md?raw'
import english from '../../../docs/eng/PYTHON_API.md?raw'

export function Help({ library, operations }: { library: Library; operations: Record<string, number> }) {
  const { language } = useTranslation(), w = useWords()
  const guide = language === 'ru' ? russian : english
  return <div className="engine-help"><section><h3>{w('Справочник элементов', 'Element reference')}</h3>
    {[...library.values()].map(e => <details key={e.id}><summary>{e.name[language]} · {e.id} · {e.version}</summary>
      <p>{e.description[language]}</p>
      <dl>{Object.entries(e.properties).map(([key, spec]) => <div key={key}><dt><code>{key}</code> · {spec.type}</dt>
        <dd>{spec.label[language]} · {JSON.stringify(spec.default)} {spec.min != null && '≥ ' + spec.min} {spec.max != null && '≤ ' + spec.max}
          {spec.options?.join(' / ')} {spec.description?.[language]}</dd></div>)}
        {Object.entries(e.events).map(([key, event]) => <div key={key}><dt><code>{key}</code></dt>
          <dd>{event.description[language]} {event.writes.join(', ')}</dd></div>)}</dl></details>)}
    <h3>{w('Операции интеграций', 'Integration operations')}</h3>
    {Object.keys(operations).length ? Object.entries(operations).map(([id, n]) =>
      <pre key={id}>ctx.invoke({JSON.stringify(id)}{Array.from({ length: n }, (_, i) => ', arg' + (i+1))})</pre>) :
      <p>{w('Операции хоста не установлены.', 'No host operations installed.')}</p>}</section>
    <section className="api-guide">{guide.split(/^\x60\x60\x60\w*\s*$/m).map((part, i) =>
      i % 2 ? <pre key={i}>{part.trim()}</pre> : <div key={i}>{part.trim().split(/\n\s*\n/).filter(Boolean)
        .map((p, j) => p.startsWith('#') ? <h3 key={j}>{p.replace(/^#+ /, '')}</h3> : <p key={j}>{p.replaceAll('\x60','')}</p>)}</div>)}</section>
  </div>
}
