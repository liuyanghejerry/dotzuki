import { ref, computed, watch, type Ref } from 'vue'
import { useAiImageProviders } from '@/composables/useAiImageProviders'
import { getStoredKey } from '@/composables/useAiStream'
import { medianDenoise } from './imageOps'

// ── Region-op engine: preview-first, mask-aware ─────────────────────────────
// Every op runs over the masked region (or the whole layer if nothing's
// selected) and lands in `preview` WITHOUT touching the layer, so different
// algorithms can be A/B'd on the same part; 应用 commits as one undo entry,
// 取消 discards. Extracted from TilePixelEditor; the host wires the shared
// canvas/layer/undo state through `ctx`.

type RegionTransform = (region: Uint8ClampedArray, rw: number, rh: number) => Promise<Uint8ClampedArray>

export interface RegionOpsCtx {
  /** Current canvas size in pixels (mutable in the host → getters). */
  pw: () => number
  ph: () => number
  /** The active layer's RGBA buffer (reassigned on layer switch → getter). */
  activeData: () => Uint8ClampedArray
  selMask: Ref<Uint8Array | null>
  sel: Ref<{ x: number; y: number; w: number; h: number } | null>
  pushUndo: () => void
  commitUndo: () => void
  redraw: () => void
  markDirty: () => void
  decodeSized: (dataUrl: string, w: number, h: number) => Promise<Uint8ClampedArray | null>
}

export function useRegionOps(ctx: RegionOpsCtx) {
  const cvBusy = ref(false)
  const cvError = ref('')
  const preview = ref<{ rx: number; ry: number; rw: number; rh: number; out: Uint8ClampedArray; label: string } | null>(null)
  const previewShowOriginal = ref(false)
  let previewRecompute: (() => Promise<void>) | null = null
  /** A param changed while a recompute was in flight → re-run once it frees up. */
  let previewPending = false
  /** Target colour count for 调色 (quantize) — tunable, no fixed preset. */
  const quantizeColors = ref(16)
  const hasPreview = computed(() => preview.value !== null)

  /** Lift the active region (masking out unselected pixels so the algorithm only
   *  sees the chosen part), run `transform`, and stage the result as a preview. */
  async function runRegionOp(transform: RegionTransform, label: string) {
    if (cvBusy.value) return
    cvBusy.value = true
    cvError.value = ''
    try {
      const pw = ctx.pw(), ph = ctx.ph(), buf = ctx.activeData()
      const m = ctx.selMask.value
      const s = ctx.sel.value
      const rx = s ? s.x : 0, ry = s ? s.y : 0
      const rw = s ? s.w : pw, rh = s ? s.h : ph
      const region = new Uint8ClampedArray(rw * rh * 4)
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
        const gx = rx + x, gy = ry + y
        const di = (y * rw + x) * 4
        if (m && !m[gy * pw + gx]) continue // unselected → transparent, excluded from the op
        const si = (gy * pw + gx) * 4
        region[di] = buf[si]; region[di + 1] = buf[si + 1]; region[di + 2] = buf[si + 2]; region[di + 3] = buf[si + 3]
      }
      const out = await transform(region, rw, rh)
      preview.value = { rx, ry, rw, rh, out, label }
      previewShowOriginal.value = false
      previewRecompute = () => runRegionOp(transform, label)
      ctx.redraw()
    } catch (e) {
      cvError.value = (e as Error).message
    } finally {
      cvBusy.value = false
      // A param moved mid-flight (e.g. dragging the colour-count slider) → re-run so
      // the preview always reflects the final value, not a dropped intermediate one.
      if (previewPending) { previewPending = false; void previewRecompute?.() }
    }
  }

  /** Commit the staged preview into the active layer (one undo entry), masked. */
  function applyPreview() {
    const pv = preview.value
    if (!pv) return
    const pw = ctx.pw(), buf = ctx.activeData()
    const m = ctx.selMask.value
    ctx.pushUndo()
    for (let y = 0; y < pv.rh; y++) for (let x = 0; x < pv.rw; x++) {
      const gx = pv.rx + x, gy = pv.ry + y
      if (m && !m[gy * pw + gx]) continue
      const di = (y * pv.rw + x) * 4, si = (gy * pw + gx) * 4
      buf[si] = pv.out[di]; buf[si + 1] = pv.out[di + 1]; buf[si + 2] = pv.out[di + 2]; buf[si + 3] = pv.out[di + 3]
    }
    ctx.commitUndo()
    preview.value = null
    previewRecompute = null
    ctx.redraw()
    ctx.markDirty()
  }

  /** Discard the staged preview (no layer change). */
  function cancelPreview() {
    const had = preview.value !== null
    preview.value = null
    previewRecompute = null
    if (had) ctx.redraw()
  }

  // Encode the region → PNG, hit the deterministic CV endpoint, decode back.
  function cvTransform(operation: 'bg-removal' | 'palette-harmonize' | 'pixelize-grid', params: Record<string, number> = {}): RegionTransform {
    return async (region, rw, rh) => {
      const oc = document.createElement('canvas'); oc.width = rw; oc.height = rh
      oc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(region), rw, rh), 0, 0)
      const resp = await fetch('api/cv-process', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, pngBase64: oc.toDataURL('image/png'), params }),
      })
      const data = await resp.json()
      if (!resp.ok || !data.ok) throw new Error(data.error || 'CV failed')
      const out = await ctx.decodeSized(data.pngBase64, rw, rh)
      if (!out) throw new Error('decode failed')
      return out
    }
  }

  // Deterministic CV assist, previewed over the active selection (or whole layer).
  function applyCv(operation: 'bg-removal' | 'palette-harmonize' | 'pixelize-grid') {
    const params: Record<string, number> = operation === 'palette-harmonize' ? { colorCount: quantizeColors.value } : {}
    const label = operation === 'bg-removal' ? '抠底' : operation === 'palette-harmonize' ? `调色 ${quantizeColors.value} 色` : '栅格'
    return runRegionOp(cvTransform(operation, params), label)
  }

  // Client-side 3×3 median-by-luminance denoise (no server round-trip).
  function applyDenoise() {
    return runRegionOp(async (region, rw, rh) => medianDenoise(region, rw, rh), '降噪')
  }

  // Re-run the staged op when its tunable param changes, so the preview tracks the
  // slider live (e.g. dragging 调色 color count).
  watch(quantizeColors, () => {
    if (!previewRecompute || !preview.value?.label.startsWith('调色')) return
    if (cvBusy.value) previewPending = true
    else void previewRecompute()
  })

  // AI inpaint: image-edit the active selection (or whole tile) from a prompt, via
  // the configured image provider (gemini multimodal recommended).
  const showInpaint = ref(false)
  const inpaintPrompt = ref('')
  const { imageProviders, loadImageProviders } = useAiImageProviders()

  async function runInpaint() {
    if (!inpaintPrompt.value.trim() || cvBusy.value) return
    await loadImageProviders()
    const p = imageProviders.value[0]
    if (!p) { cvError.value = '请先在「设置」配置图像提供方'; return }
    const key = getStoredKey(p.id)
    if (!key) { cvError.value = '请先在「设置」中为该图像提供方填写密钥'; return }
    const prompt = inpaintPrompt.value.trim()
    await runRegionOp(async (region, rw, rh) => {
      const oc = document.createElement('canvas'); oc.width = rw; oc.height = rh
      oc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(region), rw, rh), 0, 0)
      const resp = await fetch('api/cv-inpaint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pngBase64: oc.toDataURL('image/png'), prompt, profile: p, apiKey: key }),
      })
      const data = await resp.json()
      if (!resp.ok || !data.ok) throw new Error(data.error || 'inpaint failed')
      const out = await ctx.decodeSized(data.pngBase64, rw, rh)
      if (!out) throw new Error('decode failed')
      return out
    }, 'AI 修复')
    if (!cvError.value) { showInpaint.value = false; inpaintPrompt.value = '' }
  }

  return {
    cvBusy, cvError, preview, previewShowOriginal, quantizeColors, hasPreview,
    applyPreview, cancelPreview, applyCv, applyDenoise, runInpaint,
    showInpaint, inpaintPrompt,
  }
}
