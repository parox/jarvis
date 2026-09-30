import test from 'node:test'
import assert from 'node:assert/strict'
import { tsImport } from 'tsx/esm/api'
const { getMic, microphoneError } = await tsImport('../src/lib/audio.ts', import.meta.url)

test('microphone failures distinguish permission, hardware and unsupported capture', () => {
  assert.match(microphoneError({ name: 'NotAllowedError' }), /access blocked/)
  assert.match(microphoneError({ name: 'NotFoundError' }), /No audio input/)
  assert.match(microphoneError({ name: 'NotReadableError' }), /could not start/)
  assert.match(microphoneError({ name: 'NotSupportedError' }), /directly in Chrome/)
})

test('microphone capture shares pending requests and replaces ended tracks', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  t.after(() => { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator })
  let requests = 0
  let state = 'live'
  const first = { getAudioTracks: () => [{ readyState: state }] }
  const second = { getAudioTracks: () => [{ readyState: 'live' }] }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getUserMedia: async () => { requests++; return requests === 1 ? first : second },
  } } })
  const streams = await Promise.all([getMic(), getMic()])
  assert.equal(requests, 1)
  assert.equal(streams[0], streams[1])
  assert.equal(await getMic(), first)
  state = 'ended'
  assert.equal(await getMic(), second)
  assert.equal(requests, 2)
})
