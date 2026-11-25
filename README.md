# context-pane

A side pane for Claude Code that shows what the web sidebar shows, inside the VS Code extension (and the desktop app): where the session runs, how full the context window is and what fills it, which MCP connectors are connected, and a few quick settings.

## What it shows

**Environment**
- Host: Local, Cloud or Hosted, with the OS and machine name
- Repo: links to the current branch on GitHub
- Branch: the checked out branch and whether it is in sync, behind (to pull) or ahead (to push) of its upstream, as of your last fetch

**Settings**
- Dropdowns for model, effort, thinking, auto-compact, output style and permission mode, read live from `/config`. A row only appears when your version of Claude Code has it and it is not locked by a managed setting.

**Context**
- Percentage used, tokens used out of the window, and a stacked bar
- One row per category (system prompt, tools, memory files, skills, messages, autocompact buffer, free space), plus the tools loaded on demand
- A Breakdown dropdown: pick a category to see what is inside it (tokens per memory file, per skill, per MCP server) or what the category means

**Connectors**
- Every connected MCP server with its tool count
- A Tools dropdown: pick a connector, then a tool, to read its description

The pane refreshes after every response.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install context-pane --marketplace mrizwanashiq/claude-code-context-pane
```

Answer `y` to add the marketplace, then press Enter to install at the user scope. Every session you start afterwards loads the pane, including the VS Code extension.

From a shell:

```
claude plugin install context-pane --marketplace mrizwanashiq/claude-code-context-pane
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `mrizwanashiq/claude-code-context-pane`, then Add plugin.

## Use

The pane opens on its own when a session starts. If you close it, run:

```
/context-pane
```

## Notes

- Token counts are local estimates and can differ slightly from `/context`, which counts exactly using token-count requests. The estimate keeps every refresh free.
- The sync status never touches the network. Run `git fetch` (or let your editor fetch) to update it.
- Connectors lists the servers whose tools are loaded. A server that failed to connect or still needs sign-in does not appear.
- Settings change through the same path as the `/config` menu, so hooks and managed settings still apply. A refused change shows as a toast.

## Develop

Clone the repo and point Claude Code at the folder instead of installing it. In `~/.claude/settings.json`:

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-code-context-pane" }
}
```

The folder is watched, so saving `hooks/register.tsx` reloads the pane. Check your changes with:

```
claude plugin validate .
```

## License

MIT
