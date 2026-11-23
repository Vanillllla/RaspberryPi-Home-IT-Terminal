import type { WidgetInstance } from './engine/model'

export function placementError(widgets: WidgetInstance[], columns: number, rows: number,
  id: number, x: number, y: number, width: number, height: number) {
  if (x < 0 || y < 0 || x + width > columns || y + height > rows)
    return 'Прямоугольник выходит за границы сетки'
  const overlaps = widgets.some(other => {
    const ox = other.slot % columns, oy = Math.floor(other.slot / columns)
    return other.id !== id && x < ox + other.width && ox < x + width &&
      y < oy + other.height && oy < y + height
  })
  return overlaps ? 'Часть прямоугольника занята другим виджетом' : null
}
