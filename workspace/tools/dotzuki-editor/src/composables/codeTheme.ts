// Shared CodeMirror theme matching the editor's light workbench theme
// (src/design-tokens.css). Use in place of a dark theme like oneDark —
// the editor chrome is light, so code panels should be too.
import { EditorView } from '@codemirror/view'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

export const lightCodeTheme: Extension = [
  syntaxHighlighting(defaultHighlightStyle),
  EditorView.theme({
    '&': { backgroundColor: 'transparent' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      borderRight: '1px solid rgba(0, 0, 0, 0.06)',
      color: '#9ca3af', // gray-400
    },
    '.cm-activeLine': { backgroundColor: 'rgba(0, 0, 0, 0.035)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(0, 0, 0, 0.035)' },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(234, 88, 12, 0.16)', // accent (orange-600) wash
    },
    '.cm-selectionMatch': { backgroundColor: 'rgba(234, 88, 12, 0.10)' },
    '.cm-cursor': { borderLeftColor: '#1f2937' }, // gray-800
  }),
]
