import type { ElementProps } from '@terminal/element'

export default function BrowserView({ properties, language }: ElementProps) {
  const ru = language === 'ru'
  let url: URL | null = null
  try {
    const parsed = new URL(String(properties.url))
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) url = parsed
  } catch { /* Invalid address: render no link or native view. */ }
  const zoom = Number(properties.zoom)
  return <div style={{display:'flex', flexDirection:'column', width:'100%',height:'100%',gap:4,minHeight:0}}>
    {url ? <>
      <a href={url.href} target="_blank" rel="noopener noreferrer"
        style={{alignSelf:'flex-end',fontSize:12,padding:'2px 4px',color:'inherit'}}>
        {ru ? 'Открыть отдельно ↗' : 'Open externally ↗'}
      </a>
      <div data-terminal-browser={url.href} data-browser-zoom={Number.isFinite(zoom) ? zoom : 1}
        style={{flex:1,minHeight:0,display:'grid',placeItems:'center',textAlign:'center',padding:8,boxSizing:'border-box',border:'1px solid currentColor',borderRadius:4}}>
        <span style={{fontSize:13}}>{ru ? 'Откройте сайт по ссылке выше или запустите панель в Electron.' : 'Use the link above or launch the dashboard in Electron.'}</span>
      </div>
    </> : <span>{ru ? 'Укажите корректный HTTPS-адрес.' : 'Enter a valid HTTPS address.'}</span>}
  </div>
}
