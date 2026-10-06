import {describe, expect, it, vi} from 'vitest'
import {EngineProcess, buildEngineArgs} from './engine-process'

const IDLE = ['-e', 'setInterval(() => {}, 1000)']

describe('buildEngineArgs', () => {
  const base = {url: 'http://127.0.0.1:5000/?t=abc', profileDir: 'C:\\data\\engine-profile'}

  it('builds the hidden engine arguments', () => {
    expect(buildEngineArgs({...base, visible: false})).toEqual([
      '--user-data-dir=C:\\data\\engine-profile',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--headless=new',
      'http://127.0.0.1:5000/?t=abc'
    ])
  })

  it('builds the mini window arguments', () => {
    expect(buildEngineArgs({...base, visible: true})).toEqual([
      '--user-data-dir=C:\\data\\engine-profile',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--app=http://127.0.0.1:5000/?t=abc',
      '--window-size=420,320',
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ])
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

  it('notifies when the process exits on its own', async () => {
    const engine = new EngineProcess(process.execPath)
    const onExit = vi.fn()
    engine.onExit(onExit)
    engine.start(['-e', 'process.exit(0)'])
    await expect.poll(() => onExit.mock.calls.length, {timeout: 5000}).toBe(1)
    expect(engine.running).toBe(false)
  })

  it('notifies when the command does not exist', async () => {
    const engine = new EngineProcess('this-binary-does-not-exist-syncroom')
    const onExit = vi.fn()
    engine.onExit(onExit)
    engine.start([])
    await expect.poll(() => onExit.mock.calls.length, {timeout: 5000}).toBe(1)
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
