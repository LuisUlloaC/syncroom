import {access, constants} from 'node:fs/promises'
import {posix, win32} from 'node:path'

export interface LocateOptions {
  /** Ruta del ajuste `syncroom.browserPath`. Vacía = buscar automáticamente. */
  configured?: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => Promise<boolean>
}

const WINDOWS_BROWSERS = [
  ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe']
]
const WINDOWS_ROOTS = ['ProgramFiles(x86)', 'ProgramFiles', 'LOCALAPPDATA']

const MAC_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
]

const LINUX_BROWSERS = [
  'google-chrome',
  'google-chrome-stable',
  'microsoft-edge',
  'microsoft-edge-stable',
  'brave-browser',
  'chromium',
  'chromium-browser'
]

export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const roots = WINDOWS_ROOTS.map(name => env[name]).filter((root): root is string => root !== undefined && root !== '')
    return WINDOWS_BROWSERS.flatMap(parts => roots.map(root => win32.join(root, ...parts)))
  }
  if (platform === 'darwin') return [...MAC_BROWSERS]
  const dirs = (env.PATH ?? '').split(':').filter(dir => dir !== '')
  return LINUX_BROWSERS.flatMap(name => dirs.map(dir => posix.join(dir, name)))
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function locateBrowser(options: LocateOptions = {}): Promise<string | undefined> {
  const exists = options.exists ?? defaultExists
  const configured = options.configured?.trim() ?? ''
  if (configured !== '') return (await exists(configured)) ? configured : undefined
  for (const candidate of browserCandidates(options.platform ?? process.platform, options.env ?? process.env)) {
    if (await exists(candidate)) return candidate
  }
  return undefined
}
