export type Item = { name: string; tokens: number }
export type Row = { name: string; tokens: number; kind: string; items: Item[]; note: string | null }
export type Setting = { key: string; label: string; kind: string; value: string; options: string[] }
export type Connector = { name: string; tools: string[] }
export type Snapshot = {
  tokens: number
  window: number
  rows: Row[]
  host: { kind: 'Local' | 'Cloud' | 'Hosted'; platform: string; machine: string | null }
  repo: string | null
  branch: string | null
  url: string | null
  behind: number | null
  ahead: number | null
  connectors: Connector[]
  settings: Setting[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-pane': { snap: Shaped<Snapshot | null>; open: Shaped<string | null>; tool: Shaped<string | null>; row: Shaped<string | null> }
  }
}
