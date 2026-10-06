import {existsSync} from 'node:fs'
import {cp, mkdir} from 'node:fs/promises'
import {build, context} from 'esbuild'

const watch = process.argv.includes('--watch')

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch,
  logLevel: 'info'
}

const bundles = [
  {
    ...common,
    entryPoints: ['src/host/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode', 'bufferutil', 'utf-8-validate']
  },
  {
    ...common,
    entryPoints: ['src/engine-page/main.ts'],
    outfile: 'dist/engine/engine.js',
    platform: 'browser',
    format: 'esm',
    target: 'chrome120'
  },
  {
    ...common,
    entryPoints: ['src/webview/main.tsx'],
    outfile: 'dist/webview/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    jsx: 'automatic',
    jsxImportSource: 'preact'
  }
].filter(bundle => existsSync(bundle.entryPoints[0]))

await mkdir('dist/engine', {recursive: true})
await cp('src/engine-page/index.html', 'dist/engine/index.html')

if (watch) {
  for (const bundle of bundles) (await context(bundle)).watch()
} else {
  await Promise.all(bundles.map(bundle => build(bundle)))
}
