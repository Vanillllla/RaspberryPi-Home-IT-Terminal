import { useState, type ReactNode } from 'react'
import { useTranslation, useWords } from '../i18n'
import { defaultLayout, flat, logicalSize, updateItems, type Frame, type Item, type Project, type View, type ViewName } from '../engine/model'
import { LayoutFields, ValueField } from '../engine/Fields'
import type { Library } from '../engine/Renderer'
import { Canvas } from './Canvas'
import { HandlerField } from './Logic'

function without(nodes: Item[], id: string): Item[] {
  return nodes.filter(node => node.id !== id).map(node => ({ ...node, children: without(node.children, id) }))
}
function siblings(nodes: Item[], parent: string, change: (items: Item[]) => Item[]) {
  return parent ? updateItems(nodes, parent, item => ({ ...item, children: change(item.children) })) : change(nodes)
}

function IntegerField({ label, value, min = 0, max = 8192, update }: {
  label: string; value: number; min?: number; max?: number; update: (v: number) => void
}) {
  return <label>{label}<input type="number" min={min} max={max} value={value}
    onChange={e => { if (Number.isInteger(e.target.valueAsNumber) && e.target.validity.valid) update(e.target.valueAsNumber) }} /></label>
}

export function Workspace({ project, name, library, edit, jump, selected, select }: {
  project: Project; name: ViewName; library: Library; edit: (p: Project) => void; jump: (f: string) => void
  selected: string; select: (id: string) => void
}) {
  const { language } = useTranslation()
  const w = useWords()
  const [search, setSearch] = useState('')
  const [zoom, setZoom] = useState(1)
  const [idDraft, setIdDraft] = useState<string | null>(null)
  const [idError, setIdError] = useState('')
  const view = project.views[name]!
  const all = flat(view.nodes)
  const allIds = new Set(Object.values(project.views).flatMap(v => v ? flat(v.nodes).map(i => i.id) : []))
  const item = all.find(node => node.id === selected)
  const parent = item && all.find(node => node.children.some(child => child.id === selected))
  const spec = item && library.get(item.type)
  const size = logicalSize(project, name)
  function updateView(patch: Partial<View>) { edit({ ...project, views: { ...project.views, [name]: { ...view, ...patch } } }) }
  function choose(id: string) { select(id); setIdDraft(null); setIdError('') }
  function patchItem(id: string, patch: Partial<Item>) {
    updateView({ nodes: updateItems(view.nodes, id, old => ({ ...old, ...patch })) })
  }
  function add(type: string, x = 8, y = 8, target = spec?.container ? selected : parent?.id ?? '') {
    const element = library.get(type)!
    const box = all.find(n => n.id === target)?.frame
    const width = box?.w ?? size.width, height = box?.h ?? size.height
    const stem = type.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase()).replace(/-/g, '')
    let i = 1
    while (allIds.has(stem + i)) i++
    const id = stem + i
    const fw = Math.min(element.defaultFrame.w, width), fh = Math.min(element.defaultFrame.h, height)
    const frame = { x: Math.max(0, Math.min(width-fw, Math.round(x / 8) * 8)),
      y: Math.max(0, Math.min(height-fh, Math.round(y / 8) * 8)), w: fw, h: fh }
    const next: Item = { id, type, frame, grow: false, props: {}, events: {}, layout: defaultLayout(), children: [] }
    updateView({ nodes: siblings(view.nodes, target, children => [...children, next]) })
    choose(id)
  }
  function rearrange(offset: number) {
    updateView({ nodes: siblings(view.nodes, parent?.id ?? '', children => {
      const list = [...children], at = list.findIndex(i => i.id === selected), next = at + offset
      if (next >= 0 && next < list.length) [list[at], list[next]] = [list[next], list[at]]
      return list
    }) })
  }
  function tree(nodes: Item[]): ReactNode {
    return <ul>{nodes.map(node => <li key={node.id}><button className="tree-node" aria-pressed={node.id === selected}
      onClick={() => choose(node.id)}>{node.id} <small>{library.get(node.type)?.name[language] ?? node.type}</small></button>
      {node.children.length > 0 && tree(node.children)}</li>)}</ul>
  }
  return <div className="workbench">
    <aside className="design-side library-side"><h3>{w('Палитра', 'Palette')}</h3>
      <input type="search" aria-label={w('Поиск элементов', 'Search elements')} placeholder={w('Найти элемент', 'Find element')}
        value={search} onChange={e => setSearch(e.target.value)} />
      <div className="palette">{[...library.values()].filter(e =>
        (e.id + e.name[language] + e.description[language]).toLowerCase().includes(search.toLowerCase())).map(e =>
        <button key={e.id} draggable onDragStart={event => event.dataTransfer.setData('application/x-terminal-element', e.id)}
          title={e.description[language]} onClick={() => add(e.id)}>{e.name[language]}</button>)}</div>
      <h3>{w('Дерево элементов', 'Element tree')}</h3>
      <nav className="element-tree" aria-label={w('Дерево элементов', 'Element tree')}>
        <button aria-pressed={!selected} onClick={() => choose('')}>{name}</button>{tree(view.nodes)}</nav>
    </aside>
    <section className="canvas-column"><div className="subbar"><strong>{w('Холст', 'Canvas')}</strong>
      <span>{size.width} × {size.height} px</span>
      <select aria-label={w('Масштаб', 'Zoom')} value={zoom} onChange={e => setZoom(Number(e.target.value))}>
        {[.25,.5,.75,1,1.25,1.5,2].map(v => <option key={v} value={v}>{v*100}%</option>)}</select></div>
      <Canvas project={project} name={name} library={library} selected={selected} select={choose} zoom={zoom}
        move={(id, frame) => patchItem(id, { frame })} add={add} /></section>
    <aside className="design-side inspector"><h3>{w('Инспектор', 'Inspector')}</h3>
      {!item ? <><h4>{w('Представление', 'View')} · {name}</h4>
        <div className="form-grid">{name === 'widget' ? <>
          <IntegerField label={w('Ширина, клетки', 'Width, cells')} value={project.width} min={1} max={12} update={width => edit({ ...project, width })} />
          <IntegerField label={w('Высота, клетки', 'Height, cells')} value={project.height} min={1} max={24} update={height => edit({ ...project, height })} /></> : <>
          <IntegerField label={w('Ширина, px', 'Width, px')} value={view.width} min={1} update={width => updateView({ width })} />
          <IntegerField label={w('Высота, px', 'Height, px')} value={view.height} min={1} update={height => updateView({ height })} /></>}</div>
        <LayoutFields layout={view.layout} update={layout => updateView({ layout })} />
        {name !== 'widget' && <button onClick={() => {
          if (view.nodes.length && !window.confirm(w('Удалить представление с его элементами?', 'Remove the view and its elements?'))) return
          edit({ ...project, views: { ...project.views, [name]: null } })
        }}>{w('Удалить представление', 'Remove view')}</button>}</> :
        <div key={item.id} className="node-fields"><h4>{spec?.name[language] ?? item.type}</h4>
          {spec && <p className="element-description">{spec.description[language]}</p>}
          <label>ID<input aria-invalid={Boolean(idError)} value={idDraft ?? item.id} onChange={e => { setIdDraft(e.target.value); setIdError('') }}
            onBlur={() => {
              if (idDraft === null || idDraft === item.id) return
              if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(idDraft) || allIds.has(idDraft)) {
                setIdError(w('Нужен уникальный ID из латинских букв, цифр и _.', 'Use a unique ID with letters, digits or _.')); return
              }
              patchItem(item.id, { id: idDraft }); choose(idDraft)
            }} /></label>{idError && <small role="alert">{idError}</small>}
          <div className="form-grid">{(['x','y','w','h'] as (keyof Frame)[]).map((key, i) =>
            <IntegerField key={key} min={i < 2 ? 0 : 1} label={['X','Y',w('Ширина','Width'),w('Высота','Height')][i]}
              value={item.frame[key]} update={v => patchItem(item.id, { frame: { ...item.frame, [key]: v } })} />)}</div>
          <label>{w('Родитель', 'Parent')}<select value={parent?.id ?? ''} onChange={e => updateView({
            nodes: siblings(without(view.nodes, item.id), e.target.value, list => [...list, item]),
          })}><option value="">{name}</option>{all.filter(n => library.get(n.type)?.container && !flat([item]).some(v => v.id === n.id))
            .map(n => <option key={n.id}>{n.id}</option>)}</select></label>
          <div className="inline-actions"><button onClick={() => rearrange(-1)}>{w('Назад', 'Backward')}</button>
            <button onClick={() => rearrange(1)}>{w('Вперёд', 'Forward')}</button></div>
          {(parent?.layout ?? view.layout).mode !== 'fixed' && <label><input type="checkbox" checked={item.grow}
            onChange={e => patchItem(item.id, { grow: e.target.checked })} />{w('Занимать свободное место', 'Grow to fill')}</label>}
          {spec?.container && <LayoutFields layout={item.layout} update={layout => patchItem(item.id, { layout })} />}
          {spec && Object.entries(spec.properties).map(([key, field]) => <ValueField key={key} name={key} spec={field}
            value={item.props[key] ?? field.default} change={v => patchItem(item.id, { props: { ...item.props, [key]: v } })} />)}
          {spec && Object.keys(spec.events).length > 0 && <h4>{w('События', 'Events')}</h4>}
          {spec && Object.entries(spec.events).map(([key, event]) => <div key={key} title={event.description[language]}>
            <HandlerField label={key} source={project.source} value={item.events[key] ?? ''} jump={jump} update={value => {
              const events = { ...item.events }; if (value) events[key] = value; else delete events[key]
              patchItem(item.id, { events })
            }} /></div>)}
          <button onClick={() => { updateView({ nodes: without(view.nodes, item.id) }); choose('') }}>{w('Удалить элемент', 'Remove element')}</button>
        </div>}
    </aside>
  </div>
}
