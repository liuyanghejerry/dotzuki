// Reference-layer pages bundled into the editor's Help panel.
//
// The markdown ships as raw imports — Vite inlines each file into the build,
// so the panel performs no runtime file access and works identically in the
// dev server, the packaged Electron build, and the plain web build. Sources:
// `workspace/docs/reference/`.

import cliMd from '../../../../docs/reference/cli.md?raw'
import manifestMd from '../../../../docs/reference/project-manifest.md?raw'
import sceneMd from '../../../../docs/reference/dsl/scene.md?raw'
import guiMd from '../../../../docs/reference/dsl/gui.md?raw'
import battleRulesMd from '../../../../docs/reference/battle-rules.md?raw'
import glossaryMd from '../../../../docs/reference/glossary.md?raw'

export interface HelpPage {
  id: string
  title: string
  source: string
}

export const HELP_PAGES: HelpPage[] = [
  { id: 'cli', title: 'CLI Reference', source: cliMd },
  { id: 'project-manifest', title: 'Project Manifest', source: manifestMd },
  { id: 'scene-dsl', title: 'Scene DSL (.scene)', source: sceneMd },
  { id: 'gui-dsl', title: 'GUI DSL (.gui)', source: guiMd },
  { id: 'battle-rules', title: 'Battle Rules (rules.ron)', source: battleRulesMd },
  { id: 'glossary', title: 'Glossary', source: glossaryMd },
]
