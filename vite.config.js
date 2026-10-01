import { defineConfig } from 'vite'
import { resolve } from 'path'
import gitDescribe from 'git-describe'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

// Get version from git tags using git-describe
let version = '0.0.0-development'
try {
  const gitInfo = gitDescribe.gitDescribeSync({
    longSemver: true,
    dirtySemver: false,
  })

  // If we're exactly on a tag, use the clean version
  if (gitInfo.distance === 0) {
    version = gitInfo.tag.replace(/^v/, '')
  } else {
    // Otherwise, include commits since tag + hash
    version = `${gitInfo.tag.replace(/^v/, '')}-${gitInfo.distance}-g${gitInfo.hash}`
  }
} catch (error) {
  // No git tags found, use development version with commit hash
  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    version = `0.0.0-dev.${hash}`
  } catch {
    console.warn('Could not determine git version, using default')
  }
}

// Inlines src/intro.html at `<!-- @intro -->`, so the copy the home panel shows
// for an empty feed is also in the static HTML.
const inlineIntro = {
  name: 'inline-intro',
  transformIndexHtml: (html) =>
    html.replace('<!-- @intro -->', readFileSync(resolve(import.meta.dirname, 'src/intro.html'), 'utf-8'))
}

export default defineConfig({
  plugins: [inlineIntro],
  root: 'src',
  publicDir: '../public',
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: resolve(import.meta.dirname, 'src/index.html')
    }
  },
  server: {
    port: 8080,
    open: true,
    host: true // Allow external connections
  },
  css: {
    postcss: './postcss.config.js'
  },
  resolve: {
    alias: {
      'gtfs-zone-web-common': resolve(import.meta.dirname, 'node_modules/gtfs-zone-web-common/src')
    }
  },
  optimizeDeps: {
    include: ['maplibre-gl', 'codemirror', 'jszip', 'papaparse'],
    // gtfs-zone-web-common ships raw .ts; let vite transform it as source
    exclude: ['gtfs-zone-web-common']
  }
})