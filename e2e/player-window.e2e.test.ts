import {execFileSync} from 'node:child_process'
import {describe, it} from 'vitest'
import {generateRoomCode} from '../src/core/ids'
import {startPeer, waitFor} from './helpers'

/** Cuántas ventanas de la mini ventana del reproductor están de verdad visibles en pantalla (Windows). */
function visibleWindows(profileDir: string): number {
  const tag = profileDir.split(/[\\/]/).pop() ?? ''
  const script = `
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);'
@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${tag}' -and $_.CommandLine -match '--app=' } | Where-Object {
  $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  $p -and [W.U]::IsWindowVisible($p.MainWindowHandle)
}).Count`
  return Number(execFileSync('powershell', ['-NoProfile', '-Command', script], {encoding: 'utf8'}).trim())
}

const windowsOnly = process.platform === 'win32' ? it : it.skip

describe('player window', () => {
  // Lanzar el navegador con `windowsHide` crea su ventana oculta: no se ve y no reproduce.
  windowsOnly('really appears on screen', async () => {
    const peer = await startPeer({code: generateRoomCode(), name: 'Solo', direct: false, visible: true})
    try {
      await waitFor('engine ready', () => peer.session.view().engineReady)
      await waitFor('a window the user can see', () => visibleWindows(peer.profileDir) > 0, 20_000)
    } finally {
      await peer.stop()
    }
  })

  // Chromium no empieza a reproducir en una ventana que nace tapada o fuera de la vista.
  // Abrirla fuera de pantalla reproduce ese caso de forma determinista.
  it('starts playing even when the window opens out of sight', async () => {
    const peer = await startPeer({
      code: generateRoomCode(),
      name: 'Solo',
      direct: false,
      visible: true,
      extraArgs: ['--window-position=-9000,-9000']
    })
    const status = () => peer.session.playerStatus()
    try {
      await waitFor('engine ready', () => peer.session.view().engineReady)
      await peer.session.addLink('ignored: the helper resolves a fixed video')
      await waitFor('video playing in a window nobody can see', () => status()?.state === 'playing' && (status()?.timeS ?? 0) > 1, 30_000)
    } finally {
      await peer.stop()
    }
  })
})
