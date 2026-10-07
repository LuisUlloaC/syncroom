import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {DEFAULT_RELAYS} from '../protocol/defaults'

const root = process.cwd()
const read = (path: string): string => readFileSync(join(root, path), 'utf8')
const json = (path: string): Record<string, unknown> => JSON.parse(read(path)) as Record<string, unknown>

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), {withFileTypes: true}).flatMap(entry => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : []
  })
}

const hostSource = sourceFiles('src/host')
  .map(read)
  .join('\n')

/** Primer argumento de cada llamada t('...') del host. */
function translatable(): string[] {
  const found = new Set<string>()
  for (const match of hostSource.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
    found.add((match[1] ?? '').replace(/\\'/g, "'"))
  }
  return [...found].sort()
}

const placeholders = (text: string): string[] => [...text.matchAll(/\{\d+\}/g)].map(m => m[0]).sort()

interface Manifest {
  contributes: {
    commands: Array<{command: string; title: string}>
    configuration: {properties: Record<string, {scope?: string; default?: unknown}>}
  }
}

describe('translations', () => {
  const bundle = json('l10n/bundle.l10n.es.json')

  it('finds the translatable strings', () => {
    expect(translatable().length).toBeGreaterThan(30)
  })

  it('has a Spanish translation for every string, with the same placeholders', () => {
    for (const text of translatable()) {
      const translated = bundle[text]
      expect(typeof translated, `missing translation: ${text}`).toBe('string')
      expect(String(translated).trim(), `empty translation: ${text}`).not.toBe('')
      expect(placeholders(String(translated)), `placeholders differ: ${text}`).toEqual(placeholders(text))
    }
  })

  it('has no translations for strings that no longer exist', () => {
    expect(Object.keys(bundle).sort()).toEqual(translatable())
  })

  it('keeps package.nls.json and package.nls.es.json in step', () => {
    const base = json('package.nls.json')
    const spanish = json('package.nls.es.json')
    expect(Object.keys(spanish).sort()).toEqual(Object.keys(base).sort())
    for (const value of [...Object.values(base), ...Object.values(spanish)]) {
      expect(String(value).trim()).not.toBe('')
    }
  })

  it('defines every %key% used in package.json', () => {
    const base = json('package.nls.json')
    const used = [...read('package.json').matchAll(/"%([^%"]+)%"/g)].map(m => m[1] ?? '')
    expect(used.length).toBeGreaterThan(10)
    for (const key of used) expect(base[key], `missing nls key: ${key}`).toBeDefined()
  })
})

describe('manifest', () => {
  const manifest = json('package.json') as unknown as Manifest

  it('registers every contributed command', () => {
    const declared = manifest.contributes.commands.map(c => c.command).sort()
    const registered = [...hostSource.matchAll(/'(syncroom\.[A-Za-z]+)':/g)].map(m => m[1] ?? '').sort()
    expect(declared).toHaveLength(10)
    expect(registered).toEqual(declared)
  })

  it('does not let a workspace choose the browser binary', () => {
    expect(manifest.contributes.configuration.properties['syncroom.browserPath']?.scope).toBe('machine')
  })

  it('keeps every other setting at user level', () => {
    for (const key of ['syncroom.displayName', 'syncroom.directConnections', 'syncroom.relays']) {
      expect(manifest.contributes.configuration.properties[key]?.scope, key).toBe('application')
    }
  })

  it('ships the tested relays as the default', () => {
    expect(manifest.contributes.configuration.properties['syncroom.relays']?.default).toEqual(DEFAULT_RELAYS)
  })
})
