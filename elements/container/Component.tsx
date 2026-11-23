import type { ElementProps } from '@terminal/element'

export default function Container({ children }: ElementProps) {
  return <div className="element-fill">{children}</div>
}
