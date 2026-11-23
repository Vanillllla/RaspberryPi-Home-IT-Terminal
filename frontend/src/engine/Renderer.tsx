import { Component, lazy, Suspense, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import type { ElementProps } from './element'
import { logicalSize, type ElementType, type Item, type Layout, type Project, type Properties, type Published, type Signal, type ViewName } from './model'
import { useTranslation } from '../i18n'
import { trackPresence } from '../sync'
import './engine.css'

const modules = import.meta.glob<{ default: ComponentType<ElementProps> }>('../../../elements/*/Component.tsx')
const components = new Map(Object.entries(modules).map(([path, load]) => [path.split('/').at(-2)!, lazy(load)]))

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode; node: Item; live?: object }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(previous: Readonly<typeof this.props>) {
    if (this.state.failed && (previous.node !== this.props.node || previous.live !== this.props.live)) this.setState({ failed: false })
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export type Library = ReadonlyMap<string, ElementType>
export interface Design {
  selected: string
  select: (id: string) => void
  begin: (event: PointerEvent<HTMLElement>, node: Item, resize: boolean) => void
}
interface Props {
  project: Project | Published; name: ViewName; library: Library
  properties?: Properties; send?: (event: Signal) => void; design?: Design
}

export function layoutStyle(layout: Layout): CSSProperties {
  if (layout.mode === 'fixed') return { position: 'relative' }
  return { position: 'relative', display: 'flex', flexDirection: layout.mode, gap: layout.gap,
    alignItems: layout.align === 'stretch' ? 'stretch' : layout.align === 'center' ? 'center' : 'flex-' + layout.align }
}

export function Surface({ project, name, library, properties = {}, send, design }: Props) {
  const { language } = useTranslation()
  const view = project.views[name]
  if (!view) return null
  function draw(node: Item, parent: Layout) {
    const manifest = library.get(node.type)
    const Tag = components.get(node.type)
    const effective = Object.fromEntries(Object.entries(manifest?.properties ?? {}).map(([key, spec]) => {
      const live = properties[node.id]
      const value = live && Object.hasOwn(live, key) ? live[key] : Object.hasOwn(node.props, key) ? node.props[key] : spec.default
      const word = spec.localized && typeof value === 'string' ? project.strings[value] ?? manifest?.strings[value] : null
      return [key, word?.[language] ?? value]
    }))
    const frame = node.frame
    const fixed = parent.mode === 'fixed'
    const style: CSSProperties = {
      width: !fixed && parent.mode === 'column' && parent.align === 'stretch' ? undefined : frame.w,
      height: !fixed && parent.mode === 'row' && parent.align === 'stretch' ? undefined : frame.h,
      ...(fixed ? { position: 'absolute', left: frame.x, top: frame.y } : { flexGrow: Number(node.grow), flexShrink: 0 }),
    }
    const children = node.children.length > 0 && <div className="engine-children" style={layoutStyle(node.layout)}>
      {node.children.map(child => draw(child, node.layout))}
    </div>
    const fallback = <span className="element-fallback">{language === 'ru' ? 'Элемент недоступен' : 'Element unavailable'} · {node.type}</span>
    return <div key={node.id} data-element={node.id} data-type={node.type} className={'engine-node' + (design ? ' designing' : '')}
      data-selected={design?.selected === node.id || undefined} style={style}
      onPointerDown={design ? e => design.begin(e, node, false) : undefined}>
      {manifest && Tag ? <Boundary key={node.type + manifest.version} fallback={fallback} node={node} live={properties[node.id]}>
        <Suspense fallback={<span aria-busy="true">…</span>}>
          <Tag id={node.id} properties={effective} language={language}
            emit={(event, changes) => { if (!design) send?.({ element: node.id, name: event, changes }) }}
            asset={filename => '/api/projects/' + project.id + '/assets/' + filename.split('/').map(encodeURIComponent).join('/')}>
            {children}
          </Tag>
        </Suspense>
      </Boundary> : <>{fallback}{children}</>}
      {design && design.selected === node.id && <button className="size-grip" aria-label={language === 'ru' ? 'Изменить размер' : 'Resize'}
        onPointerDown={e => design.begin(e, node, true)} />}
    </div>
  }
  return <div className="engine-surface" style={layoutStyle(view.layout)}>{view.nodes.map(node => draw(node, view.layout))}</div>
}

/** Scale both axes by one factor. Flow roots can also use surplus width or height. */
export function FitView(props: Props & { presence?: number }) {
  const outer = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = outer.current!
    const observer = new ResizeObserver(() => setArea({ width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (props.presence) return trackPresence(outer.current!, props.presence)
  }, [props.presence])
  const size = logicalSize(props.project, props.name)
  const scale = Math.min(area.width / size.width, area.height / size.height)
  const fluid = props.project.views[props.name]?.layout.mode !== 'fixed'
  const ratio = fluid ? Math.min(scale, 1) : scale
  return <div ref={outer} className="engine-fit">{ratio > 0 && <div className="engine-plane"
    style={{ width: fluid ? area.width / ratio : size.width, height: fluid ? area.height / ratio : size.height,
      transform: 'scale(' + ratio + ')' }}><Surface {...props} /></div>}</div>
}
