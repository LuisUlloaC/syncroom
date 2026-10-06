import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

const root = process.cwd()
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

const provided = [...read('src/host/ui/strings.ts').matchAll(/'([a-z]+\.[A-Za-z]+)':/g)].map(m => m[1] ?? '').sort()

const used = [
  ...new Set(
    readdirSync(join(root, 'src/webview'))
      .filter(name => /\.tsx?$/.test(name) && !name.includes('.test.'))
      .flatMap(name => [...read(`src/webview/${name}`).matchAll(/\bs\('([^']+)'\)/g)].map(m => m[1] ?? ''))
  )
].sort()

describe('webview strings', () => {
  it('uses only keys that the host provides', () => {
    expect(used.length).toBeGreaterThan(20)
    for (const key of used) expect(provided, `unknown key: ${key}`).toContain(key)
  })

  it('uses every key the host provides', () => {
    expect(used).toEqual(provided)
  })

  it('the preview page defines every key', () => {
    const preview = read('src/webview/preview.html')
    for (const key of provided) expect(preview, `preview is missing: ${key}`).toContain(`'${key}'`)
  })
})
