import { afterEach, expect, it, vi } from 'vitest'
import { loadPlayerBundle } from '../load-player-bundle.js'
afterEach(() => vi.unstubAllGlobals())
it('a later export reads a rebuilt player instead of retaining the old runtime', async () => {
  vi.stubGlobal('document', { baseURI: 'https://example.test/' })
  let version = 'v1'
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => version })))
  expect(await loadPlayerBundle()).toEqual({ js: 'v1', css: 'v1' })
  version = 'v2'
  expect(await loadPlayerBundle()).toEqual({ js: 'v2', css: 'v2' })
})
