import type { CSSProperties, ReactNode } from 'react'
import { cellStyle, fontFamilies, subdivisions, type Cell, type Frame, type Draft, type Item } from './model'

export function canPlace(item: Item, frame: Frame, items: Item[], width: number, height: number) {
  const { x, y, width: w, height: h } = frame
  if (x < 0 || y < 0 || x + w > width || y + h > height) return false
  if (item.kind === 'divider') {
    const [length, span] = item.orientation === 'vertical' ? [h, w] : [w, h]
    return length >= 1 && (span === 0 || span === 1)
  }
  return w >= 1 && h >= 1 && !items.some(other => {
    const f = other.frame
    return other.id !== item.id && other.kind !== 'divider' && f &&
      x < f.x + f.width && f.x < x + w && y < f.y + f.height && f.y < y + h
  })
}

export function frameStyle(item: Item, columns: number, rows: number, f = item.frame!): CSSProperties {
  if (item.kind === 'divider') {
    const vertical = item.orientation === 'vertical'
    const center = vertical ? f.x + f.width / 2 : f.y + f.height / 2
    const limit = vertical ? columns : rows
    const position = (center / limit * 100) + '%'
    const hitSize = `min(12px, ${100 / limit}%)`
    const start = `clamp(0px, calc(${position} - ${hitSize} / 2), calc(100% - ${hitSize}))`
    // Keep the editor handle inside the canvas, including at its outer borders.
    return {
      left: vertical ? start : f.x / columns * 100 + '%',
      top: vertical ? f.y / rows * 100 + '%' : start,
      width: vertical ? hitSize : f.width / columns * 100 + '%',
      height: vertical ? f.height / rows * 100 + '%' : hitSize,
      '--line-position': center === 0 ? '1px' : center === limit ? 'calc(100% - 1px)' : '50%',
    } as CSSProperties
  }
  return { left: f.x / columns * 100 + '%', top: f.y / rows * 100 + '%',
    width: f.width / columns * 100 + '%', height: f.height / rows * 100 + '%',
    fontSize: (item.fontSize ?? 12) + 'pt', fontFamily: fontFamilies[item.fontFamily ?? 'system'] }
}

// Keep automatic elements in source row order, using the space around pinned elements.
function positions(rows: Item[][], width: number) {
  const masks = new Map<number, number>()
  const cells = new Map<string, Cell>()
  function reserve(item: Item, cell: Cell) {
    cells.set(item.id, cell)
    const mask = (1 << Math.min(width, item.span ?? 1)) - 1
    masks.set(cell.y, (masks.get(cell.y) ?? 0) | (mask << cell.x))
  }
  for (const item of rows.flat()) if (item.cell) reserve(item, item.cell)
  let slot = 0
  for (const row of rows) {
    for (const item of row) {
      if (item.cell) continue
      const span = Math.min(width, item.span ?? 1)
      const mask = (1 << span) - 1
      while (slot % width + span > width || ((masks.get(Math.floor(slot / width)) ?? 0) & (mask << (slot % width)))) slot++
      reserve(item, { x: slot % width, y: Math.floor(slot / width) })
      slot += span
    }
    slot = Math.ceil(slot / width) * width
  }
  return cells
}

// Convert legacy drafts on opening. Stored templates keep their original rendering until saved.
export function editableDraft(draft: Draft): Draft {
  const integrations = draft.rows.flat().filter(item => item.kind === 'integration')
  if (integrations.length) {
    const visible = editableDraft({ ...draft, rows: draft.rows.map(row => row.filter(item => item.kind !== 'integration')).filter(row => row.length) })
    const attached = integrations.map(item => ({ ...item, frame: null, cell: null, span: null }))
    return { ...visible, rows: [[...visible.rows.flat(), ...attached]] }
  }
  const items = draft.rows.flat()
  if (items.every(e => e.frame)) return draft
  const width = draft.defaultWidth ?? 4
  const height = draft.defaultHeight ?? 2
  const cells = positions(draft.rows, width)
  const pinned = items.some(e => e.cell)
  const usedRows = Math.max(...items.map(e => cells.get(e.id)!.y + 1))
  const defaultHeight = Math.max(height, Math.ceil(usedRows / subdivisions))
  const rowHeight = Math.min(subdivisions, defaultHeight * subdivisions / usedRows)
  const rows = draft.rows.map(row => row.map(({ cell, span, ...item }) => {
    const { x, y } = cells.get(item.id)!
    const top = Math.floor(y * rowHeight)
    let left = x * subdivisions
    let right = left + Math.min(width, span ?? 1) * subdivisions
    if (!pinned) {
      // Share unused columns between the automatic items in each old flow line.
      const line = row.filter(e => cells.get(e.id)!.y === y)
      const automatic = line.filter(e => !e.span)
      const spare = width - line.reduce((n, e) => n + Math.min(width, e.span ?? 1), 0)
      const extra = automatic.length ? subdivisions * spare / automatic.length : 0
      const before = automatic.filter(e => cells.get(e.id)!.x < x).length
      left += Math.round(before * extra)
      right += Math.round((before + (span ? 0 : 1)) * extra)
    }
    return { ...item, frame: { x: left, y: top, width: right - left, height: Math.floor((y + 1) * rowHeight) - top } }
  }))
  return { ...draft, defaultHeight, rows }
}

interface Props {
  rows: Item[][]
  width: number
  height: number
  flowWidth?: number
  render: (item: Item) => ReactNode
}

export function ElementLayout({ rows: sourceRows, width, height, flowWidth = width, render }: Props) {
  const rows = sourceRows.map(row => row.filter(item => item.kind !== 'integration')).filter(row => row.length)
  const items = rows.flat()
  if (items.every(e => e.frame)) {
    return <div className="fine-layout">{items.map(item =>
      <div key={item.id} className="fine-frame" data-divider={item.kind === 'divider' || undefined} style={frameStyle(item, width * subdivisions, height * subdivisions)}>
        {render(item)}
      </div>)}</div>
  }
  if (!rows.some(row => row.some(item => item.cell))) {
    return <div className="flow-layout">{rows.map((row, i) => <div className="built-row" key={i}>
      {row.map(item => <div className="built-cell" key={item.id} style={cellStyle(item, flowWidth)}>{render(item)}</div>)}
    </div>)}</div>
  }
  const cells = positions(rows, width)
  return <div className="placed-layout" style={{ '--columns': width, '--rows': height } as CSSProperties}>
    {rows.flatMap(row => row.map(item => {
      const cell = cells.get(item.id)!
      return <div className="built-cell" key={item.id} style={{ gridColumn: `${cell.x + 1} / span ${Math.min(width, item.span ?? 1)}`, gridRow: cell.y + 1 }}>
        {render(item)}
      </div>
    }))}
  </div>
}
