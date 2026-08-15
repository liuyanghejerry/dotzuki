<template>
  <div
    :class="embedded ? 'w-full h-full flex flex-col bg-surface' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/60'"
    @click.self="onBackdrop"
  >
    <div :class="embedded ? 'flex flex-col flex-1 min-h-0 w-full p-3' : 'bg-surface border border-border-strong rounded-card p-4 shadow-popover'">
      <div class="flex items-center justify-between mb-3 gap-4">
        <div class="text-sm text-ink-secondary min-w-0 flex items-center gap-1">
          <input
            v-if="editingTitle"
            :ref="onTitleInput"
            v-model="titleDraft"
            maxlength="60"
            class="min-w-0 bg-canvas border border-accent-ink rounded-control px-1 py-0.5 text-sm text-ink outline-none"
            @keydown.enter.prevent="commitTitleEdit"
            @keydown.esc.prevent="cancelTitleEdit"
            @blur="commitTitleEdit"
          />
          <template v-else>
            <span class="truncate">{{ displayTitle }}</span>
            <button
              v-if="titleEditable"
              class="shrink-0 w-5 h-5 rounded-control text-ink-muted hover:text-ink hover:bg-raised"
              title="重命名"
              @click="startTitleEdit"
            >✎</button>
          </template>
        </div>
        <div class="flex items-center gap-2 text-xs text-ink-muted">
          <button class="w-6 h-6 rounded-control bg-raised hover:bg-overlay text-ink-secondary" title="水平翻转 (H)" @click="flipH">⇄</button>
          <button class="w-6 h-6 rounded-control bg-raised hover:bg-overlay text-ink-secondary" title="垂直翻转 (V)" @click="flipV">⇅</button>
          <button class="w-6 h-6 rounded-control bg-raised hover:bg-overlay text-ink-secondary disabled:opacity-40" :disabled="!canRotate" title="顺时针 90°（仅方形画布）" @click="rotateCW">↻</button>
          <button class="w-6 h-6 rounded-control bg-raised hover:bg-overlay text-ink-secondary disabled:opacity-40" :disabled="!canRotate" title="逆时针 90°（仅方形画布）" @click="rotateCCW">↺</button>
          <span class="w-px h-4 bg-overlay mx-0.5"></span>
          <button class="w-6 h-6 rounded-control bg-raised hover:bg-overlay text-ink-secondary disabled:opacity-40 grid place-content-center" :disabled="!canUndo" title="撤销 (⌘Z / Ctrl+Z)" @click="undo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7 4 12l5 5" /><path d="M4 12h11a5 5 0 0 1 0 10h-1" /></svg>
          </button>
          <button class="w-6 h-6 rounded-control bg-raised hover:bg-overlay text-ink-secondary disabled:opacity-40 grid place-content-center" :disabled="!canRedo" title="重做 (⌘⇧Z / Ctrl+Y)" @click="redo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7l5 5-5 5" /><path d="M20 12H9a5 5 0 0 0 0 10h1" /></svg>
          </button>
          <span class="ml-2">缩放</span>
          <button class="w-6 h-6 rounded-control bg-raised hover:bg-overlay text-ink-secondary" @click="zoomBy(-4)">−</button>
          <input type="range" :min="ZOOM_MIN" :max="ZOOM_MAX" step="2" v-model.number="zoom" class="w-32" />
          <button class="w-6 h-6 rounded-control bg-raised hover:bg-overlay text-ink-secondary" @click="zoomBy(4)">＋</button>
          <span class="w-8 text-right tabular-nums">{{ zoom }}×</span>
          <button
            class="ml-3 px-1 rounded-control"
            :class="showGrid ? 'bg-overlay text-ink' : 'bg-raised text-ink-faint hover:bg-overlay'"
            title="显示 / 隐藏格线"
            @click="showGrid = !showGrid"
          >格线</button>
          <template v-if="showGrid">
            <input
              type="range"
              min="0"
              max="255"
              step="5"
              v-model.number="gridShade"
              class="w-24"
              title="格线颜色：黑 ↔ 白"
            />
            <span
              class="w-5 h-4 rounded-control border border-border-strongest"
              :style="{ background: `rgb(${gridShade},${gridShade},${gridShade})` }"
            />
          </template>
          <span class="ml-3">明度</span>
          <input
            type="range"
            min="25"
            max="600"
            step="5"
            v-model.number="brightness"
            class="w-24"
            title="预览明度（仅显示，不改像素）— 拉高放大色差，便于揪出杂色"
          />
          <button
            class="px-1 rounded-control bg-raised hover:bg-overlay text-ink-secondary tabular-nums"
            title="点击重置为 100%"
            @click="brightness = 100"
          >{{ brightness }}%</button>
          <button
            v-if="embedded"
            class="ml-3 px-1.5 rounded-control bg-raised hover:bg-overlay text-ink-secondary tabular-nums"
            title="调整画布大小（列×行）"
            @click="openResize"
          >画布 {{ cellsX }}×{{ cellsY }}</button>
        </div>
        <button class="text-ink-muted hover:text-ink-secondary" @click="requestClose">✕</button>
      </div>

      <div :class="['flex gap-4', embedded ? 'flex-1 min-h-0' : '']">
        <!-- tools -->
        <div class="flex flex-col gap-2 w-28 shrink-0 text-sm overflow-y-auto pr-1" :style="{ maxHeight: panelMaxH }">
          <button
            v-for="t in TOOLS"
            :key="t.id"
            @click="tool = t.id"
            :title="`${t.label} (${t.key})`"
            :class="['px-2 py-1 rounded-control flex items-center justify-between', tool === t.id ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay']"
          >
            <span>{{ t.icon }} {{ t.label }}</span>
            <span class="opacity-60 text-xs">{{ t.key }}</span>
          </button>

          <!-- brush size + shape -->
          <div class="mt-2 text-xs text-ink-muted">笔刷 {{ brushSize }}px</div>
          <div class="flex items-center gap-1">
            <button class="w-5 h-5 rounded-control bg-raised hover:bg-overlay text-ink-secondary" title="变细 ( [ )" @click="brushBy(-1)">−</button>
            <input type="range" :min="BRUSH_MIN" :max="BRUSH_MAX" step="1" v-model.number="brushSize" class="flex-1 min-w-0" />
            <button class="w-5 h-5 rounded-control bg-raised hover:bg-overlay text-ink-secondary" title="变粗 ( ] )" @click="brushBy(1)">＋</button>
          </div>
          <div class="flex gap-1">
            <button
              :class="['flex-1 px-1 py-0.5 rounded-control text-tiny', brushShape === 'square' ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay']"
              title="方头" @click="brushShape = 'square'"
            >■ 方</button>
            <button
              :class="['flex-1 px-1 py-0.5 rounded-control text-tiny', brushShape === 'round' ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay']"
              title="圆头" @click="brushShape = 'round'"
            >● 圆</button>
          </div>
          <div v-if="tool === 'rect' || tool === 'ellipse'" class="flex gap-1">
            <button
              :class="['flex-1 px-1 py-0.5 rounded-control text-tiny', !shapeFill ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay']"
              title="描边 (F)" @click="shapeFill = false"
            >▭ 描边</button>
            <button
              :class="['flex-1 px-1 py-0.5 rounded-control text-tiny', shapeFill ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay']"
              title="填充 (F)" @click="shapeFill = true"
            >▬ 填充</button>
          </div>

          <!-- selection (选区 / 套索 / 魔棒 / 平移): mode, tool params, clipboard -->
          <template v-if="tool === 'select' || tool === 'lasso' || tool === 'wand' || tool === 'move'">
            <!-- combine mode (Shift = 并) — how a new selection merges with the old -->
            <div class="mt-1 grid grid-cols-4 gap-0.5" title="新选区与已有选区的组合方式（按住 Shift = 并）">
              <button v-for="m in (['replace','add','intersect','subtract'] as const)" :key="m"
                :class="['px-0.5 py-0.5 rounded-control text-tiny', selOp === m ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay']"
                :title="{replace:'替换',add:'并集 (加)',intersect:'交集',subtract:'差集 (减)'}[m]"
                @click="selOp = m"
              >{{ {replace:'替换',add:'并',intersect:'交',subtract:'减'}[m] }}</button>
            </div>
            <!-- 魔棒 params -->
            <template v-if="tool === 'wand'">
              <div class="flex items-center gap-1 mt-1 text-tiny text-ink-muted">
                <span>容差</span>
                <input type="range" min="0" max="128" step="1" v-model.number="wandTol" class="flex-1 min-w-0" />
                <span class="tabular-nums w-6 text-right text-ink-secondary">{{ wandTol }}</span>
              </div>
              <button
                :class="['px-1 py-0.5 rounded-control text-tiny', wandGlobal ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay']"
                title="全局：选中整张图中颜色相近的所有像素（非仅相连）"
                @click="wandGlobal = !wandGlobal"
              >{{ wandGlobal ? '✓ 全局同色' : '全局同色' }}</button>
            </template>
            <div class="mt-1 grid grid-cols-2 gap-1">
              <button class="px-1 py-0.5 rounded-control bg-raised text-ink-body hover:bg-overlay disabled:opacity-40 text-tiny" :disabled="!hasSel" title="复制 (Ctrl+C)" @click="copySel">复制</button>
              <button class="px-1 py-0.5 rounded-control bg-raised text-ink-body hover:bg-overlay disabled:opacity-40 text-tiny" :disabled="!hasSel" title="剪切 (Ctrl+X)" @click="cutSel">剪切</button>
              <button class="px-1 py-0.5 rounded-control bg-raised text-ink-body hover:bg-overlay disabled:opacity-40 text-tiny" :disabled="!hasClip" title="粘贴 (Ctrl+V)" @click="pasteClip">粘贴</button>
              <button class="px-1 py-0.5 rounded-control bg-raised text-ink-body hover:bg-overlay text-tiny" title="全选 (Ctrl+A)" @click="selectAll">全选</button>
            </div>
            <button class="px-2 py-0.5 rounded-control bg-raised text-ink-body hover:bg-overlay disabled:opacity-40 text-tiny" :disabled="!hasSel" title="取消选区 (Esc)" @click="deselect">取消选区</button>
            <div class="text-micro text-ink-faint leading-tight">
              <template v-if="tool === 'select'">拖动框选；选区内拖动可移动。</template>
              <template v-else-if="tool === 'lasso'">按住拖动勾勒任意轮廓，松开闭合即成选区。</template>
              <template v-else-if="tool === 'wand'">点一处按颜色选取相近像素（用「容差」调范围）。</template>
              <template v-else>拖动即可移动选中像素；先框选一片区域。</template>
              选好后到 ✨ 智能处理 只对选区试不同算法。
            </div>
          </template>
        </div>

        <!-- pixel canvas (scrolls within the popup at high zoom; space/middle-drag pans).
             Embedded: grow to fill the page between the side panels. -->
        <div :class="['flex flex-col gap-1', embedded ? 'flex-1 min-w-0 min-h-0' : 'shrink-0']">
          <div
            ref="scrollEl"
            class="overflow-auto bg-canvas rounded-control"
            :class="[{ 'cursor-grabbing': panning }, embedded ? 'flex-1 w-full min-h-0' : '']"
            :style="embedded ? {} : { maxWidth: '64vw', maxHeight: '78vh' }"
            @pointerdown.capture="onPanDown"
            @pointermove.capture="onPanMove"
            @pointerup.capture="onPanUp"
            @pointerleave="onPanUp"
          >
            <canvas
              ref="canvasEl"
              :width="canvasW"
              :height="canvasH"
              class="block border border-border-strong touch-none"
              :style="{ imageRendering: 'pixelated', cursor: canvasCursor }"
              @pointerdown="onDown"
              @pointermove="onMove"
              @pointerup="onUp"
              @pointercancel="onUp"
              @pointerleave="onCanvasLeave"
              @contextmenu.prevent
            />
          </div>
          <div class="text-xs text-ink-muted tabular-nums h-4 select-none">
            <template v-if="cursorPx">
              x {{ cursorPx.x }}, y {{ cursorPx.y }}
              <span v-if="cellsX > 1 || cellsY > 1" class="ml-2 text-indigo-300">
                格 {{ Math.floor(cursorPx.x / cell) }},{{ Math.floor(cursorPx.y / cell) }}
              </span>
            </template>
            <template v-else>—</template>
          </div>
        </div>

        <!-- colours: current colour controls + palettes (this image, mine, recent, 日本传统色) -->
        <div class="w-48 shrink-0 overflow-y-auto text-sm" :style="{ maxHeight: panelMaxH }">
          <!-- 印章 tile palette: pick a library tile, then stamp it into cells -->
          <template v-if="tool === 'stamp'">
            <div class="text-xs text-ink-muted mb-1">印章 · 选一块瓦片盖进格子（可拖动连续盖）</div>
            <div v-if="tilesStore.libraryTiles.length === 0" class="text-tiny text-ink-disabled mb-2">
              瓦片库为空。到「采集」或用「＋ 空白」先做几块瓦片。
            </div>
            <div v-else class="grid grid-cols-4 gap-1 mb-2">
              <img
                v-for="t in tilesStore.libraryTiles" :key="t.id"
                :src="tilesStore.tileUrl(t.id)" :alt="t.id" :title="t.id"
                :class="['w-9 h-9 border bg-raised cursor-pointer', stampTileId === t.id ? 'border-accent-ink ring-2 ring-accent-ink' : 'border-border hover:border-accent-ink']"
                style="image-rendering: pixelated;"
                @click="pickStampTile(t.id)"
              />
            </div>
            <div class="border-t border-border my-2"></div>
          </template>
          <!-- ── colour controls (consolidated here from the tools column) ── -->
          <!-- 勾填笔: two tones at once — dark outline + light fill -->
          <template v-if="tool === 'contour'">
            <div class="text-xs text-ink-muted">勾填双色</div>
            <div class="flex gap-1">
              <button
                :class="['flex-1 flex items-center gap-1 px-1.5 py-1 rounded-control border text-tiny transition-colors', contourSlot === 'outline' ? 'border-accent-ink ring-1 ring-accent-ink bg-raised text-white' : 'border-border-strong bg-raised/40 text-ink-body hover:bg-raised']"
                :title="`轮廓(深) ${outlineColor} — 调色盘 / 取色器 / 吸管作用于轮廓色`"
                @click="contourSlot = 'outline'"
              >
                <span class="w-4 h-4 rounded-control border border-border-strongest shrink-0" :style="{ background: outlineColor }" />
                轮廓
              </button>
              <button
                :class="['flex-1 flex items-center gap-1 px-1.5 py-1 rounded-control border text-tiny transition-colors', contourSlot === 'fill' ? 'border-accent-ink ring-1 ring-accent-ink bg-raised text-white' : 'border-border-strong bg-raised/40 text-ink-body hover:bg-raised']"
                :title="`填充(浅) ${fillColor} — 调色盘 / 取色器 / 吸管作用于填充色`"
                @click="contourSlot = 'fill'"
              >
                <span class="w-4 h-4 rounded-control border border-border-strongest shrink-0" :style="{ background: fillColor }" />
                填充
              </button>
            </div>
            <input
              type="color"
              :value="activeColor"
              class="w-full h-8 bg-raised rounded-control cursor-pointer"
              :title="`${contourSlot === 'outline' ? '编辑轮廓(深)色' : '编辑填充(浅)色'} ${activeColor}`"
              @input="setColor(($event.target as HTMLInputElement).value)"
            />
            <button
              class="px-2 py-1 rounded-control bg-raised text-ink-body hover:bg-overlay text-xs"
              title="把填充色调暗，作为轮廓色"
              @click="outlineColor = darken(fillColor)"
            >↧ 由填充取暗边</button>
            <!-- shading mode: how the interior ramps between outline & fill -->
            <div class="text-xs text-ink-muted mt-1">渐变模式</div>
            <div class="grid grid-cols-2 gap-1">
              <button
                v-for="m in CONTOUR_MODES"
                :key="m.id"
                :class="['px-1.5 py-1 rounded-control border text-tiny transition-colors', layerMode === m.id ? 'border-accent-ink ring-1 ring-accent-ink bg-raised text-white' : 'border-border-strong bg-raised/40 text-ink-body hover:bg-raised']"
                :title="m.title"
                @click="layerMode = m.id"
              >{{ m.label }}</button>
            </div>
            <div v-if="layerMode !== 'flat'" class="flex items-center gap-1">
              <span class="text-tiny text-ink-muted shrink-0">层数</span>
              <input type="range" min="2" max="6" step="1" v-model.number="layerLevels" class="flex-1 min-w-0" title="渐变色带数量" />
              <span class="text-tiny text-ink-body w-4 text-right">{{ layerLevels }}</span>
            </div>
            <div v-if="layerMode === 'directional'" class="flex items-center gap-1">
              <span class="text-tiny text-ink-muted shrink-0">光向</span>
              <input type="range" min="0" max="345" step="15" v-model.number="layerAngle" class="flex-1 min-w-0" title="光照方向（角度）" />
              <span class="text-tiny text-ink-body w-8 text-right">{{ layerAngle }}°</span>
            </div>
            <div class="text-micro text-ink-faint leading-tight">{{ CONTOUR_MODES.find((m) => m.id === layerMode)?.title }}</div>
          </template>
          <template v-else>
            <div class="text-xs text-ink-muted">当前颜色</div>
            <div class="flex items-center gap-2">
              <input
                type="color"
                v-model="color"
                class="w-14 h-14 shrink-0 rounded-control cursor-pointer"
                :title="`主色 ${color}（左键绘制）`"
              />
              <span class="text-xs text-ink-secondary font-mono uppercase break-all leading-tight">{{ color }}</span>
            </div>
            <div class="mt-1 flex items-center gap-1">
              <span class="text-tiny text-ink-muted">次色</span>
              <input
                type="color"
                v-model="secondaryColor"
                class="flex-1 min-w-0 h-6 bg-raised rounded-control cursor-pointer"
                :title="`次色 ${secondaryColor}（右键绘制）`"
              />
              <button
                class="w-6 h-6 rounded-control bg-raised hover:bg-overlay text-ink-secondary text-xs shrink-0"
                title="交换主 / 次色 (X)"
                @click="swapColors"
              >⇄</button>
            </div>
            <div class="mt-1 flex items-center gap-1">
              <span class="text-tiny text-ink-muted">透明</span>
              <input type="range" min="0" max="255" step="1" v-model.number="alpha" class="flex-1 min-w-0" title="画笔不透明度" />
              <span class="text-micro text-ink-faint w-8 text-right tabular-nums">{{ Math.round((alpha / 255) * 100) }}%</span>
            </div>
          </template>
          <div class="mt-1 grid grid-cols-2 gap-1">
            <button
              class="px-2 py-1 rounded-control bg-raised text-ink-body hover:bg-overlay text-xs"
              title="把当前颜色存入「我的色板」"
              @click="storeColor"
            >＋ 存入</button>
            <button
              class="px-2 py-1 rounded-control bg-raised text-ink-body hover:bg-overlay text-xs"
              title="把某个颜色整体替换为另一个"
              @click="openReplace"
            >🎨 替换</button>
          </div>
          <template v-if="replacing">
            <div class="flex items-center gap-1 text-tiny mt-1">
              <button
                :class="['px-1 py-0.5 rounded-control', pickReplaceFrom ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay']"
                title="从画布点取要替换的颜色"
                @click="pickReplaceFrom = true"
              >取色</button>
              <span class="w-5 h-5 rounded-control border border-border-strongest shrink-0" :style="{ background: replaceFrom ?? 'transparent' }" :title="replaceFrom ?? '未选择'" />
              <span>→</span>
              <input type="color" v-model="replaceTo" class="flex-1 min-w-0 h-5 bg-raised rounded-control cursor-pointer" :title="replaceTo" />
            </div>
            <div class="flex gap-1 mt-1">
              <button
                class="flex-1 px-1 py-0.5 rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40 text-tiny"
                :disabled="!replaceFrom"
                @click="doReplace"
              >执行</button>
              <button class="flex-1 px-1 py-0.5 rounded-control bg-raised text-ink-body hover:bg-overlay text-tiny" @click="closeReplace">取消</button>
            </div>
          </template>

          <div class="border-t border-border my-2"></div>

          <!-- working palette extracted from this image: sort + 合并杂色 + optional constrain -->
          <div class="flex items-center justify-between mb-0.5">
            <div class="text-xs text-ink-muted">本图色板</div>
            <div class="flex items-center gap-1">
              <select v-model="docSort" class="text-micro bg-raised text-ink-body rounded-control px-1 py-0.5 cursor-pointer" title="排序：按数量 / 色相 / 明度（排序后相近的杂色会挨在一起）">
                <option value="count">数量</option>
                <option value="hue">色相</option>
                <option value="lum">明度</option>
              </select>
              <button class="text-micro px-1 rounded-control bg-raised text-ink-body hover:bg-overlay" title="从当前图像重新提取颜色" @click="extractDocPalette">提取</button>
            </div>
          </div>
          <div class="text-micro text-ink-faint mb-1" title="整张图不重复的非透明颜色数（按 RGBA 计）；下方色板只取其中高频前 64 色">
            整图 <span class="text-ink-body tabular-nums">{{ colorCount }}</span> 色 · 色板取前 64
          </div>
          <label class="flex items-center gap-1 text-micro text-ink-muted mb-1 cursor-pointer" title="绘制时把颜色吸附到最接近的色板色 (K)">
            <input type="checkbox" v-model="constrainToPalette" /> 约束到色板 (K)
          </label>
          <label class="flex items-center gap-1 text-micro text-ink-muted mb-1 cursor-pointer" title="先点一个源色，再点目标色，把当前图层中的源色替换为目标色 — 快速并掉杂色">
            <input type="checkbox" v-model="mergeMode" /> 合并杂色（点源色→点目标色）
          </label>
          <div v-if="mergeMode" class="text-micro text-warning-ink-strong/80 mb-1 leading-tight">
            <template v-if="mergeFrom">源色 <span class="font-mono">{{ mergeFrom }}</span> → 点目标色完成替换</template>
            <template v-else>点一个「源色」开始合并</template>
          </div>
          <div v-if="sortedDocPalette.length" class="grid grid-cols-7 gap-1 mb-3">
            <button
              v-for="e in sortedDocPalette"
              :key="e.hex"
              class="w-6 h-6 rounded-control border transition-colors"
              :class="mergeMode && mergeFrom === e.hex ? 'border-warning-ink ring-2 ring-warning-ink' : 'border-border-strong hover:border-white hover:ring-2 hover:ring-accent-ink'"
              :style="{ background: displayHex(e.hex) }"
              :title="`${e.hex} · ${e.n}px${mergeMode ? (mergeFrom ? ' · 点此设为目标色' : ' · 点此设为源色') : ''}`"
              @click="onDocSwatch(e)"
            />
          </div>
          <div v-else class="text-micro text-ink-disabled mb-3">点「提取」从图中取色。</div>

          <template v-if="userPalette.length">
            <div class="text-xs text-ink-muted mb-1">我的色板</div>
            <div class="grid grid-cols-7 gap-1 mb-3">
              <div v-for="(s, i) in userPalette" :key="i" class="relative group">
                <button
                  class="w-6 h-6 rounded-control border border-border-strong block hover:border-white hover:ring-2 hover:ring-accent-ink transition-colors"
                  :style="{ background: displayHex(s) }"
                  :title="s"
                  @click="setColor(s)"
                />
                <button
                  class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-pill bg-danger hover:bg-danger-hover text-white text-[8px] leading-none hidden group-hover:flex items-center justify-center"
                  title="移除"
                  @click.stop="removeUserColor(i)"
                >✕</button>
              </div>
            </div>
          </template>

          <template v-if="recent.length">
            <div class="text-xs text-ink-muted mb-1">最近</div>
            <div class="grid grid-cols-7 gap-1 mb-3">
              <button
                v-for="(s, i) in recent"
                :key="i"
                class="w-6 h-6 rounded-control border border-border-strong hover:border-white hover:ring-2 hover:ring-accent-ink transition-colors"
                :style="{ background: displayHex(s) }"
                :title="s"
                @click="setColor(s)"
              />
            </div>
          </template>

          <div class="text-xs text-ink-muted mb-1">预置色板</div>
          <div class="grid grid-cols-7 gap-1">
            <button
              v-for="c in JP_COLORS"
              :key="c.hex"
              class="w-6 h-6 rounded-control border border-border-strong hover:border-white hover:ring-2 hover:ring-accent-ink transition-colors"
              :style="{ background: c.hex }"
              :title="`${c.name} ${c.hex}`"
              @click="setColor(c.hex)"
            />
          </div>
        </div>

        <!-- ═══ layers ═══ -->
        <div class="w-44 shrink-0 overflow-y-auto text-sm" :style="{ maxHeight: panelMaxH }">
          <!-- preview + seamless-tile preview (moved above the layers panel) -->
          <div class="text-xs text-ink-muted mb-1">预览 ×{{ previewScale }}</div>
          <canvas ref="previewEl" :width="pw * previewScale" :height="ph * previewScale" class="block border border-border-strong max-w-full h-auto mb-2" style="image-rendering: pixelated;" />
          <button class="text-xs text-ink-muted hover:text-ink-secondary block mb-1" title="无缝平铺预览（3×3 环绕），便于检查接缝" @click="tilePreview = !tilePreview">{{ tilePreview ? '▾' : '▸' }} 平铺 3×3</button>
          <canvas v-show="tilePreview" ref="tileEl" :width="pw * 3 * tileScale" :height="ph * 3 * tileScale" class="block border border-border-strong max-w-full h-auto mb-2" style="image-rendering: pixelated;" />
          <div class="border-t border-border mb-2"></div>

          <div class="flex items-center justify-between mb-1">
            <div class="text-xs text-ink-muted">图层</div>
            <div class="flex gap-1">
              <button class="text-micro px-1 rounded-control bg-raised text-ink-body hover:bg-overlay" title="新建栅格图层" @click="addLayer('raster')">＋栅格</button>
              <button class="text-micro px-1 rounded-control bg-raised text-ink-body hover:bg-overlay" title="新建勾填图层（轮廓非破坏推导）" @click="addLayer('contour')">＋勾填</button>
            </div>
          </div>
          <div class="flex gap-1 mb-2">
            <button class="flex-1 px-1 py-0.5 rounded-control bg-raised text-ink-body hover:bg-overlay disabled:opacity-40 text-tiny" :disabled="!canMoveUp" title="上移" @click="reorderLayer(activeIndex, 1)">↑</button>
            <button class="flex-1 px-1 py-0.5 rounded-control bg-raised text-ink-body hover:bg-overlay disabled:opacity-40 text-tiny" :disabled="!canMoveDown" title="下移" @click="reorderLayer(activeIndex, -1)">↓</button>
            <button class="flex-1 px-1 py-0.5 rounded-control bg-raised text-danger-ink-strong hover:bg-danger hover:text-white disabled:opacity-40 text-tiny" :disabled="layers.length <= 1" title="删除图层" @click="removeLayer(activeIndex)">🗑</button>
          </div>
          <div class="flex flex-col gap-0.5 mb-2">
            <div
              v-for="{ l, i } in layersTopFirst"
              :key="l.id"
              :class="['flex items-center gap-1 px-1 py-1 rounded-control cursor-pointer', i === activeIndex ? 'bg-accent-surface ring-1 ring-accent-ink' : 'hover:bg-raised/50']"
              @click="setActiveIndex(i)"
            >
              <button class="w-4 shrink-0 text-center" :title="l.visible ? '隐藏' : '显示'" @click.stop="setLayerVisible(i, !l.visible)">{{ l.visible ? '👁' : '◌' }}</button>
              <span class="text-[9px] px-1 rounded-control shrink-0" :class="l.kind === 'contour' ? 'bg-warning-strong text-on-warning' : 'bg-overlay text-ink-secondary'">{{ l.kind === 'contour' ? '勾' : '栅' }}</span>
              <input
                v-if="renamingLayerId === l.id"
                v-model="renameDraft"
                class="flex-1 min-w-0 bg-canvas px-1 rounded-control text-ink"
                @click.stop
                @keydown.enter="commitRename(i)"
                @blur="commitRename(i)"
              />
              <span v-else class="flex-1 min-w-0 truncate" @dblclick.stop="startRename(i)">{{ l.name }}</span>
            </div>
          </div>
          <template v-if="activeLayer">
            <div class="text-tiny text-ink-muted">不透明度 {{ Math.round((activeLayer.opacity / 255) * 100) }}%</div>
            <input
              type="range"
              min="0"
              max="255"
              step="1"
              :value="activeLayer.opacity"
              class="w-full"
              @pointerdown="beginOpacity"
              @input="setLayerOpacity(activeIndex, ($event.target as HTMLInputElement).valueAsNumber)"
              @change="commitOpacity"
            />
            <template v-if="activeLayer.kind === 'contour'">
              <div class="text-tiny text-ink-muted mt-1">描边宽 {{ activeLayer.width }}px</div>
              <input
                type="range"
                min="1"
                max="8"
                step="1"
                :value="activeLayer.width"
                class="w-full"
                @change="setContourWidth(activeIndex, ($event.target as HTMLInputElement).valueAsNumber)"
              />
            </template>
          </template>
          <div v-if="tool === 'eyedropper'" class="mt-3">
            <div class="text-tiny text-ink-muted">取样来源</div>
            <div class="flex gap-1">
              <button :class="['flex-1 px-1 py-0.5 rounded-control text-tiny', sampleMode === 'active' ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay']" @click="sampleMode = 'active'">本层</button>
              <button :class="['flex-1 px-1 py-0.5 rounded-control text-tiny', sampleMode === 'merged' ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay']" @click="sampleMode = 'merged'">合并</button>
            </div>
          </div>

          <!-- ✨ 智能处理 (CV assist + AI inpaint) — moved below the layers to balance the panels -->
          <div class="border-t border-border my-2"></div>
          <div class="text-xs text-ink-muted mb-1">✨ 智能处理
            <span class="text-ink-faint">{{ hasSel ? '· 仅选区' : '· 整层' }}</span>
          </div>
          <!-- 调色 目标色数（可调，无固定预设）— 拖动会即时刷新预览 -->
          <div class="flex items-center gap-1 mb-1 text-tiny text-ink-muted" title="「调色」的目标颜色数：越少越扁平，越能压掉渐变/杂色">
            <span>色数</span>
            <input type="range" min="2" max="64" step="1" v-model.number="quantizeColors" class="flex-1 min-w-0" />
            <span class="tabular-nums w-6 text-right text-ink-secondary">{{ quantizeColors }}</span>
          </div>
          <div class="grid grid-cols-2 gap-1">
            <button class="px-1 py-1 rounded-control bg-raised text-ink-body hover:bg-overlay text-tiny disabled:opacity-40" :disabled="cvBusy" title="自动移除背景（抠图）。先预览，满意再应用。" @click="applyCv('bg-removal')">抠底</button>
            <button class="px-1 py-1 rounded-control bg-raised text-ink-body hover:bg-overlay text-tiny disabled:opacity-40" :disabled="cvBusy" title="调和到「色数」色板，压掉渐变/杂色。先预览，满意再应用。" @click="applyCv('palette-harmonize')">调色</button>
            <button class="px-1 py-1 rounded-control bg-raised text-ink-body hover:bg-overlay text-tiny disabled:opacity-40" :disabled="cvBusy" title="吸附到像素栅格。先预览，满意再应用。" @click="applyCv('pixelize-grid')">栅格</button>
            <button class="px-1 py-1 rounded-control bg-raised text-ink-body hover:bg-overlay text-tiny disabled:opacity-40" :disabled="cvBusy" title="3×3 中值降噪：消除椒盐杂色，不引入新颜色。先预览，满意再应用。" @click="applyDenoise">降噪</button>
          </div>
          <button class="mt-1 w-full px-1 py-1 rounded-control text-tiny disabled:opacity-40"
            :class="showInpaint ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay'"
            :disabled="cvBusy" title="用 AI 编辑选区/整块（需图像提供方）" @click="showInpaint = !showInpaint">✨ AI 修复</button>
          <div v-if="showInpaint" class="mt-1 flex gap-1">
            <input v-model="inpaintPrompt" placeholder="描述修改（如：去掉路灯）" @keydown.enter="runInpaint"
              class="flex-1 min-w-0 bg-inset border border-border rounded-control px-1.5 py-1 text-tiny text-ink focus:outline-none focus:border-accent-strong" />
            <button :disabled="cvBusy || !inpaintPrompt.trim()" @click="runInpaint"
              class="px-2 py-1 rounded-control bg-accent text-white text-tiny disabled:opacity-40">{{ cvBusy ? '…' : 'GO' }}</button>
          </div>
          <!-- preview bar: try an op without committing; 应用 to keep, 取消 to drop,
               press-hold 原图 to A/B against the unprocessed pixels -->
          <div v-if="hasPreview" class="mt-1 rounded-control border border-accent-strong/60 bg-accent/10 p-1">
            <div class="text-tiny text-accent-ink-strong mb-1">预览：{{ preview?.label }}<span v-if="cvBusy" class="text-ink-muted"> · 处理中…</span></div>
            <div class="grid grid-cols-3 gap-1 text-tiny">
              <button class="px-1 py-0.5 rounded-control bg-raised text-ink-secondary hover:bg-overlay select-none"
                title="按住查看原图（对比）"
                @pointerdown="previewShowOriginal = true; redraw()"
                @pointerup="previewShowOriginal = false; redraw()"
                @pointerleave="previewShowOriginal = false; redraw()"
              >原图</button>
              <button class="px-1 py-0.5 rounded-control bg-raised text-ink-body hover:bg-overlay" title="放弃此次处理 (Esc)" @click="cancelPreview">取消</button>
              <button class="px-1 py-0.5 rounded-control bg-accent text-white hover:bg-accent-strong" title="应用到图层 (Enter)" @click="applyPreview">应用</button>
            </div>
          </div>
          <p v-if="cvError" class="text-micro text-danger-ink">{{ cvError }}</p>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 mt-4">
        <span v-if="dirty" class="mr-auto text-xs text-warning-ink">● 有未保存的修改</span>
        <button class="px-3 py-1 rounded-control bg-raised text-ink-body hover:bg-overlay" title="关闭 (Esc)" @click="requestClose">关闭</button>
        <button
          class="px-3 py-1 rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-50"
          :disabled="saving"
          title="保存 (⌘S / Ctrl+S)"
          @click="save"
        >{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </div>

    <!-- resize-canvas dialog (building editor) -->
    <div v-if="showResize" class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" @click.self="showResize = false">
      <div class="bg-surface border border-border-strong rounded-card p-4 w-72 shadow-popover">
        <h3 class="text-sm font-semibold text-ink-secondary mb-1">调整画布大小</h3>
        <p class="text-tiny text-ink-faint mb-3">当前 {{ cellsX }} × {{ cellsY }} 格（{{ pw }}×{{ ph }}px）。放大在锚点反侧补空白，缩小则裁掉。</p>
        <div class="flex gap-3 mb-3">
          <label class="flex-1 text-xs text-ink-muted">列
            <input type="number" min="1" :max="RESIZE_MAX" v-model.number="resizeCols" class="w-full mt-0.5 px-2 py-1 bg-raised border border-border-strong rounded-control text-sm text-ink-secondary" />
          </label>
          <label class="flex-1 text-xs text-ink-muted">行
            <input type="number" min="1" :max="RESIZE_MAX" v-model.number="resizeRows" class="w-full mt-0.5 px-2 py-1 bg-raised border border-border-strong rounded-control text-sm text-ink-secondary" />
          </label>
        </div>
        <div class="text-xs text-ink-muted mb-1">锚点</div>
        <div class="grid grid-cols-3 gap-1 w-24 mb-3">
          <button
            v-for="(a, i) in resizeAnchors" :key="i"
            @click="resizeAnchorX = a.x; resizeAnchorY = a.y"
            :title="'锚点'"
            :class="['h-7 rounded-control border text-xs leading-none', resizeAnchorX === a.x && resizeAnchorY === a.y ? 'bg-accent border-accent-ink text-white' : 'bg-raised border-border-strong text-ink-faint hover:bg-overlay']"
          >{{ resizeAnchorX === a.x && resizeAnchorY === a.y ? '●' : '·' }}</button>
        </div>
        <p class="text-micro text-warning-ink-strong/70 mb-3">注意：调整尺寸会清空本次撤销历史。</p>
        <div class="flex justify-end gap-2">
          <button class="px-3 py-1 text-sm rounded-control bg-raised hover:bg-overlay text-ink-body" @click="showResize = false">取消</button>
          <button class="px-3 py-1 text-sm rounded-control bg-accent hover:bg-accent-strong text-white" @click="applyResize">应用</button>
        </div>
      </div>
    </div>

    <!-- save-result toast -->
    <div
      v-if="toast"
      class="fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-card shadow-lg text-sm font-medium pointer-events-none"
      :class="toast.ok ? 'bg-success text-white' : 'bg-danger text-white'"
    >{{ toast.text }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, markRaw, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useTilesActivity, type SidecarDoc } from '../../composables/useTilesActivity'
import { useRegionOps } from './pixelEditor/useRegionOps'
import { usePixelPalettes } from './pixelEditor/usePixelPalettes'
import type { Layer, LayerKind, ContourMode } from './pixelEditor/types'
import { serializeLayers, hydrateFromSidecar } from './pixelEditor/sidecar'
import { hexToRgb, toHex, darken } from './pixelEditor/colorUtils'
import { reflowRGBA, rectMask, lassoMask, deriveContour, maskBBox, wandMask } from './pixelEditor/imageOps'
import { JP_COLORS } from './pixelEditor/jpColors'
import { TOOLS, CURSORS, type ToolId } from './pixelEditor/tools'

const props = defineProps<{
  /** Tile id being edited (tile mode). Omit when editing a building group. */
  tileId?: string
  /** Pixel size of one tile cell — drives the per-cell seam grid. */
  tileSize: number
  /** Source (flattened) image URL loaded into the canvas. */
  srcUrl: string
  /** GET URL for the layer sidecar; absent/404 → start from one raster layer. */
  srcLayersUrl?: string
  /** Canvas size in pixels. Defaults to a single square `tileSize` cell; a
   *  building group passes its full composed size (w*cell × h*cell). */
  pxWidth?: number
  pxHeight?: number
  /** Header title override (defaults to “编辑瓦片 <id>”). */
  title?: string
  /** Allow renaming via the header title (shows a ✎; commits emit `rename`). */
  titleEditable?: boolean
  /** Persist the flattened PNG + layer sidecar; return true on success. When
   *  omitted, saves to the tile library under `tileId`. A building group passes a
   *  callback that writes its composed image + sidecar. */
  persist?: (dataUrl: string, layers: SidecarDoc) => Promise<boolean>
  /** Render inline (fills its container) instead of as a centered modal. Used
   *  for the building editor embedded in 建筑 mode. */
  embedded?: boolean
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'resized', w: number, h: number): void; (e: 'rename', value: string): void }>()

const tilesStore = useTilesActivity()
const embedded = computed(() => !!props.embedded)
/** Backdrop click closes the modal, but there's no backdrop when embedded. */
function onBackdrop() { if (!embedded.value) requestClose() }
/** Column/canvas height cap: viewport-relative as a modal, fill when embedded. */
const panelMaxH = computed(() => (embedded.value ? '100%' : '80vh'))

// Canvas geometry in tile-pixels. `cell` is one tile's size (for the seam grid);
// `pw`×`ph` is the whole editable canvas — one cell for a tile, the full composed
// size for a building group; `cellsX`×`cellsY` is how many tile cells that spans.
const cell = props.tileSize
// pw/ph/cellsX/cellsY are mutable so the canvas can be resized in-place; `dims`
// is bumped on resize so size-derived computeds + the render re-evaluate them.
let pw = props.pxWidth ?? props.tileSize
let ph = props.pxHeight ?? props.tileSize
let cellsX = Math.max(1, Math.round(pw / cell))
let cellsY = Math.max(1, Math.round(ph / cell))
const dims = ref(0)
const displayTitle = computed(() => props.title ?? `编辑瓦片 ${props.tileId ?? ''}`)
// Inline title rename (only when `titleEditable`). Commit emits `rename` with the
// trimmed text; the parent owns what a rename means (e.g. a building's name).
const editingTitle = ref(false)
const titleDraft = ref('')
function startTitleEdit() {
  if (!props.titleEditable) return
  titleDraft.value = props.title ?? ''
  editingTitle.value = true
}
function commitTitleEdit() {
  if (!editingTitle.value) return
  const v = titleDraft.value.trim()
  editingTitle.value = false
  if (v && v !== (props.title ?? '')) emit('rename', v)
}
function cancelTitleEdit() { editingTitle.value = false }
/** Autofocus + select the rename field the moment it mounts. */
function onTitleInput(el: unknown) { if (el) { const i = el as HTMLInputElement; i.focus(); i.select() } }
// Editing zoom (px per tile-pixel). Defaults to a large, comfortable canvas;
// at higher zoom the canvas scrolls within the popup. Adjustable ZOOM_MIN–MAX.
const ZOOM_MIN = 8
const ZOOM_MAX = 80
const zoom = ref(Math.min(ZOOM_MAX, Math.max(8, Math.round(640 / Math.max(pw, ph)))))

function zoomBy(delta: number) {
  zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.value + delta))
}

// Grid-line shade (0 = black … 255 = white) so the cell grid stays legible on
// any tile colours. Default mid-grey.
const gridShade = ref(160)
/** Whether the per-pixel grid overlay is drawn. */
const showGrid = ref(true)

// Preview brightness (%, 100 = off). PURELY VISUAL — scales the displayed
// channels in redraw without touching `buf`, so saving is unaffected. Because
// it's multiplicative, pushing it up amplifies the gap between near-identical
// colours, making AI noise / off-pixels (杂色) pop out for inspection.
const brightness = ref(100)

const previewEl = ref<HTMLCanvasElement | null>(null)
// Small live preview of the whole tile at ~64px (true colours, no grid, no
// brightness) so the overall tile reads at a glance while zoomed in for edits.
const previewScale = computed(() => { void dims.value; return Math.max(1, Math.floor(64 / Math.max(pw, ph))) })
// Main canvas size in screen px (reacts to zoom and to resize via `dims`).
const canvasW = computed(() => { void dims.value; return pw * zoom.value })
const canvasH = computed(() => { void dims.value; return ph * zoom.value })

const tool = ref<ToolId>('pencil')
const color = ref('#ffffff')

// ── 勾填笔 (contour pen) — two tones at once: a dark OUTLINE on the shape's edge
// and a light FILL inside (勾线填色). It paints an opaque SILHOUETTE onto a contour
// LAYER; the dark inner outline is derived non-destructively at render time from
// that layer's own alpha edge (deriveContour), so a 1–2px stroke reads as pure
// outline and a ≥3px area grows a lit interior. `contourSlot` is which tone the
// palette / picker / eyedropper edit.
// Contour tones live on the active contour LAYER (non-destructive: the silhouette
// is stored, the outline is derived at render). These computeds read/write the
// active layer's params so the existing contour UI keeps working per-layer.
// Chosen contour tones, kept in standalone refs so they can be set BEFORE a
// contour layer exists (picking colours with 勾填笔 selected, pre-first-stroke).
// mkLayer seeds a new contour layer from these; once one is active, the computeds
// mirror edits onto it too (per-layer tones preserved).
const contourOutline = ref('#1c1c1c')
const contourFill = ref('#ffffff')
const outlineColor = computed<string>({
  get: () => (activeLayer.value?.kind === 'contour' ? activeLayer.value.outline : contourOutline.value),
  set: (v) => {
    contourOutline.value = v // remember for the next contour layer
    const L = activeLayer.value
    if (L && L.kind === 'contour') {
      L.outline = v
      bumpContour()
      markDirty() // outline tone bakes into the saved PNG + sidecar
    }
  },
})
const fillColor = computed<string>({
  get: () => (activeLayer.value?.kind === 'contour' ? activeLayer.value.fill : contourFill.value),
  set: (v) => {
    contourFill.value = v // remember for the next contour layer
    const L = activeLayer.value
    if (L && L.kind === 'contour') {
      L.fill = v
      bumpContour()
      markDirty() // fill tone bakes into the saved PNG + sidecar
    }
  },
})
// ── 勾填笔 shading style (per contour layer, like the tones) — standalone refs so
// they can be chosen before a contour layer exists; the computeds mirror onto the
// active contour layer and re-derive. See ContourMode for what each does.
const contourMode = ref<ContourMode>('flat')
const contourLevels = ref(3)
const contourAngle = ref(135)
/** Apply a mutation to the active contour layer (if any) + re-derive/redraw. */
function applyContour(mut: (L: Layer) => void) {
  const L = activeLayer.value
  if (L && L.kind === 'contour') {
    mut(L)
    bumpContour()
    markDirty() // shading bakes into the saved PNG + sidecar
  }
  redraw()
}
const layerMode = computed<ContourMode>({
  get: () => (activeLayer.value?.kind === 'contour' ? activeLayer.value.mode : contourMode.value),
  set: (v) => { contourMode.value = v; applyContour((L) => { L.mode = v }) },
})
const layerLevels = computed<number>({
  get: () => (activeLayer.value?.kind === 'contour' ? activeLayer.value.levels : contourLevels.value),
  set: (v) => { const n = Math.max(2, Math.min(6, Math.round(v) || 2)); contourLevels.value = n; applyContour((L) => { L.levels = n }) },
})
const layerAngle = computed<number>({
  get: () => (activeLayer.value?.kind === 'contour' ? activeLayer.value.angle : contourAngle.value),
  set: (v) => { const a = ((Math.round(v) % 360) + 360) % 360; contourAngle.value = a; applyContour((L) => { L.angle = a }) },
})
const CONTOUR_MODES: { id: ContourMode; label: string; title: string }[] = [
  { id: 'flat', label: '单层', title: '经典：深色描边 + 平涂填充' },
  { id: 'ring', label: '层叠描边', title: '等宽色带自边缘向内递进，芯部平涂（描边宽度=色带宽度）' },
  { id: 'ramp', label: '内渐变', title: '由边缘到中心的整体渐变，色带随形状缩放' },
  { id: 'directional', label: '光照', title: '沿光照方向的立体渐变（可调光向）' },
]
const contourSlot = ref<'outline' | 'fill'>('fill')
const activeColor = computed(() =>
  tool.value === 'contour'
    ? contourSlot.value === 'outline' ? outlineColor.value : fillColor.value
    : color.value,
)
/** Route a chosen colour (palette / picker / eyedropper) to the active slot. */
function setColor(hex: string) {
  if (tool.value === 'contour') {
    if (contourSlot.value === 'outline') {
      outlineColor.value = hex
    } else {
      // Picking ONE colour for 勾填笔 sets the fill AND auto-derives a darker
      // outline, so a single pick always yields a proper dark-edge / light-fill
      // split (no more "draws like a pencil"). Switch to the 轮廓 slot to override
      // the edge tone afterwards.
      fillColor.value = hex
      outlineColor.value = darken(hex)
    }
    redraw() // re-derive the active contour layer with the new tone(s)
  } else {
    color.value = hex
  }
}
// ════════════════════════════════════════════════════════════════════════
// Pro tools — brush, opacity, secondary colour, modifiers, shapes, transforms,
// and view aids. The editor is full-colour: alpha is meaningful (contour ink
// stays opaque). Shared so brush size / right-click colour / shapes all compose.
// ════════════════════════════════════════════════════════════════════════

// ── Brush ──
const BRUSH_MIN = 1
const BRUSH_MAX = 8
const brushSize = ref(1)
const brushShape = ref<'square' | 'round'>('square')
function brushBy(d: number) {
  brushSize.value = Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, brushSize.value + d))
}

// ── Opacity (full-colour). Default 255 keeps today's behaviour. Contour is
// forced opaque (its split keys on a===255), so its alpha slider is hidden. ──
const alpha = ref(255)

// ── Colour palettes (working / user / recent) — extracted to a composable.
const {
  recent, noteRecent,
  userPalette, storeColor, removeUserColor,
  docPalette, sortedDocPalette, docSort, constrainToPalette,
  extractDocPalette, nearestPaletteColor, pickDoc, onDocSwatch,
  mergeMode, mergeFrom, displayHex,
} = usePixelPalettes({
  composite: () => composite,
  buildComposite,
  activeColor,
  brightness,
  alpha,
  setColor,
  replaceColor: (from, to) => { replaceFrom.value = from; replaceTo.value = to; return doReplace() },
  showToast,
})

// ── Secondary colour, painted by right-click (Aseprite FG/BG). Contour uses its
// own two slots, so X there swaps outline/fill instead. ──
const secondaryColor = ref('#000000')
function swapColors() {
  if (tool.value === 'contour') {
    const t = outlineColor.value
    outlineColor.value = fillColor.value
    fillColor.value = t
    return
  }
  const t = color.value
  color.value = secondaryColor.value
  secondaryColor.value = t
}

// ── Modifier live-state (cursor display only; e.altKey/e.shiftKey are the source
// of truth at action time). ──
const altDown = ref(false)
const shiftDown = ref(false)
const spaceHeld = ref(false)
function clearMods() {
  altDown.value = false
  shiftDown.value = false
  spaceHeld.value = false
  if (panning.value) {
    panning.value = false
    panStart = null
  }
  // Finalize any in-flight stroke / selection drag so a blur with the button
  // down can't leave it wedged (which would make plain hovers keep dragging).
  if (dragging()) onUp()
}

// End of the previous committed stroke, so Shift+click draws a line to it.
let lastPainted: { x: number; y: number } | null = null

// ── Shapes ──
const shapeFill = ref(false)
let shapeStart: { x: number; y: number } | null = null
let shapeSnapshot: Uint8ClampedArray | null = null
function isShapeTool(t: ToolId) {
  return t === 'line' || t === 'rect' || t === 'ellipse'
}

// ── Transforms ──
// Rotate is only offered for square canvases (all tiles + square buildings); it
// then preserves pw/ph, so dims stay const and undo stays a plain buffer swap.
const canRotate = computed(() => { void dims.value; return pw === ph })
const replacing = ref(false)
const replaceFrom = ref<string | null>(null)
const replaceTo = ref('#ffffff')
const pickReplaceFrom = ref(false)

// ── View ──
const scrollEl = ref<HTMLDivElement | null>(null)
const panning = ref(false)
let panStart: { x: number; y: number; sl: number; st: number } | null = null
const cursorPx = ref<{ x: number; y: number } | null>(null)
const tileEl = ref<HTMLCanvasElement | null>(null)
const tilePreview = ref(false)
const tileScale = computed(() => { void dims.value; return Math.max(1, Math.floor(96 / Math.max(pw, ph))) })

const canvasCursor = computed(() =>
  panning.value
    ? 'grabbing'
    : spaceHeld.value
      ? 'grab'
      : altDown.value
        ? CURSORS.eyedropper
        : CURSORS[tool.value],
)

// ── Paint pipeline: arm the stroke colour once, then stamp an N-px brush. ──
let strokeR = 255
let strokeG = 255
let strokeB = 255
let strokeA = 255
let strokeErase = false
function armPaint(secondary: boolean) {
  strokeErase = tool.value === 'erase'
  if (strokeErase) return
  const hex = tool.value === 'contour' ? fillColor.value : secondary ? secondaryColor.value : color.value
  let [r, g, b] = hexToRgb(hex)
  // Optional: snap painted colours to the working palette (never for contour,
  // whose two tones must stay exact for its outline/fill split).
  if (constrainToPalette.value && tool.value !== 'contour') [r, g, b] = nearestPaletteColor(r, g, b)
  strokeR = r
  strokeG = g
  strokeB = b
  // Contour paints an opaque silhouette (deriveContour keys on a===255); other
  // tools honour the opacity slider.
  strokeA = tool.value === 'contour' ? 255 : alpha.value
}
function writeBrushPixel(x: number, y: number) {
  if (x < 0 || y < 0 || x >= pw || y >= ph) return
  if (strokeErase) setPixel(x, y, 0, 0, 0, 0)
  else setPixel(x, y, strokeR, strokeG, strokeB, strokeA)
}
function stampBrush(cx: number, cy: number) {
  const n = brushSize.value
  if (n <= 1) {
    writeBrushPixel(cx, cy)
    return
  }
  const lo = -Math.floor((n - 1) / 2)
  const hi = lo + n - 1
  const r = n / 2
  const r2 = r * r
  for (let dy = lo; dy <= hi; dy++) {
    for (let dx = lo; dx <= hi; dx++) {
      if (brushShape.value === 'round') {
        const ox = dx + 0.5 - (lo + r)
        const oy = dy + 0.5 - (lo + r)
        if (ox * ox + oy * oy > r2) continue
      }
      writeBrushPixel(cx + dx, cy + dy)
    }
  }
}
function noteStrokeRecent(secondary: boolean) {
  if (tool.value === 'erase') return
  if (tool.value === 'contour') {
    noteRecent(outlineColor.value)
    noteRecent(fillColor.value)
  } else {
    noteRecent(secondary ? secondaryColor.value : color.value)
  }
}

// Constrain b to horizontal / vertical / 45° relative to anchor a.
function constrain(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx > ady * 2) return { x: b.x, y: a.y }
  if (ady > adx * 2) return { x: a.x, y: b.y }
  const m = Math.min(adx, ady)
  return { x: a.x + Math.sign(dx) * m, y: a.y + Math.sign(dy) * m }
}

// Rasterize the active shape from anchor a to point raw into `buf` via stampBrush
// (caller has restored the pre-shape snapshot). Shift constrains: line→H/V/45°,
// rect→square, ellipse→circle.
function rasterizeShape(a: { x: number; y: number }, raw: { x: number; y: number }, shift: boolean) {
  let b = raw
  if (shift) {
    if (tool.value === 'line') {
      b = constrain(a, raw)
    } else {
      // square / circle: equal extent toward the cursor. Treat a zero delta as
      // positive (Math.sign(0)===0 would otherwise flatten an axis-aligned drag).
      const dx = raw.x - a.x
      const dy = raw.y - a.y
      const m = Math.max(Math.abs(dx), Math.abs(dy))
      const sgx = dx < 0 ? -1 : 1
      const sgy = dy < 0 ? -1 : 1
      b = { x: a.x + sgx * m, y: a.y + sgy * m }
    }
  }
  if (tool.value === 'line') {
    lineEach(a.x, a.y, b.x, b.y, stampBrush)
    return
  }
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  if (tool.value === 'rect') {
    if (shapeFill.value) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) stampBrush(x, y)
    } else {
      lineEach(x0, y0, x1, y0, stampBrush)
      lineEach(x0, y1, x1, y1, stampBrush)
      lineEach(x0, y0, x0, y1, stampBrush)
      lineEach(x1, y0, x1, y1, stampBrush)
    }
    return
  }
  rasterizeEllipse(x0, y0, x1, y1)
}
function rasterizeEllipse(x0: number, y0: number, x1: number, y1: number) {
  const rx = (x1 - x0) / 2
  const ry = (y1 - y0) / 2
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  if (rx === 0 || ry === 0) {
    lineEach(x0, y0, x1, y1, stampBrush)
    return
  }
  if (shapeFill.value) {
    // Use the same index-centred convention as the outline below (cx/cy/rx/ry),
    // so the fill is vertically symmetric and matches the outline rather than
    // dropping the bottom row.
    for (let y = y0; y <= y1; y++) {
      const ny = (y - cy) / ry
      if (ny * ny > 1) continue
      const span = rx * Math.sqrt(1 - ny * ny)
      lineEach(Math.round(cx - span), y, Math.round(cx + span), y, stampBrush)
    }
    return
  }
  // Outline: sample the perimeter densely and connect samples so it never gaps.
  const steps = Math.max(16, Math.ceil((rx + ry) * 4))
  let px = -1
  let py = -1
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const x = Math.round(cx + rx * Math.cos(t))
    const y = Math.round(cy + ry * Math.sin(t))
    if (px < 0) stampBrush(x, y)
    else if (x !== px || y !== py) lineEach(px, py, x, y, stampBrush)
    px = x
    py = y
  }
}

// Commit a rebuilt buffer, but skip the undo entry + redraw when nothing actually
// changed (so flipping a symmetric / blank tile leaves no phantom undo step).
function applyTransform(out: Uint8ClampedArray) {
  if (dragging()) return // don't reindex buf out from under an in-flight stroke/drag
  let changed = false
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== buf[i]) {
      changed = true
      break
    }
  }
  if (!changed) return
  pushUndo()
  buf.set(out) // mutate the active layer in place (the Layer + graveyard alias it)
  commitUndo()
  bumpContour() // a contour layer's silhouette may have been transformed
  // the buffer was reindexed: the Shift+click anchor and selection rect are stale
  lastPainted = null
  sel.value = null
  redraw()
}

// Flips (dim-preserving) and 90° rotations (square only) rebuild `buf` fresh.
function flipH() {
  const out = new Uint8ClampedArray(buf.length)
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const si = (y * pw + x) * 4
      const di = (y * pw + (pw - 1 - x)) * 4
      out[di] = buf[si]
      out[di + 1] = buf[si + 1]
      out[di + 2] = buf[si + 2]
      out[di + 3] = buf[si + 3]
    }
  applyTransform(out)
}
function flipV() {
  const out = new Uint8ClampedArray(buf.length)
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const si = (y * pw + x) * 4
      const di = ((ph - 1 - y) * pw + x) * 4
      out[di] = buf[si]
      out[di + 1] = buf[si + 1]
      out[di + 2] = buf[si + 2]
      out[di + 3] = buf[si + 3]
    }
  applyTransform(out)
}
function rotateCW() {
  if (pw !== ph) return
  const out = new Uint8ClampedArray(buf.length)
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const si = (y * pw + x) * 4
      const di = (x * pw + (ph - 1 - y)) * 4 // (nx,ny)=(ph-1-y, x), stride=pw
      out[di] = buf[si]
      out[di + 1] = buf[si + 1]
      out[di + 2] = buf[si + 2]
      out[di + 3] = buf[si + 3]
    }
  applyTransform(out)
}
function rotateCCW() {
  if (pw !== ph) return
  const out = new Uint8ClampedArray(buf.length)
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const si = (y * pw + x) * 4
      const di = ((pw - 1 - x) * pw + y) * 4 // (nx,ny)=(y, pw-1-x), stride=pw
      out[di] = buf[si]
      out[di + 1] = buf[si + 1]
      out[di + 2] = buf[si + 2]
      out[di + 3] = buf[si + 3]
    }
  applyTransform(out)
}

// ── Canvas resize (building editor) ──────────────────────────────────────────
// Change the tile 列×行, re-flowing every layer's pixels at the chosen anchor
// (grow pads the opposite sides, shrink crops them). Structural, so it clears
// undo history; the new size is reported to the parent so the group persists it.
const RESIZE_MAX = 64
const showResize = ref(false)
const resizeCols = ref(cellsX)
const resizeRows = ref(cellsY)
const resizeAnchorX = ref<'left' | 'center' | 'right'>('left')
const resizeAnchorY = ref<'top' | 'middle' | 'bottom'>('top')
const resizeAnchors: { x: 'left' | 'center' | 'right'; y: 'top' | 'middle' | 'bottom' }[] = [
  { x: 'left', y: 'top' }, { x: 'center', y: 'top' }, { x: 'right', y: 'top' },
  { x: 'left', y: 'middle' }, { x: 'center', y: 'middle' }, { x: 'right', y: 'middle' },
  { x: 'left', y: 'bottom' }, { x: 'center', y: 'bottom' }, { x: 'right', y: 'bottom' },
]
function openResize() {
  resizeCols.value = cellsX
  resizeRows.value = cellsY
  resizeAnchorX.value = 'left'
  resizeAnchorY.value = 'top'
  showResize.value = true
}
function applyResize() {
  const newCX = Math.max(1, Math.min(RESIZE_MAX, Math.round(Number(resizeCols.value)) || 1))
  const newCY = Math.max(1, Math.min(RESIZE_MAX, Math.round(Number(resizeRows.value)) || 1))
  showResize.value = false
  if (newCX === cellsX && newCY === cellsY) return
  if (dragging()) onUp() // seal any in-flight stroke first
  const newPw = newCX * cell, newPh = newCY * cell
  const oldPw = pw, oldPh = ph
  const offX = resizeAnchorX.value === 'left' ? 0 : resizeAnchorX.value === 'right' ? newPw - oldPw : Math.floor((newPw - oldPw) / 2)
  const offY = resizeAnchorY.value === 'top' ? 0 : resizeAnchorY.value === 'bottom' ? newPh - oldPh : Math.floor((newPh - oldPh) / 2)
  for (const L of layers.value) {
    const next = markRaw(reflowRGBA(L.data, oldPw, oldPh, newPw, newPh, offX, offY))
    L.data = next
    buffers.set(L.id, next)
  }
  composite = markRaw(new Uint8ClampedArray(newPw * newPh * 4))
  pw = newPw; ph = newPh; cellsX = newCX; cellsY = newCY
  syncBuf()
  selMask.value = null
  sel.value = null
  cancelPreview()
  // A structural change: the per-layer / struct undo snapshots encode the old size.
  undoStack.length = 0
  redoStack.length = 0
  canUndo.value = false
  canRedo.value = false
  bumpContour()
  dims.value++ // refresh size-derived computeds + re-render the canvas
  markDirty()
  emit('resized', newCX, newCY)
  void nextTick(() => { redraw(); drawPreview(); drawTilePreview() })
}

function openReplace() {
  replacing.value = true
  replaceFrom.value = activeColor.value
  replaceTo.value = color.value
  pickReplaceFrom.value = false
}
// Dismiss the replace panel AND disarm the colour-pick, so a cancelled pick can't
// silently swallow the next canvas click.
function closeReplace() {
  replacing.value = false
  pickReplaceFrom.value = false
}
// Replace `replaceFrom` with `replaceTo` across the ACTIVE layer. Returns true only
// when it actually rewrote pixels (so the 合并杂色 caller can flag a silent no-op —
// e.g. a colour that lives on another / a contour layer, not the active `buf`).
function doReplace(): boolean {
  if (!replaceFrom.value || dragging()) return false
  const [fr, fg, fb] = hexToRgb(replaceFrom.value)
  const [tr, tg, tb] = hexToRgb(replaceTo.value)
  // Compare on RGB (not raw hex) so a case-only difference (#FFFFFF vs #ffffff)
  // is still a no-op rather than a phantom undo step.
  if (fr === tr && fg === tg && fb === tb) {
    closeReplace()
    return false
  }
  // Bail (no undo entry) if nothing opaque matches the "from" colour.
  let any = false
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] !== 0 && buf[i] === fr && buf[i + 1] === fg && buf[i + 2] === fb) {
      any = true
      break
    }
  }
  if (!any) {
    closeReplace()
    return false
  }
  pushUndo()
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] === 0) continue
    if (buf[i] === fr && buf[i + 1] === fg && buf[i + 2] === fb) {
      buf[i] = tr
      buf[i + 1] = tg
      buf[i + 2] = tb
    }
  }
  noteRecent(replaceTo.value)
  commitUndo()
  closeReplace()
  redraw()
  return true
}

// ── Pan the scroll container (space-drag or middle-drag) ──
function onPanDown(e: PointerEvent) {
  if (!(e.button === 1 || (e.button === 0 && spaceHeld.value))) return
  e.preventDefault()
  e.stopPropagation()
  panning.value = true
  scrollEl.value!.setPointerCapture(e.pointerId)
  panStart = { x: e.clientX, y: e.clientY, sl: scrollEl.value!.scrollLeft, st: scrollEl.value!.scrollTop }
}
function onPanMove(e: PointerEvent) {
  if (!panning.value || !panStart) return
  e.preventDefault()
  scrollEl.value!.scrollLeft = panStart.sl - (e.clientX - panStart.x)
  scrollEl.value!.scrollTop = panStart.st - (e.clientY - panStart.y)
}
function onPanUp(e: PointerEvent) {
  if (!panning.value) return
  panning.value = false
  panStart = null
  try {
    scrollEl.value!.releasePointerCapture(e.pointerId)
  } catch {
    /* capture may already be lost */
  }
}

// 3×3 wrap-around preview so seams are visible (true colours, no grid/brightness).
function drawTilePreview() {
  if (!tilePreview.value) return
  const cv = tileEl.value
  if (!cv) return
  const s = tileScale.value
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  for (let y = 0; y < ph * 3; y++)
    for (let x = 0; x < pw * 3; x++) {
      ctx.fillStyle = (x + y) & 1 ? '#3a3a3a' : '#2c2c2c'
      ctx.fillRect(x * s, y * s, s, s)
    }
  const off = document.createElement('canvas')
  off.width = pw
  off.height = ph
  off.getContext('2d')!.putImageData(new ImageData(composite.slice(), pw, ph), 0, 0)
  for (let ty = 0; ty < 3; ty++)
    for (let tx = 0; tx < 3; tx++) ctx.drawImage(off, 0, 0, pw, ph, tx * pw * s, ty * ph * s, pw * s, ph * s)
  ctx.strokeStyle = 'rgba(99,102,241,0.7)'
  ctx.lineWidth = 1
  ctx.strokeRect(pw * s + 0.5, ph * s + 0.5, pw * s - 1, ph * s - 1)
}

// ════════════════════════════════════════════════════════════════════════
// Selection + clipboard. The selection is a rectangle (sel); moving it lifts a
// transient `float` (the pixels + their hole) that exists ONLY during the drag
// and is stamped back on pointer-up — so undo stays one whole-buffer snapshot
// per op with no cross-operation float bookkeeping. copy/cut/paste use an
// in-app clipboard; paste lands the pixels directly (drag to reposition).
// ════════════════════════════════════════════════════════════════════════
const sel = ref<{ x: number; y: number; w: number; h: number } | null>(null)
let float: { buf: Uint8ClampedArray; w: number; h: number; ox: number; oy: number } | null = null
let clipboard: { buf: Uint8ClampedArray; w: number; h: number } | null = null
const clipRev = ref(0)
const hasSel = computed(() => !!sel.value)
const hasClip = computed(() => {
  void clipRev.value // clipboard is a plain let; clipRev forces recompute
  return clipboard !== null
})
let selDragging = false
let selAnchor: { x: number; y: number } | null = null
let floatDragging = false
let floatGrab: { dx: number; dy: number } | null = null
let floatLifted = false // has a move actually lifted the float (vs a bare click)?
function dragging() {
  return drawing || floatDragging || selDragging
}
// Tear down any in-flight selection drag, committing a lifted float. Tool-agnostic
// so a mid-drag tool switch / deselect can never leave a flag latched (which would
// wedge dragging() and silently kill undo/clipboard).
function endSelDrag() {
  if (floatDragging) {
    if (floatLifted) {
      stampFloat()
      commitUndo() // seal the move: before = pre-lift (armed on first move), after = stamped
      // The pixels moved; re-anchor the mask to the new bbox so its outline (and
      // any region op) follows them rather than staying at the old spot.
      if (sel.value) selMask.value = rectMask(pw, ph, sel.value.x, sel.value.y, sel.value.w, sel.value.h)
    }
    floatDragging = false
    floatGrab = null
    floatLifted = false
  }
  if (selDragging) {
    selDragging = false
    selAnchor = null
  }
}

function rawPixel(e: PointerEvent): { x: number; y: number } {
  const cv = canvasEl.value!
  const r = cv.getBoundingClientRect()
  return {
    x: Math.floor((e.clientX - r.left) / zoom.value),
    y: Math.floor((e.clientY - r.top) / zoom.value),
  }
}
function clampedPixel(e: PointerEvent): { x: number; y: number } {
  const p = rawPixel(e)
  return { x: Math.max(0, Math.min(pw - 1, p.x)), y: Math.max(0, Math.min(ph - 1, p.y)) }
}

// Lift the current selection's pixels into `float` and clear the source hole.
function liftFloat() {
  const s = sel.value
  if (!s) return
  const fb = new Uint8ClampedArray(s.w * s.h * 4)
  for (let yy = 0; yy < s.h; yy++) {
    for (let xx = 0; xx < s.w; xx++) {
      const sx = s.x + xx
      const sy = s.y + yy
      const di = (yy * s.w + xx) * 4
      // The selection can hang off-canvas (the move tool drags with raw, unclamped
      // coords); skip out-of-bounds source cells so we never read/zero a wrapped
      // index into a neighbouring row (which would corrupt unrelated pixels). The
      // off-canvas part of the float stays transparent — those pixels were already
      // clipped away by stampFloat on the prior drop, so there is nothing to lift.
      if (sx < 0 || sy < 0 || sx >= pw || sy >= ph) {
        fb[di] = 0
        fb[di + 1] = 0
        fb[di + 2] = 0
        fb[di + 3] = 0
        continue
      }
      // Honour an irregular mask: only lift/clear pixels actually selected.
      if (selMask.value && !selMask.value[sy * pw + sx]) {
        fb[di] = 0; fb[di + 1] = 0; fb[di + 2] = 0; fb[di + 3] = 0
        continue
      }
      const si = (sy * pw + sx) * 4
      fb[di] = buf[si]
      fb[di + 1] = buf[si + 1]
      fb[di + 2] = buf[si + 2]
      fb[di + 3] = buf[si + 3]
      buf[si] = 0
      buf[si + 1] = 0
      buf[si + 2] = 0
      buf[si + 3] = 0
    }
  }
  if (activeLayer.value.kind === 'contour') bumpContour() // the silhouette lost a hole → re-derive
  float = { buf: fb, w: s.w, h: s.h, ox: s.x, oy: s.y }
}
// Composite the floating pixels back into `buf` at their current offset (copy
// non-transparent pixels; clip to canvas bounds), then drop the float.
function stampFloat() {
  if (!float) return
  const { buf: fb, w, h, ox, oy } = float
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const di = (yy * w + xx) * 4
      if (fb[di + 3] === 0) continue
      const x = ox + xx
      const y = oy + yy
      if (x < 0 || y < 0 || x >= pw || y >= ph) continue
      const si = (y * pw + x) * 4
      buf[si] = fb[di]
      buf[si + 1] = fb[di + 1]
      buf[si + 2] = fb[di + 2]
      buf[si + 3] = fb[di + 3]
    }
  }
  float = null
}
function copySel() {
  const s = sel.value
  if (!s) return
  const cb = new Uint8ClampedArray(s.w * s.h * 4)
  for (let yy = 0; yy < s.h; yy++) {
    for (let xx = 0; xx < s.w; xx++) {
      const gx = s.x + xx, gy = s.y + yy
      const di = (yy * s.w + xx) * 4
      if (selMask.value && !selMask.value[gy * pw + gx]) continue // unselected → transparent
      const si = (gy * pw + gx) * 4
      cb[di] = buf[si]
      cb[di + 1] = buf[si + 1]
      cb[di + 2] = buf[si + 2]
      cb[di + 3] = buf[si + 3]
    }
  }
  clipboard = { buf: cb, w: s.w, h: s.h }
  clipRev.value++
}
function cutSel() {
  const s = sel.value
  if (!s || dragging()) return
  pushUndo()
  copySel()
  for (let yy = 0; yy < s.h; yy++) {
    for (let xx = 0; xx < s.w; xx++) {
      const gx = s.x + xx, gy = s.y + yy
      if (selMask.value && !selMask.value[gy * pw + gx]) continue // only clear selected pixels
      const si = (gy * pw + gx) * 4
      buf[si] = 0
      buf[si + 1] = 0
      buf[si + 2] = 0
      buf[si + 3] = 0
    }
  }
  commitUndo()
  redraw()
}
function pasteClip() {
  if (!clipboard || dragging()) return
  pushUndo()
  const { buf: cb, w, h } = clipboard
  const s = sel.value
  let ox = s ? s.x : Math.floor((pw - w) / 2)
  let oy = s ? s.y : Math.floor((ph - h) / 2)
  ox = Math.max(0, Math.min(pw - w, ox))
  oy = Math.max(0, Math.min(ph - h, oy))
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const di = (yy * w + xx) * 4
      if (cb[di + 3] === 0) continue
      const x = ox + xx
      const y = oy + yy
      if (x < 0 || y < 0 || x >= pw || y >= ph) continue
      const si = (y * pw + x) * 4
      buf[si] = cb[di]
      buf[si + 1] = cb[di + 1]
      buf[si + 2] = cb[di + 2]
      buf[si + 3] = cb[di + 3]
    }
  }
  commitUndo()
  sel.value = { x: ox, y: oy, w: Math.min(w, pw), h: Math.min(h, ph) }
  tool.value = 'select'
  redraw()
}
function selectAll() {
  selMask.value = new Uint8Array(pw * ph).fill(1)
  sel.value = { x: 0, y: 0, w: pw, h: ph }
  cancelPreview()
  redraw()
}
function deselect() {
  endSelDrag()
  sel.value = null
  selMask.value = null
  cancelPreview()
  redraw()
}

/** Clear the selected pixels to transparent (Backspace/Delete) — like erasing
 *  exactly the selection. One undo entry; the selection itself stays. */
function clearSelectionPixels() {
  const m = selMask.value
  if (!m) return
  cancelPreview()
  pushUndo()
  for (let i = 0; i < pw * ph; i++) {
    if (!m[i]) continue
    const di = i * 4
    buf[di] = 0; buf[di + 1] = 0; buf[di + 2] = 0; buf[di + 3] = 0
  }
  if (activeLayer.value.kind === 'contour') bumpContour()
  commitUndo()
  redraw()
  markDirty()
}

// ── Per-pixel selection mask ─────────────────────────────────────────────────
// `sel` (the rect above) stays the *bounding box* used by move/copy/paste, but
// the authoritative "which pixels do region ops touch" is this per-pixel mask
// (0/1, length pw*ph). The wand/lasso/rect tools build it; CV + denoise + the
// non-destructive preview all honour it, so you can isolate one "part" of a
// multi-part tile and experiment there without touching the rest.
const selMask = ref<Uint8Array | null>(null)
/** How a new selection combines with the existing one. */
const selOp = ref<'replace' | 'add' | 'subtract' | 'intersect'>('replace')
/** Magic-wand colour tolerance (max per-channel diff) and contiguous/global. */
const wandTol = ref(24)
const wandGlobal = ref(false)
/** Live freehand path while the lasso is dragging (pixel coords). */
let lassoPts: { x: number; y: number }[] = []
const lassoDragging = ref(false)
/** Shift-at-gesture-start → force 'add' for rect / lasso (committed on up). */
let lassoForceAdd = false
let selRectForceAdd = false

/** Keep `sel` (bbox) in step with the mask so move/copy/marquee extents work. */
function syncSelFromMask() {
  sel.value = selMask.value ? maskBBox(selMask.value, pw, ph) : null
}

/** Combine a freshly-painted mask with the current selection per `selOp`
 *  (Shift forces add). Empty result → no selection. */
function commitMask(raw: Uint8Array, forceAdd = false) {
  const mode = forceAdd ? 'add' : selOp.value
  const base = selMask.value
  let out: Uint8Array
  if (mode === 'replace' || !base) {
    // No existing selection (or replacing it): replace/add → raw; subtract/intersect → empty.
    out = mode === 'replace' || mode === 'add' ? raw.slice() : new Uint8Array(pw * ph)
  } else {
    out = new Uint8Array(pw * ph)
    for (let i = 0; i < out.length; i++) {
      const b = base[i], r = raw[i]
      out[i] = mode === 'add' ? (b || r ? 1 : 0)
        : mode === 'subtract' ? (b && !r ? 1 : 0)
        : /* intersect */ (b && r ? 1 : 0)
    }
  }
  let any = false
  for (let i = 0; i < out.length; i++) if (out[i]) { any = true; break }
  selMask.value = any ? out : null
  syncSelFromMask()
  cancelPreview()
}



// Curated 日本传统色 presets (name + hex, after 伝統色のいろは). Click to pick.
const saving = ref(false)
/** Unsaved-changes flag: armed on any committed edit, cleared after a save.
 *  Drives the close-confirmation prompt. */
const dirty = ref(false)
/** Monotonic edit counter, bumped together with `dirty`. save() snapshots it
 *  before its async write and only clears `dirty` if nothing changed since, so an
 *  edit made *during* the in-flight save isn't wrongly marked clean. */
let editSeq = 0
function markDirty() {
  dirty.value = true
  editSeq++
}
/** False once the modal has unmounted — guards async save() continuations from
 *  touching refs / arming a toast timer on a destroyed component. */
let isMounted = true
/** Transient toast shown after a save attempt (auto-hides). */
const toast = ref<{ text: string; ok: boolean } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(text: string, ok = true) {
  toast.value = { text, ok }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
    toastTimer = null
  }, 2200)
}
const canvasEl = ref<HTMLCanvasElement | null>(null)
// Distinct non-transparent colours in the current tile (live) — helps keep a
// limited palette and notice stray colours.
const colorCount = ref(0)

// ── Layers ────────────────────────────────────────────────────────────────
// Each layer owns a raw (markRaw → non-reactive) RGBA buffer (pw*ph*4). A
// 'contour' layer stores only its fill SILHOUETTE; the dark outline is derived
// at render/flatten time from that layer's own alpha edge (deriveContour) —
// never baked into the stored pixels except on export. `buf` ALIASES the active
// layer's data (same backing array, never a copy) so every existing paint site
// keeps writing the right layer; syncBuf() re-points it after any change.
interface LayerMeta {
  name: string
  kind: LayerKind
  visible: boolean
  opacity: number
  outline: string
  fill: string
  width: number
  mode: ContourMode
  levels: number
  angle: number
}
interface StructState {
  order: string[]
  active: string
  meta: Record<string, LayerMeta>
}
type UndoEntry =
  | { t: 'pixels'; layerId: string; before: Uint8ClampedArray; after: Uint8ClampedArray }
  | { t: 'struct'; before: StructState; after: StructState }

let nextLayerId = 1 // declared before `layers` so mkLayer() can read it at init
const layers = ref<Layer[]>([mkLayer('raster', undefined, '图层 1')])
const activeIndex = ref(0)
const activeLayer = computed(() => layers.value[activeIndex.value] ?? layers.value[0])
let buf: Uint8ClampedArray = layers.value[0].data
// Buffer graveyard: every layer id ever created → its data, so a structural undo
// can resurrect a removed layer's pixels (kept out of the bounded undo stack).
const buffers = new Map<string, Uint8ClampedArray>()
buffers.set(layers.value[0].id, layers.value[0].data)

// Composite framebuffer (markRaw scratch) + contour derivation cache.
let composite = markRaw(new Uint8ClampedArray(pw * ph * 4))
const contourCache = new Map<string, { rev: number; rgba: Uint8ClampedArray }>()
let contourRev = 0

const undoStack: UndoEntry[] = []
const redoStack: UndoEntry[] = []
const canUndo = ref(false)
const canRedo = ref(false)
// Armed pixel snapshot (pushUndo arms at gesture start; commitUndo seals it).
let pendingBefore: { layerId: string; before: Uint8ClampedArray } | null = null
// When a contour stroke auto-creates its layer, this holds the pre-create struct so
// the create + first stroke seal as ONE undo entry (the painted silhouette lives in
// the buffer graveyard, restored by restoreStruct).
let pendingStruct: StructState | null = null
let drawing = false
// Last painted pixel of the active stroke, so onMove can interpolate a line to
// the current pixel — fast drags no longer leave gaps (matters most for the
// 勾填笔, whose outline/fill split needs a connected shape).
let last: { x: number; y: number } | null = null

const UNDO_LIMIT = 60

onMounted(async () => {
  // Prefer the layer sidecar (resume layered editing); else the flat PNG as one
  // raster layer (backward compatible with any tile/group saved before layers).
  if (props.srcLayersUrl) {
    try {
      const r = await fetch(props.srcLayersUrl)
      if (r.ok) {
        const doc = (await r.json()) as SidecarDoc
        if (await hydrateFromSidecar(doc, pw, ph, mkLayerId, setLayers)) {
          extractDocPalette()
          redraw()
          return
        }
      }
    } catch {
      /* no / invalid sidecar → flat PNG below */
    }
  }
  const img = new Image()
  img.onload = () => {
    const oc = document.createElement('canvas')
    oc.width = pw
    oc.height = ph
    const octx = oc.getContext('2d')!
    octx.imageSmoothingEnabled = false
    octx.clearRect(0, 0, pw, ph)
    octx.drawImage(img, 0, 0, pw, ph)
    setLayers([mkLayer('raster', octx.getImageData(0, 0, pw, ph).data, '图层 1')])
    extractDocPalette()
    redraw()
  }
  img.onerror = () => {
    setLayers([mkLayer('raster', undefined, '图层 1')])
    redraw()
  }
  img.src = props.srcUrl
})

// ── Layer model + composite + undo machinery ────────────────────────────────
function mkLayerId(): string {
  return 'L' + nextLayerId++
}
function mkLayer(kind: LayerKind, data?: Uint8ClampedArray, name?: string): Layer {
  return {
    id: mkLayerId(),
    name: name ?? (kind === 'contour' ? '勾填层' : '图层'),
    kind,
    data: markRaw(data ?? new Uint8ClampedArray(pw * ph * 4)),
    visible: true,
    opacity: 255,
    outline: kind === 'contour' ? contourOutline.value : '#1c1c1c',
    fill: kind === 'contour' ? contourFill.value : '#ffffff',
    width: 1,
    mode: kind === 'contour' ? contourMode.value : 'flat',
    levels: kind === 'contour' ? contourLevels.value : 3,
    angle: kind === 'contour' ? contourAngle.value : 135,
  }
}
/** Re-point `buf` at the active layer's data (the same backing array). */
function syncBuf() {
  buf = layers.value[activeIndex.value].data
}
/** Replace the whole layer set (load / hydrate); resets history + the graveyard. */
function setLayers(ls: Layer[]) {
  layers.value = ls.length ? ls : [mkLayer('raster', undefined, '图层 1')]
  activeIndex.value = 0
  buffers.clear()
  let maxId = 0
  for (const l of layers.value) {
    buffers.set(l.id, l.data)
    const num = Number(l.id.replace(/^L/, ''))
    if (Number.isFinite(num)) maxId = Math.max(maxId, num)
  }
  nextLayerId = Math.max(nextLayerId, maxId + 1)
  undoStack.length = 0
  redoStack.length = 0
  canUndo.value = false
  canRedo.value = false
  pendingBefore = null
  contourCache.clear()
  contourRev++
  syncBuf()
}
function bumpContour() {
  contourRev++
}

// Contour: derive the two-tone (dark inner outline + light fill) from a layer's
// own alpha silhouette via orthogonal-distance (chamfer) erosion. dist ≤ width →
// outline tone, deeper → fill tone; off-canvas counts as outside so the border is
// always outlined. width=1 reproduces the old reclassifyContour split.
function layerSource(L: Layer): Uint8ClampedArray {
  if (L.kind !== 'contour') return L.data
  const c = contourCache.get(L.id)
  if (c && c.rev === contourRev) return c.rgba
  const rgba = deriveContour(L.data, L.outline, L.fill, L.width, pw, ph, { mode: L.mode, levels: L.levels, angle: L.angle })
  contourCache.set(L.id, { rev: contourRev, rgba })
  return rgba
}
/** Flatten visible layers (bottom→top, straight-alpha source-over) into `composite`. */
function buildComposite() {
  const ls = layers.value
  // fast path: a single fully-opaque visible raster layer == today's cost
  if (ls.length === 1 && ls[0].kind === 'raster' && ls[0].visible && ls[0].opacity === 255) {
    composite.set(ls[0].data)
    return
  }
  composite.fill(0)
  for (let li = 0; li < ls.length; li++) {
    const L = ls[li]
    if (!L.visible || L.opacity === 0) continue
    const src = layerSource(L)
    const op = L.opacity / 255
    for (let i = 0; i < composite.length; i += 4) {
      const sa = (src[i + 3] / 255) * op
      if (sa === 0) continue
      const da = composite[i + 3] / 255
      const outA = sa + da * (1 - sa)
      if (outA === 0) continue
      const inv = da * (1 - sa)
      composite[i] = (src[i] * sa + composite[i] * inv) / outA
      composite[i + 1] = (src[i + 1] * sa + composite[i + 1] * inv) / outA
      composite[i + 2] = (src[i + 2] * sa + composite[i + 2] * inv) / outA
      composite[i + 3] = Math.round(outA * 255)
    }
  }
}

// Undo: pushUndo() ARMS a pixel snapshot of the active layer; commitUndo() SEALS
// it (one user op = one entry). Structural ops snapshot the layer list instead.
function eqBuf(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
function trimAndArm() {
  if (undoStack.length > UNDO_LIMIT) undoStack.shift()
  redoStack.length = 0
  canUndo.value = true
  canRedo.value = false
}
function commitUndo() {
  if (!pendingBefore) {
    pendingStruct = null
    return
  }
  // Contour auto-create + first stroke → one struct entry (the painted silhouette
  // is in the graveyard; restoreStruct pulls it). Avoids a phantom empty layer
  // left behind by a single Ctrl+Z.
  if (pendingStruct) {
    undoStack.push({ t: 'struct', before: pendingStruct, after: captureStruct() })
    pendingStruct = null
    pendingBefore = null
    trimAndArm()
    bumpContour()
    markDirty()
    return
  }
  const after = buf.slice()
  if (eqBuf(pendingBefore.before, after)) {
    pendingBefore = null
    return
  }
  undoStack.push({ t: 'pixels', layerId: pendingBefore.layerId, before: pendingBefore.before, after })
  pendingBefore = null
  trimAndArm()
  bumpContour() // a contour layer's silhouette may have changed (fill/move/cut/paste)
  markDirty()
}
function captureStruct(): StructState {
  return {
    order: layers.value.map((l) => l.id),
    active: layers.value[activeIndex.value].id,
    meta: Object.fromEntries(
      layers.value.map((l) => [
        l.id,
        { name: l.name, kind: l.kind, visible: l.visible, opacity: l.opacity, outline: l.outline, fill: l.fill, width: l.width, mode: l.mode, levels: l.levels, angle: l.angle },
      ]),
    ),
  }
}
function pushStruct(before: StructState, after: StructState) {
  undoStack.push({ t: 'struct', before, after })
  trimAndArm()
  markDirty()
}
function restoreStruct(s: StructState) {
  layers.value = s.order.map((id) => {
    const m = s.meta[id]
    return { id, data: buffers.get(id)!, name: m.name, kind: m.kind, visible: m.visible, opacity: m.opacity, outline: m.outline, fill: m.fill, width: m.width, mode: m.mode, levels: m.levels, angle: m.angle }
  })
  activeIndex.value = Math.max(0, s.order.indexOf(s.active))
  syncBuf()
}
function applyUndoEntry(e: UndoEntry, dir: 'before' | 'after') {
  if (e.t === 'pixels') {
    const b = buffers.get(e.layerId)
    if (b) b.set(dir === 'before' ? e.before : e.after)
  } else {
    restoreStruct(dir === 'before' ? e.before : e.after)
  }
  bumpContour()
}
function addLayer(kind: LayerKind, silent = false) {
  if (dragging()) return // never restructure mid-stroke (would desync buf/undo)
  const before = silent ? null : captureStruct()
  const L = mkLayer(kind)
  buffers.set(L.id, L.data)
  layers.value.splice(activeIndex.value + 1, 0, L) // above the active layer
  activeIndex.value += 1
  lastPainted = null // the active layer changed; the Shift+line anchor is now stale
  syncBuf()
  if (before) pushStruct(before, captureStruct())
  bumpContour()
  redraw()
}
/** The 勾填笔 paints a silhouette onto a contour layer; auto-create one if needed.
 *  The create is folded into the stroke's single undo entry (see commitUndo). */
function ensureContourLayer() {
  if (activeLayer.value.kind === 'contour') return
  pendingStruct = captureStruct() // pre-create snapshot; commitUndo coalesces it
  addLayer('contour', true)
}
function removeLayer(i: number) {
  if (dragging() || layers.value.length <= 1) return // keep ≥1 layer
  const before = captureStruct()
  layers.value.splice(i, 1)
  if (activeIndex.value >= layers.value.length) activeIndex.value = layers.value.length - 1
  syncBuf()
  pushStruct(before, captureStruct())
  bumpContour()
  redraw()
}
function reorderLayer(i: number, dir: -1 | 1) {
  const j = i + dir
  if (dragging() || j < 0 || j >= layers.value.length) return
  const before = captureStruct()
  const ls = layers.value
  const [m] = ls.splice(i, 1)
  ls.splice(j, 0, m)
  activeIndex.value = ls.indexOf(m)
  syncBuf()
  pushStruct(before, captureStruct())
  bumpContour()
  redraw()
}
function setActiveIndex(i: number) {
  if (i < 0 || i >= layers.value.length || i === activeIndex.value) return
  if (dragging()) onUp() // seal an in-flight stroke/drag onto the OLD layer first
  cancelPreview() // the staged preview was computed against the old layer
  activeIndex.value = i
  lastPainted = null
  sel.value = null
  selMask.value = null
  syncBuf()
  redraw()
}
function setLayerVisible(i: number, v: boolean) {
  if (dragging()) return
  const before = captureStruct()
  layers.value[i].visible = v
  pushStruct(before, captureStruct())
  bumpContour()
  redraw()
}
// Opacity slides live (no per-tick undo); one undo step is sealed on drag end.
// opacityBefore is lazy-armed so keyboard-arrow edits (no pointerdown) undo too.
let opacityBefore: StructState | null = null
function beginOpacity() {
  opacityBefore = captureStruct()
}
function setLayerOpacity(i: number, o: number) {
  if (dragging()) return
  if (!opacityBefore) opacityBefore = captureStruct()
  layers.value[i].opacity = Math.max(0, Math.min(255, Math.round(o)))
  redraw()
}
function commitOpacity() {
  if (opacityBefore) {
    pushStruct(opacityBefore, captureStruct())
    opacityBefore = null
  }
}
function renameLayer(i: number, name: string) {
  if (dragging()) return
  const nm = name.trim()
  if (!nm || nm === layers.value[i].name) return
  const before = captureStruct()
  layers.value[i].name = nm
  pushStruct(before, captureStruct())
}
function setContourWidth(i: number, w: number) {
  if (dragging()) return
  const L = layers.value[i]
  if (L.kind !== 'contour') return
  const before = captureStruct()
  L.width = Math.max(1, Math.min(8, Math.round(w)))
  pushStruct(before, captureStruct())
  bumpContour()
  redraw()
}

// Panel display helpers (top layer shown first).
const layersTopFirst = computed(() => layers.value.map((l, i) => ({ l, i })).reverse())
const canMoveUp = computed(() => activeIndex.value < layers.value.length - 1)
const canMoveDown = computed(() => activeIndex.value > 0)

// Eyedropper / future bucket sampling source.
const sampleMode = ref<'active' | 'merged'>('active')
// Inline layer rename.
const renamingLayerId = ref<string | null>(null)
const renameDraft = ref('')
function startRename(i: number) {
  renamingLayerId.value = layers.value[i].id
  renameDraft.value = layers.value[i].name
}
function commitRename(i: number) {
  if (renamingLayerId.value === layers.value[i].id) {
    renameLayer(i, renameDraft.value)
    renamingLayerId.value = null
  }
}

// Changing zoom resizes the canvas (which clears it); redraw after the DOM
// width/height attrs update (flush: 'post').
watch(zoom, () => redraw(), { flush: 'post' })
watch(gridShade, () => redraw())
watch(showGrid, () => redraw())
watch(brightness, () => redraw())
watch(tilePreview, () => redraw(), { flush: 'post' })
// Selection-capable tools (选区 marks it, 平移 moves it) share one marquee. Leaving
// BOTH commits any live float and drops the marquee (painting tools ignore the
// selection, so a lingering rectangle would only confuse); switching between the
// two keeps the marquee so you can 框选 then 平移.
watch(tool, (t, old) => {
  const leftSel = old === 'select' || old === 'move'
  const intoSel = t === 'select' || t === 'move'
  if (leftSel && !intoSel) {
    endSelDrag() // commit/clear any in-flight drag and reset its flags
    sel.value = null
    redraw()
  } else if (leftSel && intoSel) {
    endSelDrag() // keep the marquee; just seal any in-flight drag
    redraw()
  }
})

// ── keyboard shortcuts (active while the editor is open) ──
//  B/P 铅笔 · G 油漆桶 · I 吸管 · E 橡皮 · +/- 缩放 · ⌘/Ctrl+Z 撤销
//  (⇧ 重做, 或 ⌘/Ctrl+Y) · ⌘/Ctrl+S 保存 · Esc 关闭
function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  altDown.value = e.altKey
  shiftDown.value = e.shiftKey
  if (e.metaKey || e.ctrlKey) {
    const k = e.key.toLowerCase()
    if (k === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (k === 'y') {
      e.preventDefault()
      redo()
    } else if (k === 's') {
      e.preventDefault()
      void save()
    } else if (k === 'a') {
      e.preventDefault()
      selectAll()
    } else if (k === 'c') {
      e.preventDefault()
      copySel()
    } else if (k === 'x') {
      e.preventDefault()
      cutSel()
    } else if (k === 'v') {
      e.preventDefault()
      pasteClip()
    } else if (k === 'd') {
      e.preventDefault()
      deselect()
    }
    return
  }
  switch (e.key.toLowerCase()) {
    case 'b':
    case 'p':
      tool.value = 'pencil'
      break
    case 'c':
      tool.value = 'contour'
      break
    case 'l':
      tool.value = 'line'
      break
    case 'r':
      tool.value = 'rect'
      break
    case 'o':
      tool.value = 'ellipse'
      break
    case 'g':
      tool.value = 'fill'
      break
    case 'i':
      tool.value = 'eyedropper'
      break
    case 'e':
      tool.value = 'erase'
      break
    case 's':
      tool.value = 'stamp'
      break
    case 'm':
      tool.value = 'select'
      break
    case 'q':
      tool.value = 'lasso'
      break
    case 'w':
      tool.value = 'wand'
      break
    case 't':
      tool.value = 'move'
      break
    case 'f':
      shapeFill.value = !shapeFill.value
      break
    case 'k':
      constrainToPalette.value = !constrainToPalette.value
      break
    case 'x':
      swapColors()
      break
    case 'h':
      flipH()
      break
    case 'v':
      flipV()
      break
    case '[':
      brushBy(-1)
      break
    case ']':
      brushBy(1)
      break
    case ' ':
      spaceHeld.value = true
      break
    case '=':
    case '+':
      zoomBy(4)
      break
    case '-':
    case '_':
      zoomBy(-4)
      break
    case 'backspace':
    case 'delete':
      if (!selMask.value) return // no selection → let the key pass through
      clearSelectionPixels()
      break
    case 'enter':
      if (preview.value) applyPreview() // commit a staged region op
      else return
      break
    case 'escape':
      if (preview.value) cancelPreview() // discard a staged region op first
      else if (replacing.value) closeReplace()
      else if (sel.value) deselect()
      else requestClose()
      break
    default:
      return
  }
  e.preventDefault()
}
function onKeyUp(e: KeyboardEvent) {
  altDown.value = e.altKey
  shiftDown.value = e.shiftKey
  if (e.key === ' ') {
    spaceHeld.value = false
    if (panning.value) {
      panning.value = false
      panStart = null
    }
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', clearMods)
  if (!tilesStore.tiles.length) void tilesStore.loadLibrary() // for the 印章 palette
})
onUnmounted(() => {
  isMounted = false
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', clearMods)
  if (toastTimer) clearTimeout(toastTimer)
})

function redraw() {
  const cv = canvasEl.value
  if (!cv) return
  const z = zoom.value
  const k = brightness.value / 100 // preview-only channel multiplier
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  buildComposite() // flatten visible layers (contour layers derived) into `composite`
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      // transparency checkerboard
      ctx.fillStyle = (x + y) & 1 ? '#3a3a3a' : '#2c2c2c'
      ctx.fillRect(x * z, y * z, z, z)
      const i = (y * pw + x) * 4
      const a = composite[i + 3]
      if (a === 0) continue
      // brightness is preview-only: scale channels for display; composite is untouched.
      const r = k === 1 ? composite[i] : Math.min(255, Math.round(composite[i] * k))
      const g = k === 1 ? composite[i + 1] : Math.min(255, Math.round(composite[i + 1] * k))
      const b = k === 1 ? composite[i + 2] : Math.min(255, Math.round(composite[i + 2] * k))
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`
      ctx.fillRect(x * z, y * z, z, z)
    }
  }
  // per-pixel grid (toggleable)
  if (showGrid.value) {
    ctx.strokeStyle = `rgba(${gridShade.value}, ${gridShade.value}, ${gridShade.value}, 0.85)`
    ctx.lineWidth = 1
    for (let x = 0; x <= pw; x++) {
      ctx.beginPath()
      ctx.moveTo(x * z + 0.5, 0)
      ctx.lineTo(x * z + 0.5, ph * z)
      ctx.stroke()
    }
    for (let y = 0; y <= ph; y++) {
      ctx.beginPath()
      ctx.moveTo(0, y * z + 0.5)
      ctx.lineTo(pw * z, y * z + 0.5)
      ctx.stroke()
    }
  }
  // heavier seam grid at tile-cell boundaries (only for multi-cell buildings),
  // so you can see where one tile ends and the next begins while refining.
  if (cellsX > 1 || cellsY > 1) {
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.65)' // indigo accent
    ctx.lineWidth = 1.5
    for (let cx = 0; cx <= cellsX; cx++) {
      const px = cx * cell * z + 0.5
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, ph * z)
      ctx.stroke()
    }
    for (let cy = 0; cy <= cellsY; cy++) {
      const py = cy * cell * z + 0.5
      ctx.beginPath()
      ctx.moveTo(0, py)
      ctx.lineTo(pw * z, py)
      ctx.stroke()
    }
  }

  // floating selection (a region mid-move) rendered above the cleared hole
  if (float) {
    for (let yy = 0; yy < float.h; yy++) {
      for (let xx = 0; xx < float.w; xx++) {
        const di = (yy * float.w + xx) * 4
        const a = float.buf[di + 3]
        if (a === 0) continue
        const x = float.ox + xx
        const y = float.oy + yy
        if (x < 0 || y < 0 || x >= pw || y >= ph) continue
        const r = k === 1 ? float.buf[di] : Math.min(255, Math.round(float.buf[di] * k))
        const g = k === 1 ? float.buf[di + 1] : Math.min(255, Math.round(float.buf[di + 1] * k))
        const b = k === 1 ? float.buf[di + 2] : Math.min(255, Math.round(float.buf[di + 2] * k))
        ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`
        ctx.fillRect(x * z, y * z, z, z)
      }
    }
  }
  // region-op preview overlay (non-destructive): paint the processed result over
  // the masked pixels so the op can be judged — and A/B'd — before committing.
  if (preview.value && !previewShowOriginal.value) {
    const pv = preview.value
    for (let yy = 0; yy < pv.rh; yy++) {
      for (let xx = 0; xx < pv.rw; xx++) {
        const gx = pv.rx + xx, gy = pv.ry + yy
        if (selMask.value && !selMask.value[gy * pw + gx]) continue
        // clear under the cell first so an op that adds transparency (抠底) shows
        ctx.fillStyle = (gx + gy) & 1 ? '#3a3a3a' : '#2c2c2c'
        ctx.fillRect(gx * z, gy * z, z, z)
        const di = (yy * pv.rw + xx) * 4
        const a = pv.out[di + 3]
        if (a === 0) continue
        const r = k === 1 ? pv.out[di] : Math.min(255, Math.round(pv.out[di] * k))
        const g = k === 1 ? pv.out[di + 1] : Math.min(255, Math.round(pv.out[di + 1] * k))
        const b = k === 1 ? pv.out[di + 2] : Math.min(255, Math.round(pv.out[di + 2] * k))
        ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`
        ctx.fillRect(gx * z, gy * z, z, z)
      }
    }
  }

  // selection outline: live rubber-band / lasso path while dragging, else the
  // committed mask boundary (marching-ants around exactly the selected pixels).
  if (selDragging && sel.value) {
    drawDashedRect(ctx, sel.value, z)
  } else if (lassoDragging.value && lassoPts.length) {
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = 'rgba(96,165,250,0.95)'
    ctx.beginPath()
    ctx.moveTo(lassoPts[0].x * z + 0.5, lassoPts[0].y * z + 0.5)
    for (const pt of lassoPts) ctx.lineTo(pt.x * z + 0.5, pt.y * z + 0.5)
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])
  } else if (selMask.value) {
    drawMaskOutline(ctx, selMask.value, z)
  }

  drawPreview()
  drawTilePreview()
  countColors()
}

/** Two-tone dashed rectangle (live marquee feedback). */
function drawDashedRect(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, z: number) {
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4]); ctx.lineDashOffset = 0
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.strokeRect(r.x * z + 0.5, r.y * z + 0.5, r.w * z - 1, r.h * z - 1)
  ctx.lineDashOffset = 4; ctx.strokeStyle = 'rgba(0,0,0,0.9)'
  ctx.strokeRect(r.x * z + 0.5, r.y * z + 0.5, r.w * z - 1, r.h * z - 1)
  ctx.setLineDash([]); ctx.lineDashOffset = 0
}

/** Marching-ants outline tracing the exact mask boundary (two-tone). */
function drawMaskOutline(ctx: CanvasRenderingContext2D, m: Uint8Array, z: number) {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < pw && y < ph && m[y * pw + x] === 1
  ctx.beginPath()
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      if (!m[y * pw + x]) continue
      if (!on(x, y - 1)) { ctx.moveTo(x * z, y * z); ctx.lineTo((x + 1) * z, y * z) }
      if (!on(x, y + 1)) { ctx.moveTo(x * z, (y + 1) * z); ctx.lineTo((x + 1) * z, (y + 1) * z) }
      if (!on(x - 1, y)) { ctx.moveTo(x * z, y * z); ctx.lineTo(x * z, (y + 1) * z) }
      if (!on(x + 1, y)) { ctx.moveTo((x + 1) * z, y * z); ctx.lineTo((x + 1) * z, (y + 1) * z) }
    }
  }
  ctx.lineWidth = 1
  ctx.setLineDash([]); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke()
  ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.stroke()
  ctx.setLineDash([])
}

/** Count distinct non-transparent RGBA colours in the flattened image. */
function countColors() {
  const seen = new Set<number>()
  for (let i = 0; i < composite.length; i += 4) {
    if (composite[i + 3] === 0) continue // skip fully transparent pixels
    seen.add((composite[i] << 24) | (composite[i + 1] << 16) | (composite[i + 2] << 8) | composite[i + 3])
  }
  colorCount.value = seen.size
}

/** Live thumbnail of the whole tile at true colours (no grid, no brightness). */
function drawPreview() {
  const cv = previewEl.value
  if (!cv) return
  const p = previewScale.value
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      ctx.fillStyle = (x + y) & 1 ? '#3a3a3a' : '#2c2c2c'
      ctx.fillRect(x * p, y * p, p, p)
      const i = (y * pw + x) * 4
      const a = composite[i + 3]
      if (a === 0) continue
      ctx.fillStyle = `rgba(${composite[i]},${composite[i + 1]},${composite[i + 2]},${a / 255})`
      ctx.fillRect(x * p, y * p, p, p)
    }
  }
}

function screenToPixel(e: PointerEvent): { x: number; y: number } | null {
  const cv = canvasEl.value
  if (!cv) return null
  const r = cv.getBoundingClientRect()
  const x = Math.floor((e.clientX - r.left) / zoom.value)
  const y = Math.floor((e.clientY - r.top) / zoom.value)
  if (x < 0 || y < 0 || x >= pw || y >= ph) return null
  return { x, y }
}

function pushUndo() {
  // Arm a pixel snapshot of the active layer at gesture start; commitUndo() seals
  // it (dropping no-op strokes). buf aliases the active layer's data.
  pendingBefore = { layerId: layers.value[activeIndex.value].id, before: buf.slice() }
}

// Decode a data URL into an exactly w×h RGBA buffer (crisp, no smoothing).
function decodeSized(dataUrl: string, w: number, h: number): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    const im = new Image()
    im.onload = () => {
      const oc = document.createElement('canvas'); oc.width = w; oc.height = h
      const c = oc.getContext('2d')!; c.imageSmoothingEnabled = false
      c.clearRect(0, 0, w, h); c.drawImage(im, 0, 0, w, h)
      resolve(c.getImageData(0, 0, w, h).data)
    }
    im.onerror = () => resolve(null)
    im.src = dataUrl
  })
}

// ── Region-op engine (preview-first, mask-aware) — extracted to a composable.
// The shared canvas/layer/undo state is threaded in via getters + refs.
const {
  cvBusy, cvError, preview, previewShowOriginal, quantizeColors, hasPreview,
  applyPreview, cancelPreview, applyCv, applyDenoise, runInpaint,
  showInpaint, inpaintPrompt,
} = useRegionOps({
  pw: () => pw,
  ph: () => ph,
  activeData: () => buf,
  selMask,
  sel,
  pushUndo,
  commitUndo,
  redraw,
  markDirty,
  decodeSized,
})

function setPixel(x: number, y: number, r: number, g: number, b: number, a: number) {
  const i = (y * pw + x) * 4
  buf[i] = r
  buf[i + 1] = g
  buf[i + 2] = b
  buf[i + 3] = a
}

// Stamp the armed brush at (x,y) — the per-step writer passed to lineEach. The
// colour/opacity/erase mode are armed once per stroke by armPaint(); for the
// 勾填笔 every painted pixel is an opaque silhouette member of the shape, and
// deriveContour() promotes edge pixels to the outline tone at render time.
function paintRaw(x: number, y: number) {
  stampBrush(x, y)
}

// Walk the integer pixels on the segment (x0,y0)→(x1,y1) (Bresenham, endpoints
// included) so a quick drag paints a continuous line rather than dotted samples.
function lineEach(x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number) => void) {
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    fn(x0, y0)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}

// Re-derive the 勾填笔 two-tone split over the WHOLE shape. The shape is every
// fully-opaque pixel whose colour is the current outline or fill tone (so it
// also picks up earlier strokes you're extending). A pixel is "interior" only
// when its four orthogonal neighbours are all shape members; a neighbour outside
// the tile counts as empty, so the silhouette's border is always outlined.
// Finalise a paint batch. A contour layer derives its dark outline from its own
// alpha silhouette at render time (layerSource → deriveContour), so painting just
// invalidates that cache; everything redraws.
function afterPaint() {
  if (activeLayer.value.kind === 'contour') bumpContour()
  redraw()
}

function pick(x: number, y: number) {
  let src = buf // active layer
  if (sampleMode.value === 'merged') {
    buildComposite()
    src = composite
  } else if (activeLayer.value.kind === 'contour') {
    src = layerSource(activeLayer.value) // pick the displayed outline/fill, not the raw silhouette
  }
  const i = (y * pw + x) * 4
  if (src[i + 3] === 0) return
  setColor(toHex(src[i], src[i + 1], src[i + 2]))
  alpha.value = src[i + 3] // restore the sampled pixel's opacity too
}

function fillAt(x: number, y: number) {
  const i0 = (y * pw + x) * 4
  const target = [buf[i0], buf[i0 + 1], buf[i0 + 2], buf[i0 + 3]]
  // Uses the armed stroke colour/opacity (armPaint runs before fillAt in onDown).
  const repl = strokeErase ? [0, 0, 0, 0] : [strokeR, strokeG, strokeB, strokeA]
  if (target.every((v, k) => v === repl[k])) return
  const stack = [[x, y]]
  while (stack.length) {
    const [cx, cy] = stack.pop()!
    if (cx < 0 || cy < 0 || cx >= pw || cy >= ph) continue
    const i = (cy * pw + cx) * 4
    if (buf[i] !== target[0] || buf[i + 1] !== target[1] || buf[i + 2] !== target[2] || buf[i + 3] !== target[3]) continue
    buf[i] = repl[0]
    buf[i + 1] = repl[1]
    buf[i + 2] = repl[2]
    buf[i + 3] = repl[3]
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
  }
}

// ── 印章 (stamp): place a whole library tile into a tile-cell block ───────────
const stampTileId = ref<string | null>(null)
const tileImgCache = new Map<string, Uint8ClampedArray>()
let lastStampCell: { cx: number; cy: number } | null = null

/** Decode a library tile to a cached cell×cell RGBA buffer for stamping. */
async function ensureTileImg(id: string): Promise<Uint8ClampedArray | null> {
  const hit = tileImgCache.get(id)
  if (hit) return hit
  const data = await decodeSized(tilesStore.tileUrl(id), cell, cell)
  if (data) tileImgCache.set(id, data)
  return data ?? null
}
function pickStampTile(id: string) {
  stampTileId.value = id
  tool.value = 'stamp'
  void ensureTileImg(id)
}
/** Source-over the selected tile onto one cell of the active layer. */
function stampTileCell(cx: number, cy: number) {
  const img = stampTileId.value ? tileImgCache.get(stampTileId.value) : null
  if (!img) return
  const ox = cx * cell, oy = cy * cell
  for (let yy = 0; yy < cell; yy++) {
    for (let xx = 0; xx < cell; xx++) {
      const gx = ox + xx, gy = oy + yy
      if (gx < 0 || gy < 0 || gx >= pw || gy >= ph) continue
      const si = (yy * cell + xx) * 4
      const a = img[si + 3]
      if (a === 0) continue
      const di = (gy * pw + gx) * 4
      if (a === 255) {
        buf[di] = img[si]; buf[di + 1] = img[si + 1]; buf[di + 2] = img[si + 2]; buf[di + 3] = 255
      } else {
        const af = a / 255, na = 1 - af
        buf[di] = img[si] * af + buf[di] * na
        buf[di + 1] = img[si + 1] * af + buf[di + 1] * na
        buf[di + 2] = img[si + 2] * af + buf[di + 2] * na
        buf[di + 3] = a + buf[di + 3] * na
      }
    }
  }
  if (activeLayer.value.kind === 'contour') bumpContour()
}
/** Stamp at a pixel, snapped to its cell; skip re-stamping the same cell. */
function stampAtPixel(x: number, y: number) {
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell)
  if (lastStampCell && lastStampCell.cx === cx && lastStampCell.cy === cy) return
  lastStampCell = { cx, cy }
  stampTileCell(cx, cy)
}

function onDown(e: PointerEvent) {
  // Pan (space-held left or middle button) is handled on the scroll container.
  if (e.button === 1 || (spaceHeld.value && e.button === 0)) return
  const p = screenToPixel(e)
  // "Replace from" colour-pick: consume the click and clear the armed flag even
  // when it lands off-canvas, so the mode never stays latched.
  if (pickReplaceFrom.value) {
    if (p) {
      const i = (p.y * pw + p.x) * 4
      if (buf[i + 3] !== 0) replaceFrom.value = toHex(buf[i], buf[i + 1], buf[i + 2])
    }
    pickReplaceFrom.value = false
    return
  }
  if (!p) return
  canvasEl.value!.setPointerCapture(e.pointerId)
  // Alt = temporary eyedropper from any tool (plus the eyedropper tool itself).
  if (e.altKey || tool.value === 'eyedropper') {
    pick(p.x, p.y)
    return
  }
  // Selection: click inside the marquee starts a move (lift→drag→stamp);
  // anywhere else starts a new rubber-band marquee.
  if (tool.value === 'select') {
    const s = sel.value
    const inside = !!s && p.x >= s.x && p.x < s.x + s.w && p.y >= s.y && p.y < s.y + s.h
    if (inside && s) {
      // Defer the lift + undo until the move actually starts, so a bare click
      // inside the marquee doesn't push a no-op undo / wipe the redo stack.
      floatGrab = { dx: p.x - s.x, dy: p.y - s.y }
      floatDragging = true
      floatLifted = false
    } else {
      selAnchor = { x: p.x, y: p.y }
      sel.value = { x: p.x, y: p.y, w: 1, h: 1 }
      selDragging = true
      selRectForceAdd = e.shiftKey
    }
    redraw()
    return
  }
  // 魔棒 (magic wand): select pixels by colour similarity from the clicked seed
  // (contiguous, or global with the 全局 toggle); combines per 选区模式 / Shift.
  if (tool.value === 'wand') {
    commitMask(wandMask(buf, pw, ph, p.x, p.y, wandTol.value, wandGlobal.value), e.shiftKey)
    redraw()
    return
  }
  // 套索 (lasso): trace a freehand outline; the enclosed pixels become the mask.
  if (tool.value === 'lasso') {
    lassoPts = [{ x: p.x, y: p.y }]
    lassoDragging.value = true
    lassoForceAdd = e.shiftKey
    redraw()
    return
  }
  // 平移 (move): drag ANYWHERE to translate the current selection's pixels (vs the
  // select tool, which only moves when grabbed inside the marquee). Reuses the float
  // lift/stamp machinery — undo is armed on the first real move, sealed on up.
  if (tool.value === 'move') {
    const s = sel.value
    if (!s) return // nothing selected — the panel hint tells the user to 框选 first
    floatGrab = { dx: p.x - s.x, dy: p.y - s.y }
    floatDragging = true
    floatLifted = false
    redraw()
    return
  }
  // Any manual paint invalidates a pending region preview (it was computed
  // against the pixels you're about to change).
  cancelPreview()
  // 印章: place the selected library tile into the clicked cell (drag = many).
  if (tool.value === 'stamp') {
    if (!stampTileId.value) return
    pushUndo()
    drawing = true
    lastStampCell = null
    stampAtPixel(p.x, p.y)
    afterPaint()
    return
  }
  // 勾填笔 paints a silhouette onto a contour layer; auto-create one if needed.
  if (tool.value === 'contour') ensureContourLayer()
  const secondary = e.button === 2
  // Shift+click = straight line from the previous stroke's end (brush tools).
  if (e.shiftKey && lastPainted && (tool.value === 'pencil' || tool.value === 'contour' || tool.value === 'erase')) {
    pushUndo()
    armPaint(secondary)
    noteStrokeRecent(secondary)
    lineEach(lastPainted.x, lastPainted.y, p.x, p.y, paintRaw)
    lastPainted = { x: p.x, y: p.y }
    afterPaint()
    commitUndo()
    return
  }
  pushUndo()
  noteStrokeRecent(secondary)
  armPaint(secondary)
  if (tool.value === 'fill') {
    fillAt(p.x, p.y)
    commitUndo()
    redraw()
    return
  }
  if (isShapeTool(tool.value)) {
    shapeStart = { x: p.x, y: p.y }
    shapeSnapshot = buf.slice()
    drawing = true
    rasterizeShape(shapeStart, p, e.shiftKey) // a dot for a click-no-drag
    afterPaint() // bumps the contour cache so the preview is live on a contour layer
    return
  }
  // pencil / contour / erase freehand
  drawing = true
  last = { x: p.x, y: p.y }
  stampBrush(p.x, p.y)
  afterPaint()
}

function onMove(e: PointerEvent) {
  cursorPx.value = screenToPixel(e) // coordinate readout (also when not drawing)
  if (lassoDragging.value) {
    const c = clampedPixel(e)
    const tail = lassoPts[lassoPts.length - 1]
    if (!tail || tail.x !== c.x || tail.y !== c.y) lassoPts.push(c)
    redraw()
    return
  }
  if (tool.value === 'select' || tool.value === 'move') {
    if (floatDragging && floatGrab && sel.value) {
      const rp = rawPixel(e) // raw (unclamped) so the float can hang off-canvas
      const nx = rp.x - floatGrab.dx
      const ny = rp.y - floatGrab.dy
      if (!floatLifted) {
        if (nx === sel.value.x && ny === sel.value.y) return // no real movement yet
        pushUndo()
        liftFloat()
        floatLifted = true
      }
      if (float) {
        float.ox = nx
        float.oy = ny
        sel.value = { x: nx, y: ny, w: float.w, h: float.h }
        redraw()
      }
    } else if (selDragging && selAnchor) {
      const c = clampedPixel(e)
      sel.value = {
        x: Math.min(selAnchor.x, c.x),
        y: Math.min(selAnchor.y, c.y),
        w: Math.abs(c.x - selAnchor.x) + 1,
        h: Math.abs(c.y - selAnchor.y) + 1,
      }
      redraw()
    }
    return
  }
  if (!drawing) return
  const p = screenToPixel(e)
  if (!p) return
  if (tool.value === 'stamp') { stampAtPixel(p.x, p.y); afterPaint(); return }
  if (isShapeTool(tool.value) && shapeStart && shapeSnapshot) {
    buf.set(shapeSnapshot) // non-destructive live preview
    rasterizeShape(shapeStart, p, e.shiftKey)
    afterPaint() // re-derives a contour layer's outline live during the drag
    return
  }
  // join the gap from the previous sample so quick drags stay continuous
  if (last) lineEach(last.x, last.y, p.x, p.y, paintRaw)
  else stampBrush(p.x, p.y)
  last = { x: p.x, y: p.y }
  afterPaint()
}

function onUp() {
  // Lasso: close the path and rasterize the enclosed pixels into the mask.
  if (lassoDragging.value) {
    lassoDragging.value = false
    if (lassoPts.length >= 3) commitMask(lassoMask(pw, ph, lassoPts), lassoForceAdd)
    lassoPts = []
    redraw()
    return
  }
  // Finalize a selection drag regardless of the current tool, so a mid-drag tool
  // switch can't leave floatDragging/selDragging latched.
  if (floatDragging || selDragging) {
    const wasMarquee = selDragging
    endSelDrag() // commits a lifted float; a bare click lifted nothing
    if (wasMarquee) {
      // A 1×1 marquee is a bare click → deselect; otherwise commit the rect as a mask.
      if (sel.value && sel.value.w * sel.value.h <= 1) deselect()
      else if (sel.value) commitMask(rectMask(pw, ph, sel.value.x, sel.value.y, sel.value.w, sel.value.h), selRectForceAdd)
    }
    redraw()
    return
  }
  if (drawing && !isShapeTool(tool.value) && last) lastPainted = { x: last.x, y: last.y }
  drawing = false
  last = null
  shapeStart = null
  shapeSnapshot = null
  commitUndo() // seal a freehand/shape stroke (no-op if nothing was armed)
}

// Pointer left the canvas while hovering (capture keeps a live stroke on the
// canvas, so this only fires when not drawing): blank the coord readout.
function onCanvasLeave() {
  cursorPx.value = null
  onUp()
}

function undo() {
  if (dragging() || !undoStack.length) return // don't disturb an in-flight stroke/drag
  cancelPreview()
  const e = undoStack.pop()!
  redoStack.push(e)
  applyUndoEntry(e, 'before')
  canUndo.value = undoStack.length > 0
  canRedo.value = true
  markDirty()
  redraw()
}

function redo() {
  if (dragging() || !redoStack.length) return
  cancelPreview()
  const e = redoStack.pop()!
  undoStack.push(e)
  applyUndoEntry(e, 'after')
  canRedo.value = redoStack.length > 0
  canUndo.value = true
  markDirty()
  redraw()
}

// Save ONLY persists — it never closes the editor. Success/failure is reported
// via a toast so editing can continue (the close button handles leaving).
async function save() {
  if (saving.value) return
  if (float) stampFloat() // bake a mid-move float into the active layer first
  buildComposite() // flatten visible layers (contour outlines derived) → engine PNG
  saving.value = true
  const oc = document.createElement('canvas')
  oc.width = pw
  oc.height = ph
  oc.getContext('2d')!.putImageData(new ImageData(composite.slice(), pw, ph), 0, 0)
  const dataUrl = oc.toDataURL('image/png')
  const sidecar = serializeLayers(layers.value, pw, ph, cell) // editing-time layer structure (additive)
  const seqAtSave = editSeq // the state captured above; edits during the await bump this
  // A building group supplies `persist`; tiles fall back to the library save.
  const ok = props.persist
    ? await props.persist(dataUrl, sidecar)
    : !!(await tilesStore.saveTile(dataUrl, { id: props.tileId, layers: sidecar }))
  if (!isMounted) return // closed mid-save: don't touch refs / arm a stray toast timer
  saving.value = false
  if (ok) {
    if (editSeq === seqAtSave) dirty.value = false // keep dirty if edited during the save
    showToast('已保存', true)
  } else {
    showToast(tilesStore.error || '保存失败', false)
  }
}

// Closing is separate from saving: confirm only when there are unsaved edits, so
// a clean editor closes immediately but unsaved work can't be lost by accident.
function requestClose() {
  // Seal an in-flight stroke/selection-drag first (matches setActiveIndex/clearMods):
  // commitUndo runs, so a mid-gesture close still flags the work as unsaved.
  if (dragging()) onUp()
  if (dirty.value && !window.confirm('有未保存的修改，确定关闭吗？未保存的内容将丢失。')) return
  emit('close')
}

// Let a parent (the inline building editor) check for unsaved work before it
// swaps in a different building (which remounts and discards edits).
defineExpose({ isDirty: () => dirty.value })
</script>

<style scoped>
/* Native `<input type="color">` paints its colour as a small inset rectangle —
   the UA wrapper carries default padding and the swatch its own border — so even
   a full-width control reads as a thin sliver (主色「太狭小看不清」). Strip that
   chrome so the colour fills the whole control edge-to-edge. */
input[type='color'] {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  padding: 0;
  /* a thin frame so the swatch reads against the dark panel (esp. light colours) */
  border: 1px solid rgb(107 114 128);
  border-radius: 0.25rem;
  background: transparent;
}
input[type='color']::-webkit-color-swatch-wrapper {
  padding: 0;
}
input[type='color']::-webkit-color-swatch {
  border: none;
  border-radius: 0.2rem;
}
input[type='color']::-moz-color-swatch {
  border: none;
  border-radius: 0.2rem;
}
</style>
