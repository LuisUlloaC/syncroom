import {describe, expect, it} from 'vitest'
import {reconcile, type Desired, type PlayerStatus} from './sync'

const status = (over: Partial<PlayerStatus> = {}): PlayerStatus => ({
  videoId: 'aaaaaaaaaaa',
  state: 'playing',
  timeS: 10,
  durationS: 200,
  ...over
})

const desired = (over: Partial<Desired> = {}): Desired => ({
  videoId: 'aaaaaaaaaaa',
  playing: true,
  positionS: 10,
  ...over
})

describe('reconcile', () => {
  it('does nothing when the player already matches', () => {
    expect(reconcile(desired(), status(), 2)).toEqual([])
    expect(reconcile(desired({positionS: 11.5}), status(), 2)).toEqual([])
  })

  it('does nothing when nothing should play and nothing is loaded', () => {
    expect(reconcile(desired({videoId: null}), status({videoId: null, state: 'unstarted'}), 2)).toEqual([])
  })

  it('stops when nothing should play but something is loaded', () => {
    expect(reconcile(desired({videoId: null}), status(), 2)).toEqual([{type: 'stop'}])
  })

  it('loads a different video at the expected position', () => {
    expect(reconcile(desired({videoId: 'bbbbbbbbbbb', positionS: 33}), status(), 2)).toEqual([
      {type: 'load', videoId: 'bbbbbbbbbbb', startS: 33, playing: true}
    ])
    expect(reconcile(desired({playing: false, positionS: 5}), status({videoId: null, state: 'unstarted'}), 2)).toEqual([
      {type: 'load', videoId: 'aaaaaaaaaaa', startS: 5, playing: false}
    ])
  })

  it('seeks only beyond the tolerance', () => {
    expect(reconcile(desired({positionS: 13}), status(), 2)).toEqual([{type: 'seek', timeS: 13}])
    expect(reconcile(desired({positionS: 10.9}), status(), 0.75)).toEqual([{type: 'seek', timeS: 10.9}])
    expect(reconcile(desired({positionS: 10.5}), status(), 0.75)).toEqual([])
  })

  it('plays and pauses to match', () => {
    expect(reconcile(desired(), status({state: 'paused'}), 2)).toEqual([{type: 'play'}])
    expect(reconcile(desired({playing: false}), status(), 2)).toEqual([{type: 'pause'}])
  })

  it('seeks and plays together when both differ', () => {
    expect(reconcile(desired({positionS: 60}), status({state: 'paused'}), 2)).toEqual([
      {type: 'seek', timeS: 60},
      {type: 'play'}
    ])
  })

  it('waits while buffering', () => {
    expect(reconcile(desired({positionS: 90}), status({state: 'buffering'}), 2)).toEqual([])
  })

  it('leaves a cued or unstarted video alone while paused', () => {
    expect(reconcile(desired({playing: false, positionS: 40}), status({state: 'cued', timeS: 0}), 2)).toEqual([])
    expect(reconcile(desired({playing: false, positionS: 40}), status({state: 'unstarted', timeS: 0}), 2)).toEqual([])
  })

  it('starts a cued video at the right position when it should play', () => {
    expect(reconcile(desired({positionS: 40}), status({state: 'cued', timeS: 0}), 2)).toEqual([
      {type: 'seek', timeS: 40},
      {type: 'play'}
    ])
  })

  it('restarts an ended video only if the room is still inside it', () => {
    expect(reconcile(desired({positionS: 50}), status({state: 'ended', timeS: 200}), 2)).toEqual([
      {type: 'seek', timeS: 50},
      {type: 'play'}
    ])
    expect(reconcile(desired({positionS: 199.5}), status({state: 'ended', timeS: 200}), 2)).toEqual([])
    expect(reconcile(desired({playing: false, positionS: 50}), status({state: 'ended', timeS: 200}), 2)).toEqual([])
  })
})
