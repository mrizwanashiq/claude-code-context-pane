import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren } from 'claude-code'

import type { Connector, Item, Layout, Limit, Row, Setting, Snapshot, Today, Weekly } from '../types'

const PALETTE = ['#5b8def', '#e07a3f', '#3fb58f', '#a78bfa', '#d4a72c', '#e0607e', '#38bdf8', '#94a3b8']

// rizwanashiq.com brand: one oxblood accent, hairline rules, no cards.
// ponytail: the dark-theme accent only; switch to #8a2b1d when the pane exposes the light theme
const ACCENT = '#e3907c'
const BRAND_URL = 'https://rizwanashiq.com'
const RULE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 1" preserveAspectRatio="none"><rect width="300" height="1" fill="#3a3a3f"/></svg>'

const PANE = 'session-cockpit'
const snap = atom({ plugin: 'session-cockpit', key: 'snap' } as const, null, { shape: 'snap-10' })
const openConnector = atom({ plugin: 'session-cockpit', key: 'open' } as const, null, { shape: 'open-1' })
const openTool = atom({ plugin: 'session-cockpit', key: 'tool' } as const, null, { shape: 'tool-1' })
const openRow = atom({ plugin: 'session-cockpit', key: 'row' } as const, null, { shape: 'row-1' })
const guard = atom({ plugin: 'session-cockpit', key: 'guard' } as const, { advisor: 0, opus: 0, warned: [] as string[] }, { shape: 'guard-1' })

export const SECTIONS = ['usage', 'context', 'today', 'guardrails', 'environment', 'settings', 'connectors'] as const
const TITLES: Record<string, string> = {
  usage: 'Usage', context: 'Context', today: 'Today, all sessions', guardrails: 'Guardrails',
  environment: 'Environment', settings: 'Settings', connectors: 'Connectors',
}
const layout = atom({ plugin: 'session-cockpit', key: 'layout' } as const, { order: [...SECTIONS] as string[], hidden: [] as string[] }, { shape: 'layout-1' })
const welcome = atom({ plugin: 'session-cockpit', key: 'welcome' } as const, false, { shape: 'welcome-1' })
const ROADMAP_URL = 'https://github.com/mrizwanashiq/claude-code-context-pane/blob/main/ROADMAP.md'

// Atoms redraw the pane; $.store keeps the value for the next session. Picks and layout go through both.
// ponytail: each write names its atom literally, the hooks scan rejects an atom passed as a variable
const hydrate = async ($: any) => {
  const [l, r, o, t] = await Promise.all(['layout', 'row', 'open', 'tool'].map(key => $.store.get(key)))
  if (l !== undefined) await update($, layout, () => arrange(l as Layout, ''))
  if (r !== undefined) await update($, openRow, () => r as string | null)
  if (o !== undefined) await update($, openConnector, () => o as string | null)
  if (t !== undefined) await update($, openTool, () => t as string | null)
}

// A stored order from an older version may miss sections added since; they go at the end.
export const arrange = (l: Layout, action: string): Layout => {
  const order = [...l.order.filter(id => (SECTIONS as readonly string[]).includes(id)), ...SECTIONS.filter(id => !l.order.includes(id))]
  const [verb, id] = action.split(':')
  const i = order.indexOf(id ?? '')
  if (verb === 'reset') return { order: [...SECTIONS], hidden: [] }
  if (i < 0) return { order, hidden: l.hidden }
  if (verb === 'hide') return { order, hidden: [...new Set([...l.hidden, id!])] }
  if (verb === 'show') return { order, hidden: l.hidden.filter(h => h !== id) }
  if (verb === 'up' && i > 0) [order[i - 1], order[i]] = [order[i]!, order[i - 1]!]
  return { order, hidden: l.hidden }
}

let opts = { cap: 200000, warn: 80, advisorBudget: 2, pinned: new Set<string>() }

const k = (n: number) =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : `${n}`

const serverName = (raw: string) =>
  raw.replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '').replace(/_/g, ' ')

const connectorsOf = async ($: any): Promise<Connector[]> => {
  const byServer = new Map<string, string[]>()
  for (const t of await $.tool.list()) {
    const m = t.mcp && /^mcp__(.+?)__(.+)$/.exec(t.name)
    if (m) byServer.set(m[1], [...(byServer.get(m[1]) ?? []), m[2]])
  }
  return [...byServer]
    .map(([raw, tools]) => ({ name: serverName(raw), tools: tools.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const git = async ($: any, root: string, ...args: string[]) => {
  const r = await $.process.run(['git', ...args], { cwd: root, timeoutMs: 2000 })
  return r.exitCode === 0 ? r.stdout.trim() : null
}

const webUrl = (remote: string | null, branch: string | null) => {
  const m = remote && /github\.com[:/](.+?)(\.git)?$/.exec(remote)
  if (!m) return null
  return `https://github.com/${m[1]}${branch ? `/tree/${encodeURIComponent(branch)}` : ''}`
}

const envOf = async ($: any, repo: any) => {
  if (!repo) return { repo: null, branch: null, url: null, behind: null, ahead: null }
  // ponytail: counts are against the last fetch; no auto-fetch so the pane never touches the network
  const [branch, counts] = await Promise.all([
    git($, repo.root, 'branch', '--show-current'),
    git($, repo.root, 'rev-list', '--left-right', '--count', '@{u}...HEAD'),
  ])
  const [behind, ahead] = counts ? counts.split(/\s+/).map(Number) : [null, null]
  return {
    repo: repo.name ?? repo.root.split('/').pop() ?? null,
    branch: branch || null,
    url: webUrl(repo.remote, branch || null),
    behind: behind ?? null,
    ahead: ahead ?? null,
  }
}

const PLATFORM: Record<string, string> = { macos: 'macOS', windows: 'Windows', wsl: 'WSL', linux: 'Linux' }

const hostOf = async ($: any): Promise<Snapshot['host']> => {
  const [info, probe] = await Promise.all([
    $.session.info(),
    $.process.run(['sh', '-c', 'printf "%s\\n%s" "${CLAUDE_CODE_REMOTE:-}" "$(hostname -s)"'], { timeoutMs: 2000 }),
  ])
  const [remote, machine] = probe.exitCode === 0 ? probe.stdout.split('\n') : ['', '']
  const kind = info.isHosted ? 'Hosted' : remote === 'true' ? 'Cloud' : 'Local'
  return { kind, platform: PLATFORM[info.platform ?? ''] ?? 'Unknown', machine: kind === 'Local' ? machine?.trim() || null : null }
}

const NOTES: Record<string, string> = {
  messages: 'The conversation so far: your prompts, replies, tool calls and their results. /compact or /clear shrinks it.',
  'system prompt': "Claude Code's own instructions plus the output style and environment details.",
  'system tools': 'Schemas of the built-in tools (Read, Edit, Bash, Agent and the rest) sent with every request.',
  'autocompact buffer': 'Room kept free so the conversation can be summarised before the window fills.',
  'free space': 'What is left of the window before autocompact starts.',
}

const top = (items: Item[]) => items.sort((a, b) => b.tokens - a.tokens).slice(0, 40)

const byServer = (tools: any[]) => {
  const m = new Map<string, number>()
  for (const t of tools) {
    const key = serverName(t.serverName.replace(/ /g, '_'))
    m.set(key, (m.get(key) ?? 0) + t.tokens)
  }
  return top([...m].map(([name, tokens]) => ({ name, tokens })))
}

const home = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, '~')

// The breakdown has no id per row, so details are matched on the row's printed name.
const detailOf = (name: string, kind: string, b: any): Pick<Row, 'items' | 'note'> => {
  const n = name.toLowerCase()
  const none = { items: [], note: null }
  if (!b) return none
  if (n.startsWith('mcp tools')) return { items: byServer((b.mcpTools ?? []).filter((t: any) => t.isLoaded === (kind !== 'deferred'))), note: null }
  if (n.startsWith('memory files')) return { items: top((b.memoryFiles ?? []).map((f: any) => ({ name: home(f.path), tokens: f.tokens }))), note: null }
  if (n.startsWith('skills')) return { items: top((b.skills?.skillFrontmatter ?? []).map((x: any) => ({ name: x.pluginName ? `${x.pluginName}:${x.name}` : x.name, tokens: x.tokens }))), note: null }
  if (n.startsWith('custom agents')) return { items: top((b.agents ?? []).map((a: any) => ({ name: a.agentType, tokens: a.tokens }))), note: null }
  if (n.startsWith('system tools') && kind === 'deferred') return { items: [], note: 'Built-in tools loaded on demand through tool search; they cost nothing until used.' }
  return { items: [], note: NOTES[n] ?? null }
}

// ponytail: matched on /config's own keys; a key this misses just doesn't show. Widen the pattern to add more.
const WANTED = /^model$|effort|thinking|autocompact|outputstyle|defaultmode|permission/i

const settingsOf = async ($: any): Promise<Setting[]> =>
  (await $.config.list())
    .filter((r: any) => !r.isLocked && WANTED.test(r.key) && (r.kind === 'boolean' || (r.kind === 'choice' && r.options?.length)))
    .map((r: any) => ({
      key: r.key,
      label: r.label,
      kind: r.kind,
      value: String(r.value),
      options: r.kind === 'boolean' ? ['true', 'false'] : [...r.options],
    }))

const LIMIT_NAMES: Record<string, string> = { five_hour: 'Session (5hr)', seven_day: 'Weekly (7 day)', spend_limit: 'Spend limit' }

// "Resets at 5:10 PM" today, "Resets Sun, Nov 29 at 3:00 AM" on another day.
export const resetLabel = (iso: string | null, now = new Date()) => {
  if (!iso) return null
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Resets at ${time}`
  return `Resets ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`
}

const meter = (pct: number, fill: string) => {
  const w = Math.min(Math.max(pct, 0), 100) * 3
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 6" preserveAspectRatio="none"><clipPath id="m"><rect width="300" height="6" rx="3"/></clipPath><g clip-path="url(#m)"><rect width="300" height="6" fill="#2a2a2e"/><rect width="${w.toFixed(2)}" height="6" fill="${fill}"/></g></svg>`
}

const untilReset = (iso: string | null) => {
  if (!iso) return null
  const mins = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000))
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

const limitColor = (percentUsed: number): string | undefined => {
  // TODO(human): return a theme color name for this percentUsed, or undefined for the default text color
  return undefined
}

type Ledger = { weekReset?: string; dayKey?: string; dayStart?: number; dayAt?: number; winReset?: string; winStart?: number }

// resetsAt can wobble by seconds between readings; only a jump counts as a new window.
const moved = (a?: string | null, b?: string | null) => !a || !b || Math.abs(Date.parse(a) - Date.parse(b)) > 10 * 60000

// Rate limits only say "% used now", so today's and this window's share come from baselines kept across sessions.
export const weeklyOf = async ($: any, limits: Limit[]): Promise<Weekly | null> => {
  const w = limits.find(l => l.kind === 'seven_day')
  if (!w) return null
  const f = limits.find(l => l.kind === 'five_hour')
  const L: Ledger = ((await $.store.get('ledger')) as Ledger | undefined) ?? {}
  const now = Date.now()
  const pct = w.percentUsed
  const day = new Date(now).toDateString()
  const newWeek = L.weekReset !== undefined && moved(L.weekReset, w.resetsAt)
  L.weekReset = w.resetsAt ?? L.weekReset
  if (newWeek) Object.assign(L, { dayKey: day, dayStart: 0, dayAt: now, winReset: undefined })
  if (L.dayKey !== day) Object.assign(L, { dayKey: day, dayStart: pct, dayAt: now })
  if (f && moved(L.winReset, f.resetsAt)) Object.assign(L, { winReset: f.resetsAt, winStart: newWeek ? 0 : pct })
  await $.store.set('ledger', L)
  const daysLeft = w.resetsAt ? Math.max((Date.parse(w.resetsAt) - now) / 864e5, 1 / 24) : null
  return {
    today: Math.max(0, pct - (L.dayStart ?? pct)),
    todaySince: L.dayAt ?? now,
    window: f ? Math.max(0, pct - (L.winStart ?? pct)) : null,
    pace: daysLeft ? Math.max(0, 100 - pct) / daysLeft : null,
  }
}

// All-session totals come from token_meter.py's cache (it scans every log since midnight
// every 2 min). Machines without the meter just don't get the section.
export const todayOf = async ($: any): Promise<Today | null> => {
  try {
    const d = JSON.parse(await $.fs.read(`${await $.env.get('HOME')}/.claude/.token_today.json`))
    const modelTotal = d.models.reduce((s: number, [, n]: [string, number]) => s + n, 0)
    const opus = d.models.filter(([m]: [string, number]) => /opus/i.test(m)).reduce((s: number, [, n]: [string, number]) => s + n, 0)
    return {
      total: d.total,
      ageMin: Math.round((Date.now() / 1000 - d.updated) / 60),
      biggest: d.biggest,
      cap: d.cap,
      opusShare: modelTotal ? (opus / modelTotal) * 100 : 0,
      projects: d.projects.slice(0, 3),
      live: d.sessions.filter((s: any) => s.live).map((s: any) => ({ title: `${s.project} · ${s.title}`, ctx: s.ctx })),
    }
  } catch {
    return null
  }
}

const clock = (ms: number) => {
  const d = new Date(ms)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

const warnOnce = async ($: any, key: string, text: string) => {
  const g = await read($, guard)
  if (g.warned.includes(key)) return
  $.ui.toast(text)
  await update($, guard, x => ({ ...x, warned: [...x.warned, key] }))
}

const checkThresholds = async ($: any) => {
  const s = await read($, snap)
  if (!s) return
  const pct = (s.tokens / s.window) * 100
  if (s.tokens >= opts.cap) await warnOnce($, 'ctx-cap', `Context is past your ${k(opts.cap)} cap: write a handoff and start a fresh session.`)
  else if (pct >= opts.warn) await warnOnce($, 'ctx-warn', `Context at ${pct.toFixed(0)}%: consider /compact or a handoff.`)
  for (const l of s.limits)
    if (l.percentUsed >= opts.warn)
      await warnOnce($, `limit:${l.kind}:${l.resetsAt}`, `${LIMIT_NAMES[l.kind] ?? l.kind} at ${l.percentUsed}%${l.resetsAt ? `, resets in ${untilReset(l.resetsAt)}` : ''}.`)
}

const refresh = async ($: any) => {
  // ponytail: 'summary' is a local estimate; switch to 'full' for /context-exact counts (costs token-count calls)
  const [{ context, rateLimits, cost }, repo, connectors, host, settings] = await Promise.all([
    $.session.usage({ breakdown: 'summary' }),
    $.session.repo(),
    connectorsOf($),
    hostOf($),
    settingsOf($),
  ])
  const b = context.breakdown
  const rows: Row[] = (b?.categories ?? []).map((c: any) => ({ name: c.name, tokens: c.tokens, kind: c.kind, ...detailOf(c.name, c.kind, b) }))
  const used = rows.filter((r: any) => r.kind === 'used').reduce((s: number, r: any) => s + r.tokens, 0)
  const limits: Limit[] = (rateLimits ?? []).map((r: any) => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null }))
  const next: Snapshot = {
    tokens: context.tokens ?? used,
    window: context.window,
    rows,
    host,
    ...(await envOf($, repo)),
    connectors,
    settings,
    limits,
    cost: cost ? { usd: cost.usd, unknownPrice: !!cost.hasUnknownPrice } : null,
    weekly: await weeklyOf($, limits),
    today: await todayOf($),
  }
  await update($, snap, () => next)
}

export const register: Register = (on, options) => {
  opts = {
    cap: Number(options.contextCap ?? 200000),
    warn: Number(options.warnPercent ?? 80),
    advisorBudget: Number(options.advisorBudget ?? 2),
    pinned: new Set(String(options.pinnedAgents ?? '').split(',').map(x => x.trim()).filter(Boolean)),
  }

  // Warn only: blocking would also stop agents whose definition pins a cheaper model but isn't in the list.
  on('agent.spawn', async ($, e, next) => {
    if (!e.model && /opus/i.test(e.parentModel) && !opts.pinned.has(e.subagentType)) {
      $.ui.toast(`${e.subagentType} agent started without a model, so it may run on ${e.parentModel}. Pass haiku or sonnet.`)
      await update($, guard, g => ({ ...g, opus: g.opus + 1 }))
    }
    return next(e)
  })

  // The advisor runs inside the API request, so no tool.call fires for it; the step's response lists it.
  on('turn.step', async function* ($, e, next) {
    const res = yield* next(e)
    const n = (res.serverToolUses ?? []).filter(u => u.name === 'advisor').length
    if (n) {
      const g = await update($, guard, x => ({ ...x, advisor: x.advisor + n }))
      if (g.advisor > opts.advisorBudget) $.ui.toast(`Advisor call ${g.advisor}, over your budget of ${opts.advisorBudget}.`)
    }
    return res
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cockpit', description: 'Open the Session Cockpit pane' })
    await hydrate($)
    // Shown for the whole first session, then never again unless picked from Customize.
    if (!(await $.store.get('welcomed'))) {
      await $.store.set('welcomed', true)
      await update($, welcome, () => true)
    }
    void $.ui.open({ id: PANE, title: 'Cockpit' })
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'cockpit' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Cockpit' })
    return { text: 'Cockpit opened.' }
  })

  on('session.measure', async ($, e, next) => {
    void refresh($).then(() => checkThresholds($))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Link, Select } = ui
    const Svg = 'Svg' in ui ? ui.Svg : null
    const s = await read($, snap)
    if (!s) return <Text dimColor>Measuring…</Text>
    const [rowOpen, connOpen, toolOpen, g, lay, showWelcome] = await Promise.all([read($, openRow), read($, openConnector), read($, openTool), read($, guard), read($, layout), read($, welcome)])
    const toolDesc = toolOpen
      ? ((await $.tool.list()).find((t: any) => t.name.endsWith(`__${toolOpen.split('::')[1]}`) && t.name.includes(toolOpen.split('::')[0]))?.description ?? '')
      : ''

    const pct = (n: number) => `${((n / s.window) * 100).toFixed(1)}%`
    const live = s.rows.filter(r => r.kind !== 'deferred')
    const deferred = s.rows.filter(r => r.kind === 'deferred')
    const used = live.filter(r => r.kind === 'used')
    const colorOf = (r: Row) =>
      r.kind === 'used' ? (PALETTE[used.indexOf(r) % PALETTE.length] ?? '#5b8def') : r.kind === 'buffer' ? '#71717a' : '#3f3f46'

    // Same shape as the Environment rows, the one layout VS Code draws reliably here:
    // plain Text left, a plain row of Texts right, space-between. No fixed widths or truncation.
    const row = (o: {
      dot?: string
      label: string
      muted?: boolean
      right: string[]
    }) => (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
        <Box flexDirection="row" alignItems="center" gap="sm">
          {o.dot && <Text color={o.dot}>●</Text>}
          <Text dimColor={o.muted}>{o.label}</Text>
        </Box>
        <Box flexDirection="row" alignItems="center" gap="sm">
          {o.right.map((t, i) => (
            <Text dimColor={i === 0 || o.muted} tabular>{t}</Text>
          ))}
        </Box>
      </Box>
    )

    const detail = (children: RenderChildren) => (
      <Box flexDirection="column" gap="xs" paddingLeft="lg" paddingRight="md" paddingY="xs">{children}</Box>
    )
    const sub = (left: string, right: string) => (
      <Box flexDirection="row" justifyContent="space-between" gap="sm">
        <Text size="caption" dimColor wrap="truncate-middle">{left}</Text>
        <Box flexShrink={0}>
          <Text size="caption" dimColor tabular wrap="clip">{right}</Text>
        </Box>
      </Box>
    )

    const ctxRow = (r: Row, muted = false) =>
      row({ dot: muted ? '#52525b' : colorOf(r), label: r.name, muted, right: [k(r.tokens), muted ? '—' : pct(r.tokens)] })

    const openable = s.rows.filter(r => r.items.length > 0 || r.note !== null)
    const rowId = (r: Row) => `${r.kind}:${r.name}`
    const picked = openable.find(r => rowId(r) === rowOpen)
    const conn = s.connectors.find(c => c.name === connOpen)
    const pickedTool = conn && toolOpen?.startsWith(`${conn.name.replace(/ /g, '_')}::`) ? toolOpen.split('::')[1] : undefined

    const capX = (opts.cap / s.window) * 300
    let x = 0
    const segs = live
      .filter(r => r.kind !== 'free')
      .map(r => {
        const w = (r.tokens / s.window) * 300
        const seg = `<rect x="${x.toFixed(2)}" y="0" width="${Math.max(w - 0.6, 0).toFixed(2)}" height="8" fill="${colorOf(r)}"/>`
        x += w
        return seg
      })
      .join('')
    const bar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 8" preserveAspectRatio="none"><clipPath id="c"><rect width="300" height="8" rx="4"/></clipPath><g clip-path="url(#c)"><rect width="300" height="8" fill="#2a2a2e"/>${segs}${capX < 300 ? `<rect x="${(capX - 1).toFixed(2)}" y="0" width="2" height="8" fill="${ACCENT}"/>` : ''}</g></svg>`
    const overCap = s.tokens >= opts.cap

    const rule = Svg ? <Svg source={RULE} alt="" height={1} /> : <Text dimColor>{'─'.repeat(30)}</Text>
    const section = (title: string, aside: string | null, body: RenderChildren) => (
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text size="caption" weight="semibold" color={ACCENT}>{title.toUpperCase()}</Text>
          {aside && <Text size="caption" dimColor>{aside}</Text>}
        </Box>
        {rule}
        {body}
      </Box>
    )

    const sync =
      s.behind === null
        ? { text: 'no upstream', color: undefined }
        : s.behind > 0
          ? { text: `${s.behind} to pull${s.ahead ? ` · ${s.ahead} to push` : ''}`, color: 'warning' }
          : s.ahead
            ? { text: `${s.ahead} to push`, color: 'suggestion' }
            : { text: 'in sync', color: 'success' }

    const kv = (key: string, value: RenderChildren) => (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="md">
        <Text dimColor>{key}</Text>
        {value}
      </Box>
    )

    const parts: Record<string, RenderChildren> = {
      usage: section(
          'Usage',
          s.cost ? `~$${s.cost.usd.toFixed(2)}${s.cost.unknownPrice ? '*' : ''} this session (est.)` : null,
          <Box flexDirection="column" gap="xs">
            {s.limits.length === 0 && kv('Rate limits', <Text dimColor>show after the first reply</Text>)}
            {s.limits.map(l => {
              const reset = resetLabel(l.resetsAt)
              return (
                <Box flexDirection="column" gap="xs" paddingBottom="sm">
                  <Box flexDirection="row" justifyContent="space-between" alignItems="center">
                    <Text>{LIMIT_NAMES[l.kind] ?? l.kind}</Text>
                    <Text color={limitColor(l.percentUsed)} tabular>{`${l.percentUsed}%`}</Text>
                  </Box>
                  {Svg ? (
                    <Svg source={meter(l.percentUsed, '#3b7ddd')} alt={`${l.percentUsed}% used`} height={6} />
                  ) : (
                    <Text dimColor>{'█'.repeat(Math.round(l.percentUsed / 100 * 30)).padEnd(30, '░')}</Text>
                  )}
                  {reset && <Text size="caption" dimColor>{reset}</Text>}
                </Box>
              )
            })}
            {s.weekly &&
              kv(
                'Weekly used today',
                <Box flexDirection="row" gap="sm">
                  <Text tabular>{`+${s.weekly.today.toFixed(1)}%`}</Text>
                  <Text dimColor>· since {clock(s.weekly.todaySince)}</Text>
                </Box>,
              )}
            {s.weekly?.window != null && kv('This 5-hour window', <Text tabular>{`+${s.weekly.window.toFixed(1)}% of weekly`}</Text>)}
            {s.weekly?.pace != null && kv('Daily pace to last the week', <Text tabular>{`${s.weekly.pace.toFixed(1)}% / day`}</Text>)}
          </Box>,
        ),

      context: section(
          'Context',
          `${k(s.tokens)} / ${k(s.window)} · cap ${k(opts.cap)}`,
          <Box flexDirection="column" gap="md">
            <Box flexDirection="row" justifyContent="space-between" alignItems="center">
              <Text size="heading" weight="semibold" color={overCap ? 'error' : undefined}>{pct(s.tokens)} used</Text>
              {overCap && <Text color="error">past cap · hand off</Text>}
            </Box>
            {Svg ? (
              <Svg source={bar} alt="Context usage bar, the accent line marks your cap" height={8} />
            ) : (
              <Text dimColor>{'█'.repeat(Math.round((s.tokens / s.window) * 30)).padEnd(30, '░')}</Text>
            )}
            <Box flexDirection="column" gap="xs">{live.map(r => ctxRow(r))}</Box>
            {deferred.length > 0 && (
              <Box flexDirection="column" gap="xs" paddingTop="sm">
                <Text size="caption" dimColor>Loaded on demand</Text>
                {deferred.map(r => ctxRow(r, true))}
              </Box>
            )}
            {openable.length > 0 && (
              <Box flexDirection="column" gap="sm" paddingTop="sm">
                <Select
                  key="ctx-detail"
                  label="Breakdown"
                  value={picked ? rowId(picked) : ''}
                  options={[{ value: '', label: 'Choose a category…' }, ...openable.map(r => ({ value: rowId(r), label: r.name }))]}
                  onSelect={async v => {
                    await update($, openRow, () => v || null)
                    await $.store.set('row', v || null)
                  }}
                />
                {picked &&
                  detail(
                    <Box flexDirection="column" gap="xs">
                      {picked.note ? <Text size="caption" dimColor>{picked.note}</Text> : undefined}
                      {picked.items.map(it => sub(it.name, k(it.tokens)))}
                    </Box>,
                  )}
              </Box>
            )}
          </Box>,
        ),

      today: s.today &&
          section(
            'Today, all sessions',
            s.today.ageMin > 5 ? `updated ${s.today.ageMin} min ago` : null,
            <Box flexDirection="column" gap="xs">
              {kv('Tokens', <Text weight="semibold" tabular>{k(s.today.total)}</Text>)}
              <Box flexDirection="column" gap="xs" paddingLeft="md">
                {s.today.projects.map(([name, n]) =>
                  row({ label: name, muted: true, right: [k(n), `${Math.round((n / (s.today?.total || 1)) * 100)}%`] }),
                )}
              </Box>
              {kv('On Opus', <Text color={s.today.opusShare > 80 ? 'warning' : undefined} tabular>{`${s.today.opusShare.toFixed(0)}%`}</Text>)}
              {kv(
                'Biggest live context',
                <Text color={s.today.biggest >= s.today.cap ? 'error' : undefined} tabular>{`${k(s.today.biggest)} / ${k(s.today.cap)}`}</Text>,
              )}
              {s.today.live
                .filter(l => l.ctx >= (s.today?.cap ?? opts.cap))
                .map(l => (
                  <Box paddingLeft="md">{row({ dot: ACCENT, label: l.title, muted: true, right: [k(l.ctx), 'over cap'] })}</Box>
                ))}
            </Box>,
          ),

      guardrails: section(
          'Guardrails',
          null,
          <Box flexDirection="column" gap="xs">
            {kv('Advisor calls', <Text color={g.advisor > opts.advisorBudget ? 'warning' : undefined} tabular>{`${g.advisor} / ${opts.advisorBudget}`}</Text>)}
            {kv('Agents left on Opus', <Text color={g.opus > 0 ? 'warning' : undefined} tabular>{`${g.opus}`}</Text>)}
          </Box>,
        ),

      environment: s.repo &&
          section(
            'Environment',
            null,
            <Box flexDirection="column" gap="xs">
              {kv('Host', <Text wrap="truncate">{[s.host.kind, s.host.platform, s.host.machine].filter(Boolean).join(' · ')}</Text>)}
              {kv('Repo', s.url ? <Link href={s.url} label={s.repo} /> : <Text>{s.repo}</Text>)}
              {kv(
                'Branch',
                <Box flexDirection="row" gap="sm">
                  <Text>{s.branch ?? 'detached'}</Text>
                  <Text color={sync.color} dimColor={!sync.color}>· {sync.text}</Text>
                </Box>,
              )}
            </Box>,
          ),

      settings: s.settings.length > 0 &&
          section(
            'Settings',
            null,
            <Box flexDirection="column" gap="sm">
              {s.settings.map(st => (
                <Select
                  key={`cfg-${st.key}`}
                  label={st.label}
                  value={st.value}
                  options={st.options.map(o => ({ value: o, label: st.kind === 'boolean' ? (o === 'true' ? 'On' : 'Off') : o }))}
                  onSelect={async v => {
                    const value = st.kind === 'boolean' ? v === 'true' : v
                    const { deny } = await $.config.set({ key: st.key, value })
                    if (deny) $.ui.toast(`${st.label}: ${deny}`)
                    await refresh($)
                  }}
                />
              ))}
            </Box>,
          ),

      connectors: s.connectors.length > 0 &&
          section(
            'Connectors',
            `${s.connectors.length} connected`,
            <Box flexDirection="column" gap="xs">
              {s.connectors.map(c => row({ dot: '#3fb58f', label: c.name, right: [`${c.tools.length} tools`] }))}
              <Box flexDirection="column" gap="sm" paddingTop="sm">
                <Select
                  key="mcp-pick"
                  label="Tools"
                  value={conn?.name ?? ''}
                  options={[{ value: '', label: 'Choose a connector…' }, ...s.connectors.map(c => ({ value: c.name, label: c.name }))]}
                  onSelect={async v => {
                    await update($, openTool, () => null)
                    await update($, openConnector, () => v || null)
                    await $.store.set('tool', null)
                    await $.store.set('open', v || null)
                  }}
                />
                {conn && (
                  <Select
                    key="tool-pick"
                    label={`${conn.name} tool`}
                    value={pickedTool ?? ''}
                    options={[{ value: '', label: 'Choose a tool…' }, ...conn.tools.map(t => ({ value: t, label: t.replace(/_/g, ' ') }))]}
                    onSelect={async v => {
                      const t = v ? `${conn.name.replace(/ /g, '_')}::${v}` : null
                      await update($, openTool, () => t)
                      await $.store.set('tool', t)
                    }}
                  />
                )}
                {pickedTool && detail(<Text size="caption" dimColor maxLines={10}>{toolDesc || 'No description.'}</Text>)}
              </Box>
            </Box>,
          ),
    }

    const order = arrange(lay, '').order
    const shown = order.filter(id => !lay.hidden.includes(id))
    const customize = [
      { value: '', label: 'Customize…' },
      ...order.flatMap(id => {
        const hidden = lay.hidden.includes(id)
        const at = shown.indexOf(id)
        return [
          { value: `${hidden ? 'show' : 'hide'}:${id}`, label: `${hidden ? 'Show' : 'Hide'} ${TITLES[id]}` },
          ...(!hidden && at > 0 ? [{ value: `up:${id}`, label: `Move ${TITLES[id]} up` }] : []),
        ]
      }),
      { value: 'welcome', label: showWelcome ? 'Dismiss welcome' : 'Show welcome' },
      { value: 'reset', label: 'Reset layout' },
    ]

    return (
      <Box flexDirection="column" gap="xl" padding="md">
        {showWelcome &&
          section(
            'Welcome',
            null,
            <Box flexDirection="column" gap="xs">
              <Text size="caption">Session Cockpit keeps this session cheap, safe and in view.</Text>
              {[
                ['Usage', 'rate-limit windows, today\'s share of the weekly, cost estimate'],
                ['Context', 'window used, your cap, what fills it'],
                ['Today', 'tokens across all sessions, from token_meter.py'],
                ['Guardrails', 'advisor calls and agents left on Opus'],
                ['Environment, Settings, Connectors', 'repo sync, quick /config switches, MCP tools'],
              ].map(([a, b]) => <Text size="caption" dimColor>{`${a}: ${b}`}</Text>)}
              <Text size="caption" dimColor>Cap, warn % and budgets: /config, plugin options. Hide or reorder sections with Customize at the bottom.</Text>
              <Link href={ROADMAP_URL} label="Roadmap" />
            </Box>,
          )}

        {shown.map(id => parts[id]).filter(Boolean)}

        <Select
          key="customize"
          label="Layout"
          value=""
          options={customize}
          onSelect={async v => {
            if (!v) return
            if (v === 'welcome') return update($, welcome, w => !w)
            const next = arrange(lay, v)
            await update($, layout, () => next)
            await $.store.set('layout', next)
          }}
        />

        <Box flexDirection="column" gap="sm">
          {rule}
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text size="caption" dimColor>Session Cockpit by Rizwan Ashiq</Text>
            <Link href={BRAND_URL} label="rizwanashiq.com" />
          </Box>
        </Box>
      </Box>
    )
  })
}
