# Step 2.6 — Vite Integration

Wire the wasm preview crate into the Vue editor's build pipeline so editor code can `import { PreviewSession } from 'pokered-ui-preview'`.

## Build Pipeline

```
crates/pokered-ui-preview/  ──wasm-pack build──>  crates/pokered-ui-preview/pkg/
                                                       ├── pokered_ui_preview.js
                                                       ├── pokered_ui_preview.d.ts
                                                       ├── pokered_ui_preview_bg.wasm
                                                       └── package.json

tools/game-editor/package.json
    "dependencies": {
        "pokered-ui-preview": "file:../../crates/pokered-ui-preview/pkg"
    }

tools/game-editor/src/usePreview.ts
    import init, { PreviewSession } from 'pokered-ui-preview';
```

## wasm-pack Build Command

```bash
wasm-pack build crates/pokered-ui-preview \
    --target web \
    --out-dir pkg \
    --release
```

Add a Makefile target / npm script:

```makefile
# Top-level Makefile (or workspace/Makefile)
.PHONY: wasm-preview
wasm-preview:
	wasm-pack build crates/pokered-ui-preview --target web --out-dir pkg --release
	wasm-opt -Oz -o crates/pokered-ui-preview/pkg/pokered_ui_preview_bg.wasm \
	         crates/pokered-ui-preview/pkg/pokered_ui_preview_bg.wasm
```

`wasm-opt -Oz` is from binaryen — strips dead code, shrinks binary 30-50%.

```json
// tools/game-editor/package.json
{
    "scripts": {
        "build:wasm": "cd ../.. && make wasm-preview",
        "dev": "npm run build:wasm && vite",
        "build": "npm run build:wasm && vue-tsc && vite build"
    },
    "dependencies": {
        "pokered-ui-preview": "file:../../crates/pokered-ui-preview/pkg"
    }
}
```

## Vite Config Adjustments

The wasm module needs MIME-type handling and async init. Existing editor likely already handles this if `pokered-web` is integrated — mirror that setup.

```typescript
// tools/game-editor/vite.config.ts (additions)

export default defineConfig({
    plugins: [
        vue(),
        // existing plugins
    ],
    optimizeDeps: {
        exclude: ['pokered-ui-preview'],   // don't pre-bundle wasm
    },
    server: {
        fs: {
            allow: [
                searchForWorkspaceRoot(process.cwd()),
                resolve(__dirname, '../../crates/pokered-ui-preview/pkg'),
            ],
        },
    },
});
```

## Hot Reload Story

When a Rust source file in `crates/pokered-ui-preview` changes, the editor needs the new wasm. Options:

### Option A: Manual rebuild

Developer runs `npm run build:wasm` after Rust changes. Vite picks up `pkg/` changes via file watcher.

**Trade-off**: friction. Developer forgets, sees stale behavior, debugs phantom bug.

### Option B: cargo-watch trigger

```bash
cargo watch -w crates/pokered-ui-preview/src \
            -w crates/pokered-ui/src \
            -w crates/pokered-data/ui_layouts \
            -s 'wasm-pack build crates/pokered-ui-preview --target web --out-dir pkg --dev'
```

Run alongside `vite dev`. Any Rust source change triggers wasm rebuild; vite reloads.

**Trade-off**: rebuild is slow (~10-30s for wasm-pack even in dev mode). Acceptable for occasional Rust changes; painful if Rust is being iterated heavily.

### Option C: Vite plugin

Custom Vite plugin watches Rust files and rebuilds. Same as Option B with nicer DX.

**Decision**: Document Option B as the developer workflow. Add to README. Don't over-invest in Option C unless friction is severe.

## Production Build

```bash
# tools/game-editor build
npm run build
# → tools/game-editor/dist/ contains the editor + bundled wasm

# Serve dist/ via any static host (the editor uses Vite middleware in dev)
```

Verify wasm is correctly emitted in `dist/assets/` and not loaded with wrong MIME.

## Module Resolution Issue: Workspace npm Symlink

`"pokered-ui-preview": "file:../../crates/pokered-ui-preview/pkg"` creates a symlink in `node_modules`. If `crates/pokered-ui-preview/pkg` doesn't exist (e.g. on a fresh checkout before `npm run build:wasm`), `npm install` fails.

**Fix**: Add a `postinstall` script in `tools/game-editor/package.json`:

```json
"scripts": {
    "postinstall": "test -d ../../crates/pokered-ui-preview/pkg || npm run build:wasm"
}
```

Alternatively, document in README that `make wasm-preview` must be run before `npm install`.

## CI Integration

`.github/workflows/main.yml` (or equivalent):

```yaml
- name: Install wasm-pack
  run: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
- name: Install binaryen (for wasm-opt)
  run: sudo apt-get install -y binaryen
- name: Build wasm preview
  run: make wasm-preview
- name: Verify wasm binary size
  run: |
    SIZE=$(stat -c%s crates/pokered-ui-preview/pkg/pokered_ui_preview_bg.wasm)
    echo "Wasm size: $SIZE bytes"
    test $SIZE -lt 1048576    # < 1 MB
- name: Build editor
  working-directory: tools/game-editor
  run: |
    npm install
    npm run build
```

## Acceptance

- [ ] `make wasm-preview` builds successfully from a clean checkout
- [ ] `cd tools/game-editor && npm install && npm run dev` starts the editor with wasm loadable
- [ ] Editor's main entry can `import { PreviewSession } from 'pokered-ui-preview'` with full TypeScript types
- [ ] Production build (`npm run build`) succeeds and `dist/` contains the wasm
- [ ] Wasm binary is < 1 MB compressed (gzip) — measured in CI
- [ ] Hot reload workflow documented in README

## Effort

0.5 day. Most of the work is debugging Vite's wasm handling and getting the dev workflow smooth.
