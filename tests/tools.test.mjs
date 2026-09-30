import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { displayServer } from '../bridge/panels.mjs'
import { chromeServer } from '../bridge/chrome.mjs'

async function connect(t, server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'security-test', version: '1.0.0' })
  await server.instance.connect(serverTransport)
  await client.connect(clientTransport)
  t.after(async () => { await client.close(); await server.instance.close() })
  return client
}

test('display cannot start the camera without policy opt-in', async (t) => {
  const blades = []
  const client = await connect(t, displayServer(() => {}, (b) => blades.push(b)))
  const result = await client.callTool({ name: 'blade', arguments: { kind: 'camera', title: 'camera' } })
  assert.equal(result.isError, true)
  assert.deepEqual(blades, [])
  const markup = await client.callTool({ name: 'blade', arguments: { kind: 'markup', html: '<p>test</p>', title: 'test', mode: 'live' } })
  assert.equal(markup.isError, undefined)
  assert.equal(blades[0].mode, 'reader')
})

test('camera opt-in enables display explicitly', async (t) => {
  const blades = []
  const client = await connect(t, displayServer(() => {}, (b) => blades.push(b), { camera: true }))
  const result = await client.callTool({ name: 'blade', arguments: { kind: 'camera', title: 'camera' } })
  assert.equal(result.isError, undefined)
  assert.equal(blades[0].kind, 'camera')
})

test('Chrome server exposes only existing-tab reading tools, without connecting to real Chrome', async (t) => {
  const client = await connect(t, chromeServer())
  const result = await client.listTools()
  const names = result.tools.map((tool) => tool.name).sort()
  assert.deepEqual(names, ['chrome_find', 'chrome_page_text', 'chrome_read_page', 'chrome_screenshot', 'chrome_scroll', 'chrome_status', 'chrome_tabs'])
})
