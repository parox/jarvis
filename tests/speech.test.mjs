import test from 'node:test'
import assert from 'node:assert/strict'
import { tsImport } from 'tsx/esm/api'
const { speechLanguage, speechServiceError } = await tsImport('../src/lib/speech.ts', import.meta.url)
test('speech language honors explicit Portuguese and falls back to browser language', () => {
  assert.equal(speechLanguage('pt-br', 'en-GB'), 'pt-BR')
  assert.equal(speechLanguage(undefined, 'pt-PT'), 'pt-PT')
  assert.equal(speechLanguage('invalid_locale', 'en-US'), 'en-US')
})
test('speech service failures are actionable while silence is not an error', () => {
  assert.match(speechServiceError('network'), /speech recognition service/)
  assert.match(speechServiceError('language-not-supported'), /selected speech language/)
  assert.equal(speechServiceError('no-speech'), null)
  assert.equal(speechServiceError('aborted'), null)
})
