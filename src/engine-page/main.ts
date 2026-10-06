import type {HostToEngine} from '../protocol/bridge'
import {HostLink} from './link'
import {deriveRoomKeys} from './net/crypto'
import {createDirectPath} from './net/direct'
import {createRelayPath} from './net/relay'
import {Transport} from './net/transport'
import {Player} from './player'

async function main(): Promise<void> {
  const token = new URLSearchParams(location.search).get('t') ?? ''
  const link = new HostLink(`ws://${location.host}/ws?t=${encodeURIComponent(token)}`)
  const player = await Player.create('player')

  let transport: Transport | undefined
  const net = {directPeers: 0, relaysOk: 0}
  const reportNet = (): void => link.send({t: 'net', directPeers: net.directPeers, relaysOk: net.relaysOk})

  const leaveRoom = (): void => {
    transport?.close()
    transport = undefined
    net.directPeers = 0
    net.relaysOk = 0
  }

  async function handle(msg: HostToEngine): Promise<void> {
    switch (msg.t) {
      case 'join': {
        leaveRoom()
        const keys = await deriveRoomKeys(msg.code)
        const relay = createRelayPath({
          relays: msg.relays,
          keys,
          onStatus: ok => {
            net.relaysOk = ok
            reportNet()
          }
        })
        const direct = msg.direct
          ? createDirectPath({
              code: msg.code,
              keys,
              onPeers: count => {
                net.directPeers = count
                reportNet()
              }
            })
          : undefined
        transport = new Transport(direct, relay, (received, via) => link.send({t: 'msg', msg: received, via}))
        break
      }
      case 'leave':
        leaveRoom()
        break
      case 'send':
        transport?.send(msg.msg, msg.relay)
        break
      case 'player':
        player.apply(msg.cmd)
        break
      case 'volume':
        player.setVolume(msg.value)
        break
    }
  }

  player.onStatus = status => link.send({t: 'status', status})
  player.onEnded = videoId => link.send({t: 'ended', videoId})
  player.onError = (videoId, code) => link.send({t: 'error', videoId, code})

  // En serie: «join» deriva claves de forma asíncrona y los «send» que vienen detrás deben esperar.
  let chain: Promise<void> = Promise.resolve()
  link.onMessage = msg => {
    chain = chain.then(() => handle(msg)).catch(error => console.error('syncroom engine', error))
  }
  link.onLost = () => {
    player.apply({type: 'stop'})
    leaveRoom()
    window.close()
  }

  await link.open()
  link.send({t: 'ready'})
}

main().catch(error => console.error('syncroom engine failed to start', error))
