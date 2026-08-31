// Stage the dotzuki-web WASM preview package into dist-electron/wasm-pkg so
// electron-builder can ship it as an extraResource (→ Resources/wasm-pkg),
// which the packaged app's /wasm route reads via DOTZUKI_WASM_ROOT.
//
// The pkg is built by `pnpm build:wasm` (wasm-pack) into crates/dotzuki-web/pkg.
// If it isn't there we still create the (near-empty) dest so extraResources
// has a valid source — packaging then succeeds, just without the ui-activity
// layout preview, exactly as an unbuilt dev checkout behaves today.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Stage one wasm-pack pkg into dist-electron/<destName>. Missing pkgs still
// produce a (near-empty) dest so extraResources has a valid source — packaging
// then succeeds without that feature, exactly as an unbuilt dev checkout
// behaves today. `pkgDir` selects the wasm-pack --out-dir (dotzuki-web ships both
// the browser `pkg` and the Node `pkg-node` used for server-side scene checks).
function stagePkg(crateDir, entryJs, wasmFile, destName, buildCmd, featureDesc, pkgDir = 'pkg') {
  const src = path.resolve(root, '..', '..', 'crates', crateDir, pkgDir)
  const dest = path.join(root, 'dist-electron', destName)

  // Start from a clean dest each time.
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })

  if (fs.existsSync(path.join(src, entryJs))) {
    // Copy the files the runtime actually loads (js loader + wasm binary); the
    // .d.ts/package.json come along harmlessly via a plain recursive copy.
    fs.cpSync(src, dest, { recursive: true, filter: (s) => path.basename(s) !== '.gitignore' })
    const wasm = path.join(dest, wasmFile)
    const mb = fs.existsSync(wasm) ? (fs.statSync(wasm).size / 1e6).toFixed(1) : '?'
    console.log(`✓ staged ${featureDesc} → dist-electron/${destName} (${mb} MB wasm)`)
  } else {
    fs.writeFileSync(
      path.join(dest, 'README.txt'),
      `${featureDesc} not built.\nRun \`${buildCmd}\` before packaging to enable it.\n`,
    )
    console.warn(
      `⚠ crates/${crateDir}/${pkgDir} not found — the packaged app will lack ${featureDesc}.\n` +
        `  Build it with \`${buildCmd}\`, then re-run \`pnpm electron:build\`.`,
    )
  }
}

stagePkg(
  'dotzuki-web', 'dotzuki_web.js', 'dotzuki_web_bg.wasm',
  'wasm-pkg', 'pnpm build:wasm', 'WASM preview pkg',
)
stagePkg(
  'dotzuki-runner-web', 'dotzuki_runner_web.js', 'dotzuki_runner_web_bg.wasm',
  'wasm-runner-pkg', 'pnpm build:wasm-runner', 'WASM playtest runner pkg',
)
stagePkg(
  'dotzuki-web', 'dotzuki_web.js', 'dotzuki_web_bg.wasm',
  'wasm-node-pkg', 'pnpm build:wasm', 'WASM scene-compile pkg (Node)',
  'pkg-node',
)

// Stage the dotzuki CLI + native player binaries into dist-electron/cli so
// electron-builder ships them as an extraResource (→ Resources/cli), powering
// /api/export in the packaged app (web export via the CLI, native export via
// the CLI + --player-bin). The binaries are built by cargo --release into
// workspace/target/release; release builds for macOS lipo both architectures
// into that path first (see .github/workflows/release-editor.yml).
function stageCliBins() {
  const destDir = path.join(root, 'dist-electron', 'cli')
  fs.rmSync(destDir, { recursive: true, force: true })
  fs.mkdirSync(destDir, { recursive: true })

  const exeSuffix = process.platform === 'win32' ? '.exe' : ''
  const buildCmd = 'cd workspace && cargo build --release -p dotzuki-cli --bin dotzuki -p dotzuki-runner --bin dotzuki-player'
  const missing = []
  for (const base of ['dotzuki', 'dotzuki-player']) {
    const exe = base + exeSuffix
    const src = path.resolve(root, '..', '..', 'target', 'release', exe)
    if (fs.existsSync(src)) {
      const dest = path.join(destDir, exe)
      fs.copyFileSync(src, dest)
      fs.chmodSync(dest, 0o755)
      const mb = (fs.statSync(dest).size / 1e6).toFixed(1)
      console.log(`✓ staged ${exe} → dist-electron/cli (${mb} MB)`)
    } else {
      missing.push(exe)
    }
  }
  if (missing.length > 0) {
    fs.writeFileSync(
      path.join(destDir, 'README.txt'),
      `dotzuki CLI binaries not built (${missing.join(', ')}).\nRun \`${buildCmd}\` before packaging to enable /api/export.\n`,
    )
    console.warn(
      `⚠ ${missing.join(', ')} not found in workspace/target/release — the packaged app will lack game export.\n` +
        `  Build them with \`${buildCmd}\`, then re-run \`pnpm electron:build\`.`,
    )
  }
}
stageCliBins()
