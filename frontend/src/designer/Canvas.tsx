import { useRef, useState, type PointerEvent } from 'react'
import { Surface, type Library } from '../engine/Renderer'
import { logicalSize, type Item, type Frame, type Project, type ViewName } from '../engine/model'
import { useWords } from '../i18n'

interface Gesture {
  pointer: number; id: string; x: number; y: number; frame: Frame; resize: boolean
  width: number; height: number; left: number; top: number; offsetX: number; offsetY: number; flow: boolean
  vertical: number[]; horizontal: number[]
}

function snap(value: number, length: number, targets: number[], zoom: number, resized: boolean) {
  let best: number | undefined
  let distance = 6 / zoom
  let guide: number | undefined
  for (const anchor of resized ? [0] : [0, length / 2, length]) {
    for (const line of targets) {
      const difference = line - (value + anchor)
      if (Math.abs(difference) < distance) {
        distance = Math.abs(difference); best = value + difference; guide = line
      }
    }
  }
  return { value: Math.round(best ?? Math.round(value / 8) * 8), guide }
}

export function Canvas({ project, name, library, selected, select, move, add, zoom }: {
  project: Project; name: ViewName; library: Library; selected: string; select: (id: string) => void
  move: (id: string, frame: Frame) => void; add: (type: string, x: number, y: number, parent: string) => void; zoom: number
}) {
  const w = useWords()
  const plane = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})
  const size = logicalSize(project, name)
  function begin(e: PointerEvent<HTMLElement>, node: Item, resize: boolean) {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    select(node.id)
    const part = e.currentTarget.closest<HTMLElement>('[data-element]')!
    const group = part.parentElement!
    const box = group.getBoundingClientRect()
    const root = plane.current!.getBoundingClientRect()
    const vertical = [0, group.clientWidth / 2, group.clientWidth]
    const horizontal = [0, group.clientHeight / 2, group.clientHeight]
    for (const sibling of Array.from(group.children)) {
      if (sibling === part || !(sibling instanceof HTMLElement)) continue
      const { offsetLeft: x, offsetTop: y, offsetWidth: width, offsetHeight: height } = sibling
      vertical.push(x, x + width / 2, x + width)
      horizontal.push(y, y + height / 2, y + height)
    }
    gesture.current = { pointer: e.pointerId, id: node.id, x: e.clientX, y: e.clientY, frame: node.frame, resize,
      width: group.clientWidth, height: group.clientHeight, left: part.offsetLeft, top: part.offsetTop, offsetX: (box.left - root.left) / zoom,
      offsetY: (box.top - root.top) / zoom, vertical, horizontal, flow: getComputedStyle(group).display === 'flex' }
    plane.current!.setPointerCapture(e.pointerId)
  }

  function drag(e: PointerEvent) {
    const g = gesture.current
    if (!g || g.pointer !== e.pointerId || (g.flow && !g.resize)) return
    const dx = (e.clientX - g.x) / zoom, dy = (e.clientY - g.y) / zoom
    if (Math.abs(dx) + Math.abs(dy) < 2) return
    const { x, y, w: width, h } = g.frame
    const left = g.flow ? g.left : x, top = g.flow ? g.top : y
    const sx = snap(left + dx + (g.resize ? width : 0), width, g.vertical, zoom, g.resize)
    const sy = snap(top + dy + (g.resize ? h : 0), h, g.horizontal, zoom, g.resize)
    const frame = g.resize ? { x, y, w: Math.max(8, Math.min(g.width - left, sx.value - left)),
      h: Math.max(8, Math.min(g.height - top, sy.value - top)) } :
      { ...g.frame, x: Math.max(0, Math.min(g.width - width, sx.value)), y: Math.max(0, Math.min(g.height - h, sy.value)) }
    setGuides({ x: sx.guide === undefined ? undefined : sx.guide + g.offsetX,
      y: sy.guide === undefined ? undefined : sy.guide + g.offsetY })
    move(g.id, frame)
  }
  function end() { gesture.current = null; setGuides({}) }
  return <div className="canvas-scroll" aria-label={w('Холст', 'Canvas')}>
    <div className="canvas-footprint" style={{ width: size.width * zoom, height: size.height * zoom }}>
      <div ref={plane} className="design-plane" style={{ ...size, transform: 'scale(' + zoom + ')' }}
        onPointerDown={() => select('')} onPointerMove={drag} onPointerUp={end} onLostPointerCapture={end}
        onClickCapture={e => e.preventDefault()} onDragOver={e => e.preventDefault()} onDrop={e => {
          e.preventDefault()
          const type = e.dataTransfer.getData('application/x-terminal-element')
          if (!library.has(type)) return
          const part = (e.target as HTMLElement).closest<HTMLElement>('[data-element]')
          const parent = part && library.get(part.dataset.type!)?.container ? part : part?.parentElement?.closest<HTMLElement>('[data-element]')
          const box = (parent ?? plane.current!).getBoundingClientRect()
          add(type, (e.clientX - box.left) / zoom, (e.clientY - box.top) / zoom, parent?.dataset.element ?? '')
        }}>
        <Surface project={project} name={name} library={library} design={{ selected, select, begin }} />
        {guides.x !== undefined && <i className="guide vertical" style={{ left: guides.x }} />}
        {guides.y !== undefined && <i className="guide horizontal" style={{ top: guides.y }} />}
      </div>
    </div>
  </div>
}
