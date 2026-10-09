import {generateSecretKey} from 'nostr-tools/pure'
import {describe, expect, it} from 'vitest'
import {generateRoomCode} from '../src/core/ids'
import {capAnnouncement, groupScope, type Announcement, type Scope} from '../src/host/discovery/announcement'
import {Announcer} from '../src/host/discovery/announcer'
import {systemClock} from '../src/host/discovery/clock'
import {Directory} from '../src/host/discovery/directory'
import {deriveGroupKeys} from '../src/host/discovery/group-key'
import {createNostrNet} from '../src/host/discovery/nostr-net'
import {DEFAULT_RELAYS} from '../src/protocol/defaults'
import {waitFor} from './helpers'

const none = {rooms: [], owners: []}
const pause = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms))

function snapshot(code: string, playing: string, listeners: number): Announcement {
  const out = capAnnouncement({code, owner: 'Ana', playing, listeners, locks: {queue: true, playback: false}})
  if (out === undefined) throw new Error('bad snapshot')
  return out
}

describe('room discovery over real relays', () => {
  it('lists a public room, follows its changes and drops it when the owner leaves', async () => {
    // Etiqueta única: la prueba no ensucia la lista pública real.
    const scope: Scope = {tag: `syncroom-e2e-${generateRoomCode().toLowerCase()}`, group: null}
    const code = generateRoomCode()
    const ownerNet = createNostrNet(DEFAULT_RELAYS, generateSecretKey())
    const viewerNet = createNostrNet(DEFAULT_RELAYS, generateSecretKey())
    const announcer = new Announcer({net: ownerNet, clock: systemClock, onStatus: () => undefined})
    const directory = new Directory({net: viewerNet, clock: systemClock, onChange: () => undefined})
    const row = () => directory.view(none).rooms.find(r => r.code === code)
    try {
      announcer.update(scope, snapshot(code, 'Song A', 2))
      directory.setScopes([scope])
      directory.setActive(true)
      await waitFor('the viewer lists the room', () => row() !== undefined, 40_000)
      expect(row()).toMatchObject({owner: 'Ana', playing: 'Song A', listeners: 2, locked: true, group: null})

      await pause(10_500) // respeta el mínimo de 10 s entre publicaciones
      announcer.update(scope, snapshot(code, 'Song B', 3))
      await waitFor('the viewer sees the new song', () => row()?.playing === 'Song B', 40_000)

      await announcer.stop()
      await waitFor('the room disappears', () => row() === undefined, 40_000)
    } finally {
      directory.dispose()
      ownerNet.close()
      viewerNet.close()
    }
  })

  it('a group room is visible with the word and invisible to someone who only knows the tag', async () => {
    const word = `e2e group ${generateRoomCode().toLowerCase()}`
    const keys = await deriveGroupKeys(word)
    const other = await deriveGroupKeys(`${word} other`)
    const code = generateRoomCode()
    const ownerNet = createNostrNet(DEFAULT_RELAYS, generateSecretKey())
    const memberNet = createNostrNet(DEFAULT_RELAYS, generateSecretKey())
    const outsiderNet = createNostrNet(DEFAULT_RELAYS, generateSecretKey())
    const announcer = new Announcer({net: ownerNet, clock: systemClock, onStatus: () => undefined})
    const member = new Directory({net: memberNet, clock: systemClock, onChange: () => undefined})
    const outsider = new Directory({net: outsiderNet, clock: systemClock, onChange: () => undefined})
    try {
      announcer.update(groupScope(keys), snapshot(code, 'Team song', 2))
      member.setScopes([groupScope(keys)])
      member.setActive(true)
      // Misma etiqueta, clave equivocada: recibe los eventos pero no puede leerlos.
      outsider.setScopes([{tag: keys.tag, key: other.aesKey, group: 'guess'}])
      outsider.setActive(true)
      await waitFor('the member lists the group room', () => member.view(none).rooms.some(r => r.code === code), 40_000)
      expect(member.view(none).rooms.find(r => r.code === code)?.group).toBe(keys.word)
      await pause(3000)
      expect(outsider.view(none).rooms).toEqual([])
      await announcer.stop()
    } finally {
      member.dispose()
      outsider.dispose()
      ownerNet.close()
      memberNet.close()
      outsiderNet.close()
    }
  })
})
