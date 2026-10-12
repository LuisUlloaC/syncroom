import {URI} from 'vscode-uri'
import {describe, expect, it} from 'vitest'
import {MAX_URL, issueUrl, redactLine, type BugReport} from './bug-report'

const NEW_ISSUE = 'https://github.com/LuisUlloaC/syncroom/issues/new'

/** Lo que hace VS Code al abrir un Uri en el navegador: `encodeURI(uri.toString(true))`. */
const throughOpenExternal = (url: string): string => encodeURI(URI.parse(url).toString(true))
const read = (url: string): URLSearchParams => new URL(url).searchParams

const report = (over: Partial<BugReport> = {}): BugReport => ({
  newIssueUrl: NEW_ISSUE,
  title: 'The audio engine keeps failing',
  environment: [
    ['SyncRoom', '0.8.2'],
    ['VS Code', '1.141.0'],
    ['OS', 'win32 10.0.26200 x64']
  ],
  log: ['14:52:00 engine trouble: giving up after 3 restarts'],
  ...over
})

describe('redactLine', () => {
  it('hides the user name in Windows, macOS and Linux paths, and the home folder', () => {
    expect(
      redactLine(
        '14:51:58 launching engine (hidden): --user-data-dir=c:\\Users\\Edes\\AppData\\Roaming\\Code\\User\\globalStorage\\luisulloac.syncroom\\engine-profile-1-aa',
        'C:\\Users\\Edes'
      )
    ).toBe('14:51:58 launching engine (hidden): --user-data-dir=~\\AppData\\Roaming\\Code\\User\\globalStorage\\luisulloac.syncroom\\engine-profile-1-aa')
    expect(redactLine('browser D:\\Users\\Ana López\\Apps\\chrome.exe', undefined)).toBe('browser D:\\Users\\<user>\\Apps\\chrome.exe')
    expect(redactLine('could not start: /home/edes/.config/x and /Users/ana/Library/y', undefined)).toBe(
      'could not start: /home/<user>/.config/x and /Users/<user>/Library/y'
    )
  })

  it('hides room codes, which would let anyone join a private room', () => {
    expect(redactLine('14:51:56 room ZSAZ7S4S: joined from Open rooms, relays only', undefined)).toBe(
      '14:51:56 room <code>: joined from Open rooms, relays only'
    )
    expect(redactLine('copied ZSAZ-7S4S', undefined)).toBe('copied <code>')
  })

  it('leaves ordinary lines alone', () => {
    expect(redactLine('14:52:00 engine process exited (code 0)', undefined)).toBe('14:52:00 engine process exited (code 0)')
  })
})

describe('issueUrl', () => {
  it('opens a new issue with the title, environment and the log in a code block', () => {
    const params = read(throughOpenExternal(issueUrl(report())))
    expect(params.get('title')).toBe('The audio engine keeps failing')
    const body = params.get('body') ?? ''
    expect(body).toContain('- SyncRoom: 0.8.2')
    expect(body).toContain('- OS: win32 10.0.26200 x64')
    expect(body).toContain('```text\n14:52:00 engine trouble: giving up after 3 restarts\n```')
  })

  it('survives VS Code re-encoding the link: ? & + # are replaced by look-alikes', () => {
    const url = issueUrl(report({title: 'Engine & player #1?', log: ['http://localhost:7015/?t=… a+b & c #2 100%']}))
    const params = read(throughOpenExternal(url))
    expect(params.get('title')).toBe('Engine ＆ player ＃1？')
    expect(params.get('body')).toContain('http://localhost:7015/？t=… a＋b ＆ c ＃2 100%')
    expect([...params.keys()].sort()).toEqual(['body', 'labels', 'title'])
  })

  it('drops the oldest log lines to stay under the URL limit, and says so', () => {
    const log = Array.from({length: 400}, (_, i) => `14:00:00 line ${i} ${'x'.repeat(60)}`)
    const url = issueUrl(report({log}))
    expect(url.length).toBeLessThanOrEqual(MAX_URL)
    expect(throughOpenExternal(url).length).toBeLessThanOrEqual(MAX_URL + 200)
    const body = read(throughOpenExternal(url)).get('body') ?? ''
    expect(body).toContain('line 399')
    expect(body).not.toContain('line 0 ')
    expect(body).toMatch(/last \d+ of 400 lines/)
  })

  it('says when there is no log yet', () => {
    expect(read(issueUrl(report({log: []}))).get('body')).toContain('(empty)')
  })
})
