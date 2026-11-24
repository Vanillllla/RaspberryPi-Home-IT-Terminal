const net = require('node:net')

function externalUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !host.includes('.') || net.isIP(host.replace(/^\[|\]$/g, '')) ||
        /\.(localhost|local|internal|test|invalid|home|lan)\.?$/.test(host) ||
        host.endsWith('.')) return null
    return url
  } catch { return null }
}

const chatAuth = new Set(['chatgpt.com', 'www.chatgpt.com', 'auth.openai.com',
  'auth0.openai.com', 'accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com'])

function navigationAllowed(initial, target) {
  const a = externalUrl(initial), b = externalUrl(target)
  if (!a || !b) return false
  return a.origin === b.origin ||
    (['chatgpt.com', 'www.chatgpt.com'].includes(a.hostname) && chatAuth.has(b.hostname))
}

function parseRegion(value, size, factor = 1) {
  if (!value || typeof value !== 'object' || !/^[0-9]+:[A-Za-z][A-Za-z0-9_]*$/.test(value.key) ||
      typeof value.key !== 'string' || value.key.length > 128) return null
  const url = externalUrl(value.url)
  if (!url || !Number.isFinite(value.zoom) || value.zoom < 0.5 || value.zoom > 2 ||
      !Number.isFinite(factor) || factor <= 0) return null
  const r = value.rect
  if (!r || !['x','y','width','height'].every(k => typeof r[k] === 'number' && Number.isFinite(r[k]))) return null
  const x = Math.ceil(r.x * factor), y = Math.ceil(r.y * factor)
  const right = Math.floor((r.x + r.width) * factor), bottom = Math.floor((r.y + r.height) * factor)
  if (x < 0 || y < 0 || right > size.width || bottom > size.height || right-x < 64 || bottom-y < 64) return null
  return {key: value.key, url: url.href, zoom: value.zoom, bounds: {x,y,width:right-x,height:bottom-y}}
}

module.exports = { externalUrl, navigationAllowed, parseRegion }
