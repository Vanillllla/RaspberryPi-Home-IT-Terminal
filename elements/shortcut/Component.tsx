import type { ElementProps } from '@terminal/element'

export default function Shortcut({ properties: p, asset, emit }: ElementProps) {
  let url: URL | undefined
  try { url = new URL(String(p.url)) } catch { /* An incomplete URL can be edited in the inspector. */ }
  const href = url && ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
  const icon = p.icon ? asset(String(p.icon)) : href && p.siteIcon ? new URL('/favicon.ico', href).href : undefined
  return <a href={href} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8 }}
    onClick={() => emit('onClick')}>{icon && <img alt="" src={icon} width="24" height="24" referrerPolicy="no-referrer" />}
    {String(p.label) || href}</a>
}
