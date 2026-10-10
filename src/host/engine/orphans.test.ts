import {spawn} from 'node:child_process'
import {mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  cleanupLeftovers,
  findOrphans,
  isAlive,
  listProcesses,
  parsePsProcesses,
  parseWindowsProcesses,
  staleProfiles,
  type ProcessInfo
} from './orphans'

const ROOT = join('C:', 'Users', 'Luis', 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'luisulloac.syncroom')
const OWN = 33864
const LIVE_OTHER_HOST = 5000
const owner = {ownPid: OWN, isAlive: (pid: number) => pid === OWN || pid === LIVE_OTHER_HOST}
const query = {...owner, root: ROOT, ignoreCase: true}
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

describe('parseWindowsProcesses', () => {
  it('reads the ConvertTo-Json array', () => {
    const json = JSON.stringify([
      {ProcessId: 10, CommandLine: `"${edge}" --user-data-dir=x`},
      {ProcessId: 11, CommandLine: null},
      {ProcessId: 'x', CommandLine: 'bad'}
    ])
    expect(parseWindowsProcesses(json)).toEqual([{pid: 10, command: `"${edge}" --user-data-dir=x`}])
  })

  it('reads the single object ConvertTo-Json gives for one process', () => {
    expect(parseWindowsProcesses('{"ProcessId":7,"CommandLine":"a b"}\r\n')).toEqual([{pid: 7, command: 'a b'}])
  })

  it('gives nothing for empty or broken output', () => {
    expect(parseWindowsProcesses('')).toEqual([])
    expect(parseWindowsProcesses('  \r\n')).toEqual([])
    expect(parseWindowsProcesses('Get-CimInstance : error')).toEqual([])
    expect(parseWindowsProcesses('42')).toEqual([])
  })
})

describe('parsePsProcesses', () => {
  it('reads pid and full command, keeping spaces inside it', () => {
    const text = '    1 /sbin/launchd\n  812 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/x y\n\n'
    expect(parsePsProcesses(text)).toEqual([
      {pid: 1, command: '/sbin/launchd'},
      {pid: 812, command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/x y'}
    ])
  })

  it('skips lines without a pid', () => {
    expect(parsePsProcesses('garbage\n  \n')).toEqual([])
  })
})

describe('findOrphans', () => {
  const profile = (name: string): string => join(ROOT, name)
  const proc = (pid: number, command: string): ProcessInfo => ({pid, command})

  it('finds the engine left by this host (the bug: same pid, 0.7.0 profile) and by dead hosts', () => {
    const processes = [
      proc(100, `"${edge}" --user-data-dir=${profile('engine-profile-33864')} --headless=new http://localhost:1/`),
      proc(101, `"${edge}" --type=renderer --user-data-dir="${profile('engine-profile-777-0a1b2c3d')}" --lang=es`),
      proc(102, `"${edge}" --user-data-dir=${profile('engine-profile-33864-deadbeef')}`)
    ]
    expect(findOrphans(processes, query)).toEqual([100, 101, 102])
  })

  it('leaves alone the engine of another VS Code window that is still running', () => {
    const processes = [proc(200, `"${edge}" --user-data-dir=${profile('engine-profile-5000-abcdef12')}`)]
    expect(findOrphans(processes, query)).toEqual([])
  })

  it('never matches the normal browser or engine-profile folders outside this extension', () => {
    const processes = [
      proc(300, `"${edge}" --single-argument https://youtube.com`),
      proc(301, `"${edge}" --user-data-dir=C:\\temp\\engine-profile-777`),
      proc(302, `"${edge}" --user-data-dir=${join(ROOT, '..', 'other.extension', 'engine-profile-777')}`),
      proc(303, `"${edge}" --user-data-dir=${join(ROOT, 'not-an-engine-profile-777')}`),
      proc(304, `"${edge}" --user-data-dir=${profile('engine-profile-')}`)
    ]
    expect(findOrphans(processes, query)).toEqual([])
  })

  it('compares paths ignoring case only where the system does (Windows)', () => {
    const shouted = [proc(400, `"${edge}" --user-data-dir=${profile('engine-profile-777').toUpperCase()}`)]
    expect(findOrphans(shouted, query)).toEqual([400])
    expect(findOrphans(shouted, {...query, ignoreCase: false})).toEqual([])
  })

  it('never returns this host itself', () => {
    expect(findOrphans([proc(OWN, `node --x=${profile('engine-profile-777')}`)], query)).toEqual([])
  })

  it('looks at every profile path in a command line', () => {
    const command = `x ${profile('engine-profile-5000')} y ${profile('engine-profile-777')}`
    expect(findOrphans([proc(500, command)], query)).toEqual([500])
  })
})

describe('staleProfiles', () => {
  it('keeps the profiles of running hosts and anything that is not a profile', () => {
    const names = ['engine-profile-33864', 'engine-profile-33864-0a1b2c3d', 'engine-profile-777-ffffffff', 'engine-profile-5000-12345678', 'state.json', 'engine-profile-x']
    expect(staleProfiles(names, owner)).toEqual(['engine-profile-33864', 'engine-profile-33864-0a1b2c3d', 'engine-profile-777-ffffffff'])
  })
})

describe('isAlive', () => {
  it('knows this process is alive and a made-up one is not', () => {
    expect(isAlive(process.pid)).toBe(true)
    expect(isAlive(2 ** 30)).toBe(false)
  })
})

describe('cleanupLeftovers', () => {
  let root: string | undefined

  afterEach(async () => {
    if (root !== undefined) await rm(root, {recursive: true, force: true})
    root = undefined
  })

  async function makeRoot(names: string[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'syncroom-orphans-'))
    root = dir
    for (const name of names) await mkdir(join(dir, name))
    await writeFile(join(dir, 'state.json'), '{}')
    return dir
  }

  it('kills the orphans, then removes stale profiles but not live ones nor the one being launched', async () => {
    const dir = await makeRoot(['engine-profile-777', 'engine-profile-33864-aaaaaaaa', 'engine-profile-33864-bbbbbbbb', 'engine-profile-5000-cccccccc'])
    const killed: number[] = []
    const logs: string[] = []
    await cleanupLeftovers({
      ...owner,
      root: dir,
      ignoreCase: process.platform === 'win32',
      list: () =>
        Promise.resolve([
          {pid: 900, command: `edge --user-data-dir=${join(dir, 'engine-profile-777')}`},
          {pid: 901, command: `edge --user-data-dir=${join(dir, 'engine-profile-5000-cccccccc')}`},
          {pid: 902, command: 'edge https://youtube.com'}
        ]),
      kill: pid => killed.push(pid),
      inUse: name => name === 'engine-profile-33864-bbbbbbbb',
      log: text => logs.push(text)
    })
    expect(killed).toEqual([900])
    expect((await readdir(dir)).sort()).toEqual(['engine-profile-33864-bbbbbbbb', 'engine-profile-5000-cccccccc', 'state.json'])
    expect(logs).toEqual(['stopped 1 orphaned engine process', 'removed 2 of 2 stale engine profiles'])
  })

  it('never rejects: listing and killing failures are logged and profiles are still cleaned', async () => {
    const dir = await makeRoot(['engine-profile-777'])
    const logs: string[] = []
    await cleanupLeftovers({
      ...owner,
      root: dir,
      ignoreCase: false,
      list: () => Promise.reject(new Error('powershell timed out')),
      kill: () => undefined,
      inUse: () => false,
      log: text => logs.push(text)
    })
    expect(logs[0]).toBe('could not look for orphaned engines (powershell timed out)')
    expect(await readdir(dir)).toEqual(['state.json'])

    const killLogs: string[] = []
    await cleanupLeftovers({
      ...owner,
      root: dir,
      ignoreCase: false,
      list: () => Promise.resolve([{pid: 900, command: `edge ${join(dir, 'engine-profile-777')}`}]),
      kill: () => {
        throw new Error('EPERM')
      },
      inUse: () => false,
      log: text => killLogs.push(text)
    })
    expect(killLogs).toEqual(['could not stop orphaned engine process 900 (EPERM)', 'stopped 0 orphaned engine processes'])
  })

  it('tolerates a storage folder that does not exist yet', async () => {
    await expect(
      cleanupLeftovers({
        ...owner,
        root: join(tmpdir(), 'syncroom-orphans-missing-folder'),
        ignoreCase: false,
        list: () => Promise.resolve([]),
        kill: () => undefined,
        inUse: () => false,
        log: () => undefined
      })
    ).resolves.toBeUndefined()
  })
})

describe('listProcesses', () => {
  it('lists a real process that mentions an engine profile, with its full command line', async () => {
    const marker = join(tmpdir(), 'José', 'engine-profile-424242-0a1b2c3d')
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', marker], {stdio: 'ignore', windowsHide: true})
    try {
      const processes = await listProcesses()
      const found = processes.find(info => info.pid === child.pid)
      expect(found?.command).toContain(marker)
    } finally {
      child.kill('SIGKILL')
    }
  }, 20_000)
})
