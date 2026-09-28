import type { Keymap } from '@shared/types'

/**
 * Shortcut presets. Each maps a command id to one or more key combos ("Mod" = Ctrl on
 * Windows/Linux, Cmd on macOS). Commands a preset doesn't mention keep their default binding.
 * "Shift Shift" (double-tap Shift) is supported for JetBrains' Search Everywhere.
 */
export type Bindings = Record<string, string[]>

export const DEFAULT_KEYS: Bindings = {
  'app.palette': ['Mod+P', 'Mod+Shift+P'],
  'repo.open': ['Mod+O'],
  'repo.recent': ['Mod+Shift+O'],
  'tab.new': ['Mod+T'],
  'tab.close': ['Mod+W'],
  'tab.next': ['Mod+Tab'],
  'tab.prev': ['Mod+Shift+Tab'],
  commit: ['Mod+K'],
  'commit.focus': ['Mod+Shift+C'],
  'commit.commit': ['Mod+Enter'],
  'commit.noverify': ['Mod+Shift+Enter'],
  'stage.all': ['Mod+Shift+A'],
  'stage.none': ['Mod+Shift+U'],
  'remote.fetch': ['Alt+F'],
  'remote.pull': ['Alt+L'],
  'remote.push': ['Alt+P'],
  'branch.new': ['Mod+B'],
  'branch.checkout': ['Mod+Shift+B'],
  'branch.goto': ['Mod+G'],
  'goto.commit': ['Mod+Shift+G'],
  'goto.working': ['Mod+0'],
  'stash.push': ['Alt+S'],
  'stash.pop': ['Alt+Shift+S'],
  'hooks.show': ['Mod+Shift+H'],
  'view.find': ['Mod+F'],
  'view.history': ['Mod+H'],
  'view.console': ['Mod+`'],
  'view.sidebar': ['Mod+\\'],
  'view.refresh': ['F5'],
  'app.settings': ['Mod+,'],
  'app.shortcuts': ['Mod+/']
}

const VSCODE: Bindings = {
  'app.palette': ['Mod+Shift+P', 'Mod+P', 'F1'],
  'view.sidebar': ['Mod+B'],
  'branch.new': ['Mod+Alt+B'],
  'goto.working': ['Mod+Shift+G'],
  'goto.commit': ['Mod+G'],
  'branch.goto': ['Mod+Alt+G'],
  'tab.close': ['Mod+W', 'Mod+F4'],
  'tab.next': ['Mod+PageDown', 'Mod+Tab'],
  'tab.prev': ['Mod+PageUp', 'Mod+Shift+Tab'],
  'view.console': ['Mod+`', 'Mod+J'],
  'view.refresh': ['F5', 'Mod+R'],
  'app.shortcuts': ['Mod+K Mod+S', 'Mod+/']
}

const JETBRAINS: Bindings = {
  'app.palette': ['Shift Shift', 'Mod+Shift+A'],
  commit: ['Mod+K'],
  'remote.push': ['Mod+Shift+K'],
  'remote.pull': ['Mod+T'],
  'tab.new': ['Mod+Alt+T'],
  'branch.checkout': ['Mod+Shift+`'],
  'stage.discard': ['Mod+Alt+Z'],
  'app.settings': ['Mod+Alt+S'],
  'view.refresh': ['Mod+Alt+Y', 'F5'],
  'view.console': ['Alt+F12'],
  'view.sidebar': ['Alt+1'],
  'goto.working': ['Alt+0'],
  'view.history': ['Alt+9'],
  'goto.commit': ['Mod+N'],
  'tab.close': ['Mod+F4'],
  'tab.next': ['Alt+Right'],
  'tab.prev': ['Alt+Left'],
  'app.shortcuts': ['Mod+Shift+/']
}

const RESHARPER: Bindings = {
  'app.palette': ['Mod+T', 'Mod+Shift+A'],
  'tab.new': ['Mod+Alt+T'],
  'goto.commit': ['Mod+Shift+T'],
  'branch.goto': ['Mod+Alt+Shift+T'],
  'view.sidebar': ['Mod+Alt+L'],
  'view.console': ['Mod+Alt+O'],
  'tab.close': ['Mod+F4'],
  'tab.next': ['Mod+Tab'],
  'tab.prev': ['Mod+Shift+Tab'],
  'view.refresh': ['Mod+R', 'F5'],
  'app.shortcuts': ['Mod+Shift+/']
}

export const KEYMAP_NAMES: Record<Keymap, string> = {
  default: 'Odysseus (default)',
  vscode: 'VS Code',
  jetbrains: 'JetBrains (IntelliJ, Rider, WebStorm)',
  resharper: 'Visual Studio + ReSharper'
}

export function bindingsFor(keymap: Keymap): Bindings {
  const preset = keymap === 'vscode' ? VSCODE : keymap === 'jetbrains' ? JETBRAINS : keymap === 'resharper' ? RESHARPER : {}
  const out: Bindings = { ...DEFAULT_KEYS, ...preset }
  // A combo taken by the preset shouldn't also fire a default command.
  const taken = new Set(Object.entries(preset).flatMap(([, v]) => v))
  for (const [id, keys] of Object.entries(out)) {
    if (id in preset) continue
    const free = keys.filter((k) => !taken.has(k))
    if (free.length) out[id] = free
    else delete out[id]
  }
  return out
}
