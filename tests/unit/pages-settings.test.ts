import assert from 'node:assert/strict'
import { test } from 'node:test'

test('Pages ignores persistent credentials and only changes the in-memory key', async () => {
  const keyName = 'chat-demo:api-key'
  const storage = new Map([[keyName, 'legacy-fixture']])
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  })
  Object.assign(globalThis, { __COMPANION_PAGES__: true })
  const { isPagesDemo, setApiKey, useSettings } = await import('../../src/services/settings.js')

  assert.equal(isPagesDemo, true)
  assert.equal(useSettings.getState().apiKey, null)
  setApiKey('temporary-fixture')
  assert.equal(useSettings.getState().apiKey, 'temporary-fixture')
  assert.equal(storage.get(keyName), 'legacy-fixture')
  setApiKey(null)
  assert.equal(useSettings.getState().apiKey, null)
  assert.equal(storage.get(keyName), 'legacy-fixture')
})
