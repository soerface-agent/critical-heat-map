// Light or dark theme, following the system setting unless the user picked one. The choice is
// remembered in localStorage; index.html applies it before the page renders.

export type ThemeMode = 'auto' | 'light' | 'dark'

const STORAGE_KEY = 'theme'
const MODES: ThemeMode[] = ['auto', 'light', 'dark']
const systemQuery = matchMedia('(prefers-color-scheme: dark)')

function stored(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return MODES.includes(value as ThemeMode) ? (value as ThemeMode) : 'auto'
  } catch {
    return 'auto'
  }
}

class Theme {
  mode = $state<ThemeMode>(stored())
  #systemDark = $state(systemQuery.matches)
  dark = $derived(this.mode === 'dark' || (this.mode === 'auto' && this.#systemDark))

  constructor() {
    systemQuery.addEventListener('change', () => (this.#systemDark = systemQuery.matches))
  }

  /** auto → light → dark → auto */
  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]
    if (this.mode === 'auto') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = this.mode
    try {
      if (this.mode === 'auto') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, this.mode)
    } catch {
      // Without storage the choice only lasts for this page view
    }
  }
}

export const theme = new Theme()
