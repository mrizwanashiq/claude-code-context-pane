export type Item = { name: string; tokens: number }
export type Row = { name: string; tokens: number; kind: string; items: Item[]; note: string | null }
export type Setting = { key: string; label: string; kind: string; value: string; options: string[] }
export type Connector = { name: string; tools: string[] }
export type Limit = { kind: string; percentUsed: number; resetsAt: string | null }
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
  limits: Limit[]
  cost: { usd: number; unknownPrice: boolean } | null
  weekly: Weekly | null
  today: Today | null
}
export type Today = {
  total: number
  ageMin: number
  biggest: number
  cap: number
  opusShare: number
  projects: [string, number][]
  live: { title: string; ctx: number }[]
}
export type Weekly = { today: number; todaySince: number; window: number | null; pace: number | null }
export type Guard = { advisor: number; opus: number; warned: string[] }

declare module 'claude-code' {
  interface PluginState {
    'session-cockpit': { snap: Shaped<Snapshot | null>; open: Shaped<string | null>; tool: Shaped<string | null>; row: Shaped<string | null>; guard: Shaped<Guard> }
  }
}
