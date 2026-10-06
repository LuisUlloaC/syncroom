import {describe, expect, it} from 'vitest'
import {browserCandidates, locateBrowser} from './browser-locator'

const WIN_ENV = {
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local'
}

const only = (...paths: string[]) => async (path: string) => paths.includes(path)

describe('browserCandidates', () => {
  it('lists Edge first on Windows, then Chrome and Brave', () => {
    const list = browserCandidates('win32', WIN_ENV)
    expect(list[0]).toBe('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
    expect(list).toContain('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')
    expect(list).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    expect(list).toContain('C:\\Users\\ana\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    expect(list).toContain('C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe')
  })

  it('skips Windows folders whose variable is missing', () => {
    const list = browserCandidates('win32', {ProgramFiles: 'C:\\Program Files'})
    expect(list.length).toBeGreaterThan(0)
    expect(list.every(path => path.startsWith('C:\\Program Files\\'))).toBe(true)
  })

  it('lists application bundles on macOS', () => {
    expect(browserCandidates('darwin', {})).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ])
  })

  it('searches PATH on Linux, preferring Chrome', () => {
    const list = browserCandidates('linux', {PATH: '/usr/bin:/snap/bin'})
    expect(list[0]).toBe('/usr/bin/google-chrome')
    expect(list).toContain('/snap/bin/chromium')
    expect(list).toContain('/usr/bin/microsoft-edge')
    expect(list).toContain('/usr/bin/brave-browser')
    expect(browserCandidates('linux', {})).toEqual([])
  })
})

describe('locateBrowser', () => {
  it('returns the first candidate that exists', async () => {
    const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    expect(await locateBrowser({platform: 'win32', env: WIN_ENV, exists: only(chrome)})).toBe(chrome)
  })

  it('returns undefined when nothing is installed', async () => {
    expect(await locateBrowser({platform: 'win32', env: WIN_ENV, exists: only()})).toBeUndefined()
  })

  it('uses the configured path when it exists', async () => {
    const custom = 'D:\\Apps\\Vivaldi\\vivaldi.exe'
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    expect(await locateBrowser({configured: custom, platform: 'win32', env: WIN_ENV, exists: only(custom, edge)})).toBe(custom)
  })

  it('does not fall back when the configured path is missing', async () => {
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    expect(
      await locateBrowser({configured: 'D:\\gone.exe', platform: 'win32', env: WIN_ENV, exists: only(edge)})
    ).toBeUndefined()
  })

  it('treats a blank configured path as not configured', async () => {
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    expect(await locateBrowser({configured: '   ', platform: 'win32', env: WIN_ENV, exists: only(edge)})).toBe(edge)
  })
})
