import type { WidgetInstance } from './plugin'

export const palettes = {
  white: 'Белый', black: 'Чёрный', green: 'Зелёный', red: 'Красный',
  purple: 'Фиолетовый', yellow: 'Жёлтый', orange: 'Оранжевый',
}
export type Palette = keyof typeof palettes

function palette(value: unknown, fallback: Palette): Palette {
  return typeof value === 'string' && Object.hasOwn(palettes, value) ? value as Palette : fallback
}

export function cardAppearance({ horizontalAlign, verticalAlign, titlePalette, cardPalette }: WidgetInstance['appearance']) {
  return {
    horizontalAlign: horizontalAlign === 'left' || horizontalAlign === 'center' || horizontalAlign === 'right'
      ? horizontalAlign : undefined,
    verticalAlign: verticalAlign === 'top' || verticalAlign === 'center' || verticalAlign === 'bottom'
      ? verticalAlign : undefined,
    titlePalette: palette(titlePalette, 'black'),
    cardPalette: palette(cardPalette, 'white'),
  }
}
