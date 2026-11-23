import type { ReactNode } from 'react'
import type { Values, Lang } from './model'

/** Props are resolved from the manifest, project, and live instance, in that order. */
export interface ElementProps {
  id: string
  properties: Values
  language: Lang
  emit: (name: string, changes?: Values) => void
  asset: (filename: string) => string
  children?: ReactNode
}
