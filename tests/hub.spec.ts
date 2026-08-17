import { describe, expect, it } from 'vitest'
import { catalogMatches, classifyGhFailure, HUB_CATALOG_GH_ARGS, parseHubCatalogText } from '../src/hub.ts'

describe('hub catalog parsing and matching (#3)', () => {
  it('uses raw Accept media type for large public catalog', () => {
    expect(HUB_CATALOG_GH_ARGS).toEqual([
      'api',
      'repos/omdsh-dev/dsh-hub-workshop/contents/catalog.json',
      '-H',
      'Accept: application/vnd.github.raw+json',
    ])
    expect(HUB_CATALOG_GH_ARGS).not.toContain('-q')
    expect(classifyGhFailure({ code: 'ENOBUFS' }, '')).toBe('response-too-large')
  })

  it('parses current dsh-hub-index/v0.4 packages and matches owner/repo', () => {
    const catalog = parseHubCatalogText(JSON.stringify({
      schema: 'dsh-hub-index/v0.4',
      packages: [{ id: 'omdsh-dev/dsh-tool-csv', repository: 'https://github.com/omdsh-dev/dsh-tool-csv' }],
    }))
    expect(catalog).not.toBeNull()
    expect(catalogMatches(catalog!, 'omdsh-dev/dsh-tool-csv')).toBe(true)
    expect(catalogMatches(catalog!, 'other/dsh-tool-csv')).toBe(false)
    expect(catalogMatches(catalog!, 'dsh-tool-csv')).toBe(true)
  })

  it('matches current entries by repository URL and supports basename fallback', () => {
    const catalog = parseHubCatalogText(JSON.stringify({
      schema: 'dsh-hub-index/v0.4',
      packages: [{ id: 'csv', repository: 'https://github.com/omdsh-dev/dsh-tool-csv' }],
    }))
    expect(catalogMatches(catalog!, 'omdsh-dev/dsh-tool-csv')).toBe(true)
    expect(catalogMatches(catalog!, 'dsh-tool-csv')).toBe(true)
  })

  it('keeps compatibility with legacy repos-by-name catalogs', () => {
    const catalog = parseHubCatalogText(JSON.stringify({ repos: [{ name: 'dsh-tool-csv' }] }))
    expect(catalogMatches(catalog!, 'omdsh-dev/dsh-tool-csv')).toBe(true)
    expect(catalogMatches(catalog!, 'dsh-tool-csv')).toBe(true)
  })

  it('rejects malformed JSON and schemas', () => {
    expect(parseHubCatalogText('{')).toBeNull()
    expect(parseHubCatalogText(JSON.stringify({ schema: 'wrong', packages: [] }))).toBeNull()
    expect(parseHubCatalogText(JSON.stringify({ packages: [{ name: 'missing-id' }] }))).toBeNull()
  })
})
