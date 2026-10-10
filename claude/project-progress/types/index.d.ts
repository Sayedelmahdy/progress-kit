export type Item = { name: string; w: number; status: 'done' | 'active' | 'todo'; progress?: number }
export type Phase = { id: string; name: string; items: Item[] }
export type Progress = {
  updated: string
  now: { title: string; who: string; since: string }[]
  next: string[]
  log: { at: string; text: string }[]
  phases: Phase[]
}
export type Loaded = { data: Progress | null; path: string | null; error: string | null }

declare module 'claude-code' {
  interface PluginState {
    'project-progress': { loaded: Loaded; isCollapsed: boolean }
  }
}
