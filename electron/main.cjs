const { app, BrowserWindow, WebContentsView, ipcMain, session, shell } = require('electron')
const path = require('node:path')
const { externalUrl, navigationAllowed, parseRegion } = require('./policy.cjs')

const dashboard = 'http://127.0.0.1:5173/'
const origin = new URL(dashboard).origin
const channel = 'terminal:browser-regions'
const maxViews = 3
let win, externalSession, watchdog
const views = new Map()

function hide(entry) {
  if (entry.visible) {
    entry.view.setVisible(false)
    entry.visible = false
  }
}
function hideAll() { for (const entry of views.values()) hide(entry) }
function destroy(key) {
  const entry = views.get(key)
  if (!entry) return
  views.delete(key)
  if (win && !win.isDestroyed()) win.contentView.removeChildView(entry.view)
  if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
}
function clearViews() { for (const key of [...views.keys()]) destroy(key) }

function createView(region) {
  const view = new WebContentsView({webPreferences:{
    session: externalSession, sandbox: true, contextIsolation: true,
    nodeIntegration: false, webSecurity: true, webviewTag: false,
    allowRunningInsecureContent: false
  }})
  const entry = {view, url:region.url, zoom:region.zoom, visible:false, failed:false, used:Date.now(), bounds:null}
  view.setVisible(false)
  win.contentView.addChildView(view)
  views.set(region.key,entry)
  const contents = view.webContents
  const fail = () => { entry.failed = true; hide(entry) }
  const guard = (event, url) => {
    if (event.isMainFrame === false) return
    if (!navigationAllowed(entry.url,event.url ?? url)) event.preventDefault()
  }
  contents.on('will-navigate',guard)
  contents.on('will-redirect',guard)
  contents.setWindowOpenHandler(() => ({action:'deny'}))
  contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) fail()
  })
  contents.on('render-process-gone',fail)
  contents.setZoomFactor(region.zoom)
  contents.loadURL(region.url).catch(fail)
  return entry
}

function updateRegions(event, payload) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame) return
  try { if (new URL(event.senderFrame.url).origin !== origin) return } catch { return }
  clearTimeout(watchdog)
  watchdog = setTimeout(hideAll, 750)
  if (!Array.isArray(payload) || payload.length > 32 || !win.isVisible() || win.isMinimized()) {
    hideAll(); return
  }
  const [width,height] = win.getContentSize()
  const requested = new Map()
  for (const candidate of payload) {
    const region = parseRegion(candidate,{width,height},win.webContents.getZoomFactor())
    if (region && requested.size < maxViews) requested.set(region.key,region)
  }
  for (const [key,entry] of views) if (!requested.has(key)) hide(entry)
  for (const [key,region] of requested) {
    let entry = views.get(key)
    if (entry && entry.url !== region.url) { destroy(key); entry = undefined }
    if (!entry) {
      if (views.size >= maxViews) {
        const idle = [...views.entries()].filter(([k]) => !requested.has(k)).sort((a,b)=>a[1].used-b[1].used)[0]
        if (!idle) continue
        destroy(idle[0])
      }
      entry = createView(region)
    }
    if (entry.failed) continue
    entry.used = Date.now()
    if (entry.zoom !== region.zoom) { entry.view.webContents.setZoomFactor(region.zoom); entry.zoom = region.zoom }
    const bounds = JSON.stringify(region.bounds)
    if (entry.bounds !== bounds) { entry.view.setBounds(region.bounds); entry.bounds = bounds }
    if (!entry.visible) { entry.view.setVisible(true); entry.visible = true }
  }
}

function makeWindow() {
  win = new BrowserWindow({width:1280,height:800,autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,
      contextIsolation:true,nodeIntegration:false,webSecurity:true,webviewTag:false}})
  win.setMenu(null)
  const contents = win.webContents
  const guard = (event,url) => {
    if (event.isMainFrame === false) return
    try { if (new URL(event.url ?? url).origin === origin) return } catch {}
    event.preventDefault()
  }
  contents.on('will-navigate',guard)
  contents.on('will-redirect',guard)
  contents.setWindowOpenHandler(({url}) => {
    const target = externalUrl(url)
    if (target) void shell.openExternal(target.href).catch(console.error)
    return {action:'deny'}
  })
  contents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame) => { if (isMainFrame) hideAll() })
  contents.on('render-process-gone',hideAll)
  win.on('resize',hideAll)
  win.on('minimize',hideAll)
  win.on('hide',hideAll)
  win.on('close',()=>{clearTimeout(watchdog);clearViews()})
  win.on('closed',()=>{win=undefined})
  contents.loadURL(dashboard).catch(error=>{
    console.error('Start FastAPI and Vite first:',error.message)
    app.quit()
  })
}

app.whenReady().then(()=>{
  externalSession = session.fromPartition('persist:terminal-external-web')
  externalSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
  externalSession.setPermissionCheckHandler(()=>false)
  externalSession.on('will-download',event=>event.preventDefault())
  // Prevent ordinary web requests to explicit local addresses, IP literals and the dashboard.
  // This is not a network-level firewall or DNS-rebinding protection.
  externalSession.webRequest.onBeforeRequest((details,callback)=>{
    if (!/^https?:|^wss?:/i.test(details.url)) return callback({cancel:false})
    const normalized = details.url.replace(/^wss?:/i,'https:').replace(/^http:/i,'https:')
    callback({cancel:!externalUrl(normalized)})
  })
  ipcMain.on(channel,updateRegions)
  makeWindow()
})
app.on('window-all-closed',()=>app.quit())
