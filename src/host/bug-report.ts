/**
 * Informe de error como issue nuevo de GitHub, ya rellenado con el entorno y el final del registro.
 * El issue es público: antes se quitan el usuario de las rutas y los códigos de sala (con uno,
 * cualquiera entraría en una sala privada). Quien lo envía lo ve entero en GitHub antes de mandarlo.
 */

/** GitHub rechaza URLs mucho más largas; con margen para el re-codificado de VS Code. */
export const MAX_URL = 7000
/** Líneas del registro que se guardan para el informe. */
export const LOG_LINES = 300

export interface BugReport {
  /** `<repo>/issues/new`. */
  newIssueUrl: string
  title: string
  /** Pares «dato: valor» (versión, VS Code, sistema…). */
  environment: ReadonlyArray<readonly [string, string]>
  /** Líneas del registro, de la más antigua a la más reciente, ya sin datos personales. */
  log: readonly string[]
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Quita el usuario de las rutas (`home` → `~`) y los códigos de sala. */
export function redactLine(line: string, home: string | undefined): string {
  let out = line
  if (home !== undefined && home.length > 3) {
    // La misma carpeta escrita con / o \ y con la unidad en minúsculas (así la da VS Code).
    const pattern = escapeRegExp(home).replace(/\\\\|\//g, '[\\\\/]')
    out = out.replace(new RegExp(pattern, 'gi'), '~')
  }
  return out
    // El nombre puede llevar espacios: hasta la siguiente barra (si tapa de más, mejor).
    .replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/"'\n]+/g, '$1<user>')
    .replace(/(\/(?:home|Users)\/)[^/\s"']+/g, '$1<user>')
    .replace(/\broom [A-Z0-9]{8}\b/g, 'room <code>')
    .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, '<code>')
}

/**
 * VS Code abre los enlaces con `encodeURI(uri.toString(true))`: la query se decodifica y estos
 * cuatro caracteres dejarían de ser texto (cortarían el body o serían espacios). Se cambian por
 * sus equivalentes de ancho completo, que se leen igual.
 */
function survivable(text: string): string {
  return text.replace(/[?&+#]/g, char => ({'?': '？', '&': '＆', '+': '＋', '#': '＃'})[char] ?? char)
}

function body(report: BugReport, lines: readonly string[]): string {
  const environment = report.environment.map(([key, value]) => `- ${key}: ${value}`).join('\n')
  const total = report.log.length
  const heading =
    lines.length === total ? `Log (last ${total} lines, user name and room codes removed)` : `Log (last ${lines.length} of ${total} lines, user name and room codes removed)`
  return [
    '<!-- Describe what you were doing, then press Submit. SyncRoom filled in the rest. -->',
    '',
    '**What happened**',
    '',
    report.title,
    '',
    '**Environment**',
    '',
    environment,
    '',
    `**${heading}**`,
    '',
    '```text',
    lines.length === 0 ? '(empty)' : lines.join('\n'),
    '```'
  ].join('\n')
}

function build(report: BugReport, lines: readonly string[]): string {
  const params = [
    ['title', survivable(report.title)],
    ['body', survivable(body(report, lines))],
    ['labels', 'bug']
  ]
  return `${report.newIssueUrl}?${params.map(([key, value]) => `${key}=${encodeURIComponent(value ?? '')}`).join('&')}`
}

/** Enlace a un issue nuevo con el informe; si no cabe, se quitan las líneas más antiguas. */
export function issueUrl(report: BugReport, maxLength = MAX_URL): string {
  let lines = report.log.slice(-LOG_LINES)
  let url = build(report, lines)
  while (url.length > maxLength && lines.length > 0) {
    // Recorta de golpe lo que sobra (aprox.) y luego línea a línea.
    const excess = url.length - maxLength
    const drop = Math.max(1, Math.floor(excess / 120))
    lines = lines.slice(Math.min(drop, lines.length))
    url = build(report, lines)
  }
  return url
}
