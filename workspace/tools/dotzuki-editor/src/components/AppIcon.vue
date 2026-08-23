<template>
  <component :is="icon" :size="size" :stroke-width="strokeWidth" class="shrink-0" aria-hidden="true" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Map, CodeXml, Database, Image, Settings, Palette, Book, BookOpen,
  LayoutGrid, Clapperboard, Music, Gamepad2, Sparkles, CircleQuestionMark,
  PanelLeft, File, Zap, PawPrint, Swords, Backpack, Shapes, User, Leaf,
  RefreshCcw, ScrollText, MessageSquare, ChartColumn, List, Package, Ghost,
  WandSparkles,
} from 'lucide-vue-next'

/**
 * Shared icon for the editor chrome — Lucide stroke icons instead of emoji,
 * so the activity rail, titlebar and sidebars render crisply and consistently
 * across platforms (emoji glyphs vary by OS and look off in a desktop app).
 *
 * `name` is the icon identifier from the project manifest / table config;
 * unknown names fall back to a generic file icon.
 */
const props = withDefaults(defineProps<{
  name?: string
  size?: number
  strokeWidth?: number
}>(), { size: 16, strokeWidth: 1.75 })

const ICONS: Record<string, any> = {
  // Activities (manifest `icon` values + legacy aliases)
  map: Map,
  code: CodeXml,
  script: CodeXml,
  database: Database,
  data: Database,
  image: Image,
  assets: Image,
  settings: Settings,
  layout: Palette,
  book: Book,
  story: BookOpen,
  tiles: LayoutGrid,
  titlescreen: Clapperboard,
  audio: Music,
  music: Music,
  play: Gamepad2,
  // Chrome
  sparkles: Sparkles,
  help: CircleQuestionMark,
  'panel-left': PanelLeft,
  // Data tables
  monster: Zap,
  species: PawPrint,
  moves: Swords,
  items: Backpack,
  types: Shapes,
  trainers: User,
  maps: Map,
  encounters: Leaf,
  evolutions: RefreshCcw,
  scripts: ScrollText,
  text: MessageSquare,
  config: Settings,
  stats: ChartColumn,
  list: List,
  user: User,
  package: Package,
  ghost: Ghost,
  swords: Swords,
  magic: WandSparkles,
}

const icon = computed(() => ICONS[props.name ?? ''] ?? File)
</script>
