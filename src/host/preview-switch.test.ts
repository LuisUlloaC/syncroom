import {describe, expect, it} from 'vitest'
import {PreviewSwitch, type PreviewInputs} from './preview-switch'

const all: PreviewInputs = {inRoom: true, visible: true, enabled: true, engineReady: true}

describe('PreviewSwitch', () => {
  it('turns on when everything is in place and only reports changes', () => {
    const preview = new PreviewSwitch()
    expect(preview.update(all)).toBe('on')
    expect(preview.update(all)).toBeUndefined()
  })

  it('follows the view being hidden and shown again', () => {
    const preview = new PreviewSwitch()
    expect(preview.update(all)).toBe('on')
    expect(preview.update({...all, visible: false})).toBe('off')
    expect(preview.update({...all, visible: false})).toBeUndefined()
    expect(preview.update(all)).toBe('on')
  })

  it('never turns on when the user turned the preview off', () => {
    const preview = new PreviewSwitch()
    expect(preview.update({...all, enabled: false})).toBe('off')
    expect(preview.update({...all, enabled: false, visible: false})).toBeUndefined()
    expect(preview.update({...all, enabled: false, inRoom: false})).toBeUndefined()
  })

  it('does not turn on without a ready engine or outside a room', () => {
    const preview = new PreviewSwitch()
    expect(preview.update({...all, engineReady: false})).toBe('off')
    expect(preview.update({...all, inRoom: false})).toBeUndefined()
    expect(preview.update(all)).toBe('on')
  })

  it('says it again after a reset (a new engine knows nothing)', () => {
    const preview = new PreviewSwitch()
    expect(preview.update(all)).toBe('on')
    preview.reset()
    expect(preview.update(all)).toBe('on')
    expect(preview.update({...all, visible: false})).toBe('off')
    preview.reset()
    expect(preview.update({...all, visible: false})).toBe('off')
  })
})
