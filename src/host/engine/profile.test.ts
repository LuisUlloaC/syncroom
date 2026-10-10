import {describe, expect, it} from 'vitest'
import {engineProfileName, profileHostPid, profileToken} from './profile'

describe('engineProfileName', () => {
  it('names the profile after the host pid and the launch token', () => {
    expect(engineProfileName(33864, 'a1b2c3d4')).toBe('engine-profile-33864-a1b2c3d4')
  })

  it('never reuses the 0.7.0 name of the same host (the one an orphan may still hold)', () => {
    expect(engineProfileName(33864, profileToken())).not.toBe('engine-profile-33864')
  })

  it('gives a different profile to every launch of the same host', () => {
    const names = new Set(Array.from({length: 200}, () => engineProfileName(33864, profileToken())))
    expect(names.size).toBe(200)
  })
})

describe('profileToken', () => {
  it('is 8 hex characters', () => {
    expect(profileToken()).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('profileHostPid', () => {
  it('reads the host pid of a profile name, new or 0.7.0 format', () => {
    expect(profileHostPid(engineProfileName(4242, 'deadbeef'))).toBe(4242)
    expect(profileHostPid('engine-profile-33864')).toBe(33864)
  })

  it('rejects anything that is not an engine profile', () => {
    expect(profileHostPid('engine-profile-')).toBeUndefined()
    expect(profileHostPid('engine-profile-0')).toBeUndefined()
    expect(profileHostPid('engine-profile-12-XYZ')).toBeUndefined()
    expect(profileHostPid('engine-profile-12-ab/..')).toBeUndefined()
    expect(profileHostPid('my-engine-profile-12')).toBeUndefined()
    expect(profileHostPid('state.json')).toBeUndefined()
  })
})
