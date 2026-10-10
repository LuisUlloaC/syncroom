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

  it('can be started again after stopping', async () => {
    const engine = new EngineProcess(process.execPath)
    engine.start(IDLE)
    await engine.stop()
    engine.start(IDLE)
    expect(engine.running).toBe(true)
    await engine.stop()
  })
})
