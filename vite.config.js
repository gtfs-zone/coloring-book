import { defineConfig } from 'vite'
import { resolve } from 'path'
import gitDescribe from 'git-describe'
import { execSync } from 'child_process'

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

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/index.html')
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
      interlocking: resolve(__dirname, 'node_modules/interlocking/src')
    }
  },
  optimizeDeps: {
    include: ['maplibre-gl', 'codemirror', 'jszip', 'papaparse'],
    // interlocking ships raw .ts; let vite transform it as source
    exclude: ['interlocking']
  }
})