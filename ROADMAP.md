# Session Cockpit roadmap

Updated Nov 25 2026.

## Goal

A pane beside the chat that keeps a Claude Code session cheap, safe and in view: limits, cost, context, what is running, and credentials the model can use without ever seeing.

## Done

- Environment: host, repo link, branch sync (as of last fetch)
- Settings: model, effort, thinking, autocompact, output style, permission mode, read from `/config`
- Context: % used, stacked bar, per-category rows, Breakdown dropdown
- Connectors: servers with tool counts, Tools dropdown with descriptions
- Usage: 5-hour and weekly limit %, time to reset, session cost estimate (written, not yet seen rendered)
- Renamed to Session Cockpit (`session-cockpit`, `/cockpit`, v0.2.0)
- Cost guardrails (Nov 25):
  - Usage: weekly % used today (since first reading), this 5-hour window's share of the weekly, daily pace to last the week; baselines kept in `$.store` across sessions
  - Today, all sessions: tokens, top 3 projects, Opus share, biggest live context, live sessions over cap (reads `~/.claude/.token_today.json` from token_meter.py; hidden where it is missing)
  - Guardrails: context cap line on the bar and a cap row, advisor call count against budget (from `turn.step` server tool uses), agents started without a model while on Opus
  - Toasts once each: context past warn %, context past cap, a rate-limit window past warn %
  - `userConfig`: contextCap, warnPercent, advisorBudget, pinnedAgents
  - Tests: `tests/ledger.test.ts` (weekly ledger, meter reader)

## In progress

- `limitColor()` thresholds in `hooks/register.tsx` (TODO left for Rizwan)
- Screenshot check in VS Code of the Settings, Usage, Today and Guardrails sections
- Agent guard only warns; no resolved model is exposed at spawn, so a type not in `pinnedAgents` whose definition sets a model still warns

## Next, in order

### 1. Cost guardrails (follow-ups)
- Handoff command past the cap
- Block mode for the agent guard, once the warning list is tuned

### 2. Safe credentials for browser testing
Problem: browser tests log in as client and staff, and today the password passes through the model's context and transcript.

Design:
- Each secret is a `userConfig` field marked `sensitive`, so it lives in the OS keychain, never in a file or the repo
- The model writes a placeholder, `{{secret:STAGING_ADMIN_PASSWORD}}`, in a Chrome or Playwright type / fill call
- A `tool.call` hook on `mcp__claude-in-chrome__*` and `mcp__plugin_playwright_*` swaps the placeholder for the value just before the tool runs
- After the tool answers, the hook replaces any occurrence of a secret value in the result with its placeholder, so snapshots and page text never show it
- The hook denies a placeholder inside script tools (`javascript_tool`, `browser_evaluate`, `browser_run_code_unsafe`) and inside navigate URLs, where the value could be sent anywhere
- The hook also cleans Bash output, in case a secret ends up there
- A Secrets row in the pane lists the names only, plus a count of uses this session

Why not plain env variables: the model can run `echo $VAR` or `env` and read them. An env variable is safe only if the same scrubbing applies, so the keychain is the default and env is an optional source.

Known limit: a screenshot of a field that shows its text in plain view still shows the value. Use password fields, or skip the screenshot right after typing.

### 3. What is still running
- Background agents, monitors, loops and crons, each with a stop control
- Docker containers with uptime
- Shared Chrome lock holder and age, stale past 30 minutes

### 4. Team options
- Thresholds, cap, Docker on/off, Chrome lock path as `userConfig` options
- Optional fetch on open, so "to pull" is current

### 5. Community
- Rename the GitHub repo to `claude-code-session-cockpit` (needs Rizwan's OK), update URLs and the local folder
- Screenshots in the README
- Field starter packs as copy-only suggestions, list kept in a JSON file

## Open decisions for Rizwan

- Repo rename now or later
- Agent model guard: warn only, or block
- Secrets: keychain only, or also read env variables
