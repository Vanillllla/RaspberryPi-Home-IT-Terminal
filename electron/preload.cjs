const { ipcRenderer } = require('electron')
const channel = 'terminal:browser-regions'

// No Electron API is exposed to dashboard JavaScript or remote web pages.
// Only live card placeholders are considered, not the designer or its preview.
function scan() {
  const result = []
  if (!document.hidden && !document.querySelector('dialog[open], .board.moving')) {
    for (const node of document.querySelectorAll('[data-terminal-browser]')) {
      const tile = node.closest('.tile[data-widget]')
      const engine = node.closest('[data-element]')
      if (!tile || !engine || node.closest('[inert], .designing, .adjacent, [data-transfer]')) continue
      const track = node.closest('.page-track')
      if (track && getComputedStyle(track).transform !== 'none') continue
      const r = node.getBoundingClientRect()
      if (r.width < 64 || r.height < 64 || r.left < 0 || r.top < 0 ||
          r.right > innerWidth || r.bottom > innerHeight) continue
      // Native child views cannot be clipped by CSS or layered behind DOM overlays.
      // Hide partially clipped/covered regions instead of painting over other controls.
      let clipped = false
      for (let p = node.parentElement; p; p=p.parentElement) {
        const s = getComputedStyle(p), b = p.getBoundingClientRect()
        if (s.visibility !== 'visible' || s.opacity === '0' ||
          (s.overflowX !== 'visible' && (r.left < b.left-1 || r.right > b.right+1)) ||
          (s.overflowY !== 'visible' && (r.top < b.top-1 || r.bottom > b.bottom+1))) {clipped=true;break}
      }
      if (clipped) continue
      const points = [[r.left+2,r.top+2],[r.right-2,r.top+2],[r.left+2,r.bottom-2],
        [r.right-2,r.bottom-2],[r.left+r.width/2,r.top+r.height/2]]
      if (points.some(([x,y])=>!node.contains(document.elementFromPoint(x,y)))) continue
      result.push({key:tile.dataset.widget+':'+engine.dataset.element,url:node.dataset.terminalBrowser,
        zoom:Number(node.dataset.browserZoom),rect:{x:r.x,y:r.y,width:r.width,height:r.height}})
      if (result.length >= 3) break
    }
  }
  ipcRenderer.send(channel,result)
}
window.addEventListener('DOMContentLoaded',()=>{
  scan()
  let queued=false
  const schedule=()=>{ if (!queued) {queued=true;requestAnimationFrame(()=>{queued=false;scan()})} }
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true})
  window.addEventListener('scroll',schedule,true)
  window.addEventListener('resize',schedule)
  document.addEventListener('visibilitychange',scan)
  setInterval(scan,100)
})
window.addEventListener('pagehide',()=>ipcRenderer.send(channel,[]))
