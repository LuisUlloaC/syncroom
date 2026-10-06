export type ParsedLink = {kind: 'video'; videoId: string} | {kind: 'playlist'; listId: string}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com'
])
const VIDEO_PATHS = new Set(['shorts', 'embed', 'live', 'v'])

function video(id: string | null | undefined): ParsedLink | undefined {
  return id !== null && id !== undefined && VIDEO_ID.test(id) ? {kind: 'video', videoId: id} : undefined
}

export function parseYouTubeLink(input: string): ParsedLink | undefined {
  const trimmed = input.trim()
  if (trimmed === '' || /\s/.test(trimmed)) return undefined

  let url: URL
  try {
    url = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined

  const host = url.hostname.toLowerCase()
  const [, first, second] = url.pathname.split('/')

  if (host === 'youtu.be') return video(first)
  if (!YOUTUBE_HOSTS.has(host)) return undefined

  if (first === 'watch') return video(url.searchParams.get('v'))
  if (first !== undefined && VIDEO_PATHS.has(first)) return video(second)
  if (first === 'playlist') {
    const list = url.searchParams.get('list')
    return list !== null && LIST_ID.test(list) ? {kind: 'playlist', listId: list} : undefined
  }
  return undefined
}
