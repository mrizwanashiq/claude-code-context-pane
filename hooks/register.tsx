import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren } from 'claude-code'

import type { Connector, Item, Row, Setting, Snapshot } from '../types'

const PALETTE = ['#5b8def', '#e07a3f', '#3fb58f', '#a78bfa', '#d4a72c', '#e0607e', '#38bdf8', '#94a3b8']

const PANE = 'context-pane'
const snap = atom({ plugin: 'context-pane', key: 'snap' } as const, null, { shape: 'snap-7' })
const openConnector = atom({ plugin: 'context-pane', key: 'open' } as const, null, { shape: 'open-1' })
const openTool = atom({ plugin: 'context-pane', key: 'tool' } as const, null, { shape: 'tool-1' })
const openRow = atom({ plugin: 'context-pane', key: 'row' } as const, null, { shape: 'row-1' })

const k = (n: number) =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`

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

const refresh = async ($: any) => {
  // ponytail: 'summary' is a local estimate; switch to 'full' for /context-exact counts (costs token-count calls)
  const [{ context }, repo, connectors, host, settings] = await Promise.all([
    $.session.usage({ breakdown: 'summary' }),
    $.session.repo(),
    connectorsOf($),
    hostOf($),
    settingsOf($),
  ])
  const b = context.breakdown
  const rows: Row[] = (b?.categories ?? []).map((c: any) => ({ name: c.name, tokens: c.tokens, kind: c.kind, ...detailOf(c.name, c.kind, b) }))
  const used = rows.filter((r: any) => r.kind === 'used').reduce((s: number, r: any) => s + r.tokens, 0)
  const next: Snapshot = {
    tokens: context.tokens ?? used,
    window: context.window,
    rows,
    host,
    ...(await envOf($, repo)),
    connectors,
    settings,
  }
  await update($, snap, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'context-pane', description: 'Open the context breakdown pane' })
    void $.ui.open({ id: PANE, title: 'Context' })
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'context-pane' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Context' })
    return { text: 'Context pane opened.' }
  })

  on('session.measure', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Link, Select } = ui
    const Svg = 'Svg' in ui ? ui.Svg : null
    const s = await read($, snap)
    if (!s) return <Text dimColor>Measuring…</Text>
    const [rowOpen, connOpen, toolOpen] = await Promise.all([read($, openRow), read($, openConnector), read($, openTool)])
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
    const bar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 8" preserveAspectRatio="none"><clipPath id="c"><rect width="300" height="8" rx="4"/></clipPath><g clip-path="url(#c)"><rect width="300" height="8" fill="#2a2a2e"/>${segs}</g></svg>`

    const section = (title: string, aside: string | null, body: RenderChildren) => (
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="row" justifyContent="space-between">
          <Text size="caption" weight="semibold" dimColor>{title.toUpperCase()}</Text>
          {aside && <Text size="caption" dimColor>{aside}</Text>}
        </Box>
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

    return (
      <Box flexDirection="column" gap="xl" padding="md">
        {s.repo &&
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
          )}

        {s.settings.length > 0 &&
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
          )}

        {section(
          'Context',
          `${k(s.tokens)} / ${k(s.window)}`,
          <Box flexDirection="column" gap="md">
            <Text size="heading" weight="semibold">{pct(s.tokens)} used</Text>
            {Svg ? (
              <Svg source={bar} alt="Context usage bar" height={8} />
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
                  onSelect={v => update($, openRow, () => v || null)}
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
        )}

        {s.connectors.length > 0 &&
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
                  }}
                />
                {conn && (
                  <Select
                    key="tool-pick"
                    label={`${conn.name} tool`}
                    value={pickedTool ?? ''}
                    options={[{ value: '', label: 'Choose a tool…' }, ...conn.tools.map(t => ({ value: t, label: t.replace(/_/g, ' ') }))]}
                    onSelect={v => update($, openTool, () => (v ? `${conn.name.replace(/ /g, '_')}::${v}` : null))}
                  />
                )}
                {pickedTool && detail(<Text size="caption" dimColor maxLines={10}>{toolDesc || 'No description.'}</Text>)}
              </Box>
            </Box>,
          )}
      </Box>
    )
  })
}
