import type { CSSProperties, ReactNode } from 'react'
import { cellStyle, type Cell, type Item } from './model'

export function canPlace(item: Item, cell: Cell, items: Item[], width: number, height: number) {
  const end = cell.x + (item.span ?? 1)
  return cell.x >= 0 && cell.y >= 0 && end <= width && cell.y < height && !items.some(other =>
    other.id !== item.id && other.cell?.y === cell.y && other.cell.x < end &&
    other.cell.x + (other.span ?? 1) > cell.x)
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

interface Props {
  rows: Item[][]
  width: number
  height: number
  flowWidth?: number
  render: (item: Item, row: number) => ReactNode
}

export function ElementLayout({ rows, width, height, flowWidth = width, render }: Props) {
  if (!rows.some(row => row.some(item => item.cell))) {
    return <div className="flow-layout">{rows.map((row, i) => <div className="built-row" key={i}>
      {row.map(item => <div className="built-cell" key={item.id} style={cellStyle(item, flowWidth)}>{render(item, i)}</div>)}
    </div>)}</div>
  }
  const cells = positions(rows, width)
  return <div className="placed-layout" style={{ '--columns': width, '--rows': height } as CSSProperties}>
    {rows.flatMap((row, i) => row.map(item => {
      const cell = cells.get(item.id)!
      return <div className="built-cell" key={item.id} style={{ gridColumn: `${cell.x + 1} / span ${Math.min(width, item.span ?? 1)}`, gridRow: cell.y + 1 }}>
        {render(item, i)}
      </div>
    }))}
  </div>
}
