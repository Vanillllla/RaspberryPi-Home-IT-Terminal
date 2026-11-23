import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

test('an unsaved project preserves geometry and reconciles input with its Python handler', async t => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('terminal-language', 'en'))
  await page.goto(process.env.TERMINAL_UI_URL || 'http://localhost:5173')
  await page.getByRole('button', { name: 'Create widget', exact: true }).click()

  const dialog = page.getByRole('dialog')
  const palette = dialog.locator('.palette')
  const tree = dialog.locator('.element-tree')
  const inspector = dialog.locator('.inspector')
  await palette.getByRole('button', { name: 'Switch', exact: true }).click()
  await palette.getByRole('button', { name: 'Text', exact: true }).click()
  await inspector.getByLabel('Y', { exact: true }).fill('80')
  await inspector.getByLabel('Text', { exact: true }).fill('')

  const node = dialog.locator('[data-element="text1"]')
  const original = await node.boundingBox()
  await tree.getByRole('button', { name: 'widget', exact: true }).click()
  await inspector.getByLabel('Height, cells').fill('4')
  const resized = await node.boundingBox()
  assert.deepEqual([resized.width, resized.height], [original.width, original.height])

  await tree.getByRole('button', { name: 'switch1 Switch' }).click()
  await inspector.getByLabel('onChange', { exact: true }).fill('record_input')
  await inspector.getByRole('button', { name: 'Create function' }).click()
  const editor = dialog.getByLabel('Python module')
  const scaffold = await editor.inputValue()
  assert.match(scaffold, /def record_input\(ctx\):\n    pass/)
  await editor.fill(scaffold.replace('    pass', [
    '    bit = "1" if ctx.get("switch1", "value") else "0"',
    '    ctx.set("text1", "text", ctx.get("text1", "text") + bit)',
  ].join('\n')))
  await dialog.getByRole('button', { name: 'Check Python' }).click()
  await dialog.getByText('Syntax and bindings checked').waitFor()
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click()
  const control = dialog.getByRole('switch', { name: 'Switch' })
  await control.waitFor()

  const rejection = Promise.withResolvers()
  await page.route('**/api/preview', async route => {
    await rejection.promise
    await route.fulfill({ status: 422, json: { detail: 'Rejected test input' } })
  }, { times: 1 })
  await control.check()
  assert.equal(await control.isChecked(), true)
  rejection.resolve()
  await dialog.getByRole('alert').getByText('Rejected test input').waitFor()
  assert.equal(await control.isChecked(), false)

  const acknowledgement = Promise.withResolvers()
  await page.route('**/api/preview', async route => {
    await acknowledgement.promise
    await route.continue()
  }, { times: 1 })
  await control.check()
  await control.uncheck()
  await control.check()
  acknowledgement.resolve()
  await dialog.locator('.preview-view').getByText('101', { exact: true }).waitFor()
  assert.equal(await control.isChecked(), true)
  assert.deepEqual(errors, [])
})
