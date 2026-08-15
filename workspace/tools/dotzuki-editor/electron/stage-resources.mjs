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

// ── DeepSeek Harness runtime (optional dsh backend) ──────────────────────────
// Unlike the WASM pkgs, the runtime is an installed Node package tree
// (dsh-runtime/node_modules + cordis.yml), not a wasm-pack output. Stage the
// whole dir when it is installed; otherwise leave a README so packaging still
// succeeds and the app reports "not installed" with a useful hint.
{
  const src = path.join(root, 'dsh-runtime')
  const dest = path.join(root, 'dist-electron', 'dsh-runtime')
  const binShim = process.platform === 'win32'
    ? path.join(src, 'node_modules', '.bin', 'dsh-jsonrpc-agent.cmd')
    : path.join(src, 'node_modules', '.bin', 'dsh-jsonrpc-agent')
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  if (fs.existsSync(binShim) && fs.existsSync(path.join(src, 'cordis.yml'))) {
    fs.cpSync(src, dest, {
      recursive: true,
      // Keep the staged tree lean and neutral: the .npmrc pins the standalone
      // install registry and is meaningless inside the packaged app.
      filter: (s) => path.basename(s) !== '.npmrc',
    })
    console.log(`✓ staged DeepSeek Harness runtime → dist-electron/dsh-runtime`)
  } else {
    fs.writeFileSync(
      path.join(dest, 'README.txt'),
      'DeepSeek Harness runtime not staged.\n' +
        'Run `pnpm install` in dsh-runtime/ before packaging to enable the dsh assistant backend.\n',
    )
    console.warn(
      '⚠ dsh-runtime/node_modules not found — the packaged app will lack the DeepSeek Harness\n' +
        '  assistant backend. Run `pnpm install` in dsh-runtime/, then re-run `pnpm electron:build`.',
    )
  }
}
