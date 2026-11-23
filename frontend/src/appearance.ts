import type { WidgetInstance } from './engine/model'

export const palettes = {
  white: 'Белый', black: 'Чёрный', green: 'Зелёный', red: 'Красный',
  purple: 'Фиолетовый', yellow: 'Жёлтый', orange: 'Оранжевый',
} as const
export type Palette = keyof typeof palettes

function palette(value: unknown, fallback: Palette): Palette {
  return typeof value === 'string' && Object.hasOwn(palettes, value) ? value as Palette : fallback
}

export function cardAppearance({ titlePalette, cardPalette, hideTitle, customTitle }: WidgetInstance['appearance']) {
  return {
    customTitle: typeof customTitle === 'string' ? customTitle : '',
    hideTitle: hideTitle === true,
    titlePalette: palette(titlePalette, 'black'),
    cardPalette: palette(cardPalette, 'white'),
  }
}
