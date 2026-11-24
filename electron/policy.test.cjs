const { test } = require('node:test')
const assert = require('node:assert/strict')
const { externalUrl, navigationAllowed, parseRegion } = require('./policy.cjs')
test('only explicit external HTTPS URLs', () => {
  assert.equal(externalUrl('https://chatgpt.com').href, 'https://chatgpt.com/')
  for (const url of ['http://chatgpt.com','file:///etc/passwd','https://localhost','https://127.0.0.1','https://[::1]','https://a.local','https://chatgpt.com@evil.com','https://example.com:8443','javascript:alert(1)']) assert.equal(externalUrl(url), null, url)
})
test('main-frame redirects are restricted to initial origin and known ChatGPT login hosts', () => {
  assert.equal(navigationAllowed('https://chatgpt.com','https://auth.openai.com/login'),true)
  assert.equal(navigationAllowed('https://chatgpt.com','https://evil.example.com'),false)
  assert.equal(navigationAllowed('https://example.com','https://example.com/next'),true)
  assert.equal(navigationAllowed('https://example.com','https://chatgpt.com'),false)
})
test('reject out-of-window and malformed native rectangles', () => {
  const region = {key:'10:browser',url:'https://chatgpt.com/',zoom:1,rect:{x:10,y:20,width:300,height:400}}
  const size = {width:800,height:600}
  assert.deepEqual(parseRegion(region,size).bounds,region.rect)
  assert.equal(parseRegion({...region,rect:{...region.rect,x:-1}},size),null)
  assert.equal(parseRegion({...region,rect:{...region.rect,width:Infinity}},size),null)
  assert.equal(parseRegion({...region,zoom:5},size),null)
  assert.equal(parseRegion({...region,key:'invalid'},size),null)
  assert.equal(parseRegion(region,size,2),null)
})
