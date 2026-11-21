<h1><picture><source media="(prefers-color-scheme: dark)" srcset="docs/labit-mark-dark.svg"><img src="docs/labit-mark-light.svg" alt="" width="34" height="34" align="top"></picture> labit</h1>

[![npm](https://img.shields.io/npm/v/@leonidstern/labit)](https://www.npmjs.com/package/@leonidstern/labit) [![test](https://github.com/leonidstern/labit/actions/workflows/test.yml/badge.svg)](https://github.com/leonidstern/labit/actions/workflows/test.yml) [![license: PolyForm Small Business](https://img.shields.io/badge/license-PolyForm%20Small%20Business-black)](LICENSE)

**Review is the new build.** Pin comments on your pages. Your coding agent reads them, changes the code, and answers on the pin.

![Comments pinned on a demo page](docs/comments.png)

## Start

In your project:

```sh
npx @leonidstern/labit@latest
```

It finds your running dev server (Astro, Next, Vite…) or serves plain HTML, and opens the page with comments on top. Click to comment, drag to mark an area, hold `D` and drag to draw on it (circle, arrow, underline, cross out), Shift-drag to quote words. `M` hides the comments.

## Let your agent answer

**Claude Code:** install the plugin once, then say **"start labit"** in any project.

```text
/plugin marketplace add leonidstern/labit
/plugin install labit@leonidstern
```

The plugin also wakes Claude for pins it missed: if you comment while it is busy building, or its `wait` lapsed, the pin comes in as its next turn the moment the current one ends, from any folder.

**Codex:** add the marketplace, install labit from it, and trust its hooks once with `/hooks`.

```sh
codex plugin marketplace add leonidstern/labit
```

**Cursor:** install labit from the repository as a plugin (it carries the skill and the hooks).

**opencode:** one file, in your project (or `~/.config/opencode/plugins/` for every project), and the skill from the CLI:

```sh
mkdir -p .opencode/plugins && curl -fsSL https://raw.githubusercontent.com/leonidstern/labit/main/hooks/agent.mjs -o .opencode/plugins/labit.js
```

Each gives your agent the skill and two hooks, with no MCP: while the session works, the pins it claimed show a live "session activity" line, and a pin that lands after it stopped listening comes in as its next turn (Codex and Cursor when the turn ends, opencode when the session goes idle). Without the hooks the agent still answers with `wait` and `reply`, as below.

**Any other agent:** tell it to run these in your project.

```sh
npx @leonidstern/labit@latest wait                    # ends with your next comment
npx @leonidstern/labit@latest reply <id> --done "…"   # answers on the pin and closes it
npx @leonidstern/labit@latest reply <id> --progress "…"  # during long work: one line next to its name, replaced by the next
npx @leonidstern/labit@latest pin <selector> "1. …"   # its own pin on a spot: suggestions and questions, one per point, numbered
```

Run each `wait` from the agent itself, never in a shell loop (`while true; do … wait; done`): a loop keeps listening after its session is gone, so pins are handed to nobody. A pin handed over that gets no reply of any kind in 2 minutes (`LAB_ANSWER_MS`) is marked "not answered" and goes to the next wait, and the pill says "Claude isn't answering" until that session replies.


**Fewer permission prompts (Claude Code):** copy [examples/claude-settings.json](examples/claude-settings.json) to `.claude/settings.json` in your project (or merge its `permissions` into yours). labit's commands then run without asking; `--wifi` and `invite`, which let another device in, still ask. Claude Code reads a project's allow rules only once you've opened the folder in it and trusted it.

## Good to know

- `--wifi` lets your phone comment too (`labit invite` turns it on in a running lab by itself, same address and pins; `labit --no-wifi` turns it off). Each device opens a one-time link from `npx @leonidstern/labit@latest invite`, so being on the same wifi isn't enough. The pages still travel in the clear over the wifi.
- Agents learn how you like answers: reply as usual, and when you say an answer was too long or unclear, your message shows **rule?**. Tap it and the rule goes to `~/.config/labit/replies.md`, handed to every agent with your pins.
- You name yourself once. The name is kept for this computer in `~/.config/labit/settings.json`, so every later lab starts out knowing you — browsers keep it per port, labs don't. `labit invite [name]` carries a name to a phone the same way. `--page /path` makes the link open that page. Opening a used or old link again on a phone that's already in just takes you there, and a phone that keeps using the lab stays in.
- Settings (port, your dev server, keys, the quick-action buttons of the comment box, how long the lab waits…): `labit.json` in the project and `~/.config/labit/settings.json` for you (the `actions` list is set only there, not on the page). `labit settings` shows them all; [docs/settings.md](docs/settings.md) explains each.
- A pin on a React, Vue, Next or Astro dev page also says which component drew it (`component:`) and where (`written at:`): React 18 file and line; Vue the file, no line; Next none (its built chunks are not source); Astro the file and line of what its compiler wrote. The agent never gets a guessed one.
- Comments stay in `.lab/` in your project. Add it to `.gitignore`.
- A click on the page pins a comment; the page's own links and buttons keep their clicks. Hold ⌥ to pin on anything, controls included.
- No dependencies, Node 22+. `--help` lists everything else.

Shared labs on a domain (comments from people you send a link to) come later.

## License

[PolyForm Small Business 1.0.0](LICENSE). labit is free for people and companies with fewer than 100 people and under $1M in yearly revenue: use it, change it and ship it inside your own work. Larger companies need a paid license from the author. That makes labit source-available, not OSI open source. Versions already on npm (0.6.2 and earlier) stay under MIT.

Made by [leonidstern](https://github.com/LeonidStern) · [OOZE](https://ooze.design)
