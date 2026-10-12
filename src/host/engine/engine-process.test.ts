import {describe, expect, it, vi} from 'vitest'
import {EngineProcess, buildEngineArgs, describeExit} from './engine-process'

const IDLE = ['-e', 'setInterval(() => {}, 1000)']

describe('buildEngineArgs', () => {
  const base = {url: 'http://127.0.0.1:5000/?t=abc', profileDir: 'C:\\data\\engine-profile'}

  it('builds the hidden engine arguments', () => {
    expect(buildEngineArgs({...base, visible: false})).toEqual([
      '--user-data-dir=C:\\data\\engine-profile',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--auto-select-tab-capture-source-by-title=SyncRoom',
      '--do-not-de-elevate',
      '--headless=new',
      '--window-size=480,400',
      'http://127.0.0.1:5000/?t=abc'
    ])
  })

  it('builds the mini window arguments', () => {
    expect(buildEngineArgs({...base, visible: true})).toEqual([
      '--user-data-dir=C:\\data\\engine-profile',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--auto-select-tab-capture-source-by-title=SyncRoom',
      '--do-not-de-elevate',
      '--app=http://127.0.0.1:5000/?t=abc',
      '--window-size=420,320',
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ])
  })
})

describe('describeExit', () => {
  it('explains code 21: another browser already holds the profile', () => {
    expect(describeExit({code: 21, signal: null})).toBe('code 21: profile in use')
  })

  it('gives the plain code, the signal or the launch error otherwise', () => {
    expect(describeExit({code: 0, signal: null})).toBe('code 0')
    expect(describeExit({code: 1, signal: null})).toBe('code 1')
    expect(describeExit({code: null, signal: 'SIGKILL'})).toBe('signal SIGKILL')
    expect(describeExit({code: null, signal: null, error: 'spawn x ENOENT'})).toBe('could not start: spawn x ENOENT')
    expect(describeExit({code: null, signal: null})).toBe('unknown')
  })
})

describe('EngineProcess', () => {
  it('starts, reports running and stops', async () => {
    const engine = new EngineProcess(process.execPath)
    expect(engine.running).toBe(false)
    engine.start(IDLE)
    expect(engine.running).toBe(true)
    await engine.stop()
    expect(engine.running).toBe(false)
  })

  it('notifies when the process exits on its own, with its exit code', async () => {
    const engine = new EngineProcess(process.execPath)
    const onExit = vi.fn()
    engine.onExit(onExit)
    engine.start(['-e', 'process.exit(21)'])
    await expect.poll(() => onExit.mock.calls.length, {timeout: 5000}).toBe(1)
    expect(onExit).toHaveBeenCalledWith({code: 21, signal: null})
    expect(engine.running).toBe(false)
  })

  it('notifies when the command does not exist, with the error', async () => {
    const engine = new EngineProcess('this-binary-does-not-exist-syncroom')
    const onExit = vi.fn()
    engine.onExit(onExit)
    engine.start([])
    await expect.poll(() => onExit.mock.calls.length, {timeout: 5000}).toBe(1)
    expect(onExit).toHaveBeenCalledWith({code: null, signal: null, error: expect.stringContaining('ENOENT')})
    expect(engine.running).toBe(false)
  })

  it('refuses to start twice and tolerates stopping when idle', async () => {
    const engine = new EngineProcess(process.execPath)
    await engine.stop()
    engine.start(IDLE)
    expect(() => engine.start(IDLE)).toThrow()
    await engine.stop()
  })

  it('still stops the browser when killing the process tree fails', async () => {
    const engine = new EngineProcess(process.execPath, {killTree: (_pid, done) => done(new Error('taskkill failed'))})
    const onExit = vi.fn()
    engine.onExit(onExit)
    engine.start(IDLE)
    await engine.stop()
    expect(engine.running).toBe(false)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('gives up waiting after a while and lets a new browser start', async () => {
    const stuck: number[] = []
    const engine = new EngineProcess(process.execPath, {killTree: pid => stuck.push(pid), stopTimeoutMs: 100})
    const onExit = vi.fn()
    engine.onExit(onExit)
    try {
      engine.start(IDLE)
      await engine.stop()
      expect(engine.running).toBe(false)
      engine.start(IDLE) // ya no lanza «engine already running»
      expect(engine.running).toBe(true)
      await engine.stop()
    } finally {
      for (const pid of stuck) process.kill(pid, 'SIGKILL')
    }
    // El que no se dejó matar ya no cuenta: su salida tardía no se anuncia como la del motor actual.
    await new Promise(done => setTimeout(done, 200))
    expect(onExit).not.toHaveBeenCalled()
  })

  it('a code 0 exit before the page is ready is a hand-off: keeps running and does not report an exit', async () => {
    const engine = new EngineProcess(process.execPath, {findHolders: async () => []})
    const onExit = vi.fn()
    const onHandoff = vi.fn()
    engine.onExit(onExit)
    engine.onHandoff(onHandoff)
    engine.start(['-e', 'process.exit(0)'], {profileDir: 'C:\data\engine-profile-1-aa'})
    await expect.poll(() => onHandoff.mock.calls.length, {timeout: 5000}).toBe(1)
    expect(onExit).not.toHaveBeenCalled()
    expect(engine.running).toBe(true)
    expect(() => engine.start(IDLE)).toThrow()
    await engine.stop()
    expect(engine.running).toBe(false)
  })

  it('stopping after a hand-off kills the processes that hold the profile', async () => {
    const killed: number[] = []
    const asked: string[] = []
    const engine = new EngineProcess(process.execPath, {
      findHolders: async dir => {
        asked.push(dir)
        return [{pid: 101, command: 'a'}, {pid: 102, command: 'b'}]
      },
      killPid: pid => {
        killed.push(pid)
        if (pid === 101) throw new Error('already gone')
      }
    })
    const onHandoff = vi.fn()
    engine.onHandoff(onHandoff)
    engine.start(['-e', 'process.exit(0)'], {profileDir: 'C:\data\engine-profile-1-bb'})
    await expect.poll(() => onHandoff.mock.calls.length, {timeout: 5000}).toBe(1)
    await engine.stop()
    expect(asked).toEqual(['C:\data\engine-profile-1-bb'])
    expect(killed).toEqual([101, 102])
    expect(engine.running).toBe(false)
  })

  it('still stops after a hand-off when the processes cannot be listed', async () => {
    const engine = new EngineProcess(process.execPath, {
      findHolders: async () => {
        throw new Error('powershell timed out')
      }
    })
    const onHandoff = vi.fn()
    engine.onHandoff(onHandoff)
    engine.start(['-e', 'process.exit(0)'], {profileDir: 'C:\data\engine-profile-1-cc'})
    await expect.poll(() => onHandoff.mock.calls.length, {timeout: 5000}).toBe(1)
    await engine.stop()
    expect(engine.running).toBe(false)
  })

  it('once the page is ready, a code 0 exit is a real exit (the user closed the window)', async () => {
    const engine = new EngineProcess(process.execPath, {findHolders: async () => []})
    const onExit = vi.fn()
    const onHandoff = vi.fn()
    engine.onExit(onExit)
    engine.onHandoff(onHandoff)
    engine.start(['-e', 'setTimeout(() => process.exit(0), 300)'], {profileDir: 'C:\data\engine-profile-1-dd'})
    engine.markReady()
    await expect.poll(() => onExit.mock.calls.length, {timeout: 5000}).toBe(1)
    expect(onHandoff).not.toHaveBeenCalled()
    expect(engine.running).toBe(false)
  })

  it('without a profile, a code 0 exit is a real exit', async () => {
    const engine = new EngineProcess(process.execPath)
    const onExit = vi.fn()
    engine.onExit(onExit)
    engine.start(['-e', 'process.exit(0)'])
    await expect.poll(() => onExit.mock.calls.length, {timeout: 5000}).toBe(1)
    expect(engine.running).toBe(false)
  })

  it('can be started again after stopping', async () => {
    const engine = new EngineProcess(process.execPath)
    engine.start(IDLE)
    await engine.stop()
    engine.start(IDLE)
    expect(engine.running).toBe(true)
    await engine.stop()
  })
})

