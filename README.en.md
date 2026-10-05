# dsh-reasoning-cycle

English | [简体中文](README.md)

`Shift+Tab` advances the current session's reasoning effort by one level — a detent wheel bolted onto
the level list the model menu already shows.

The ring is derived on every keystroke from the model metadata of the moment: the provider default
leads, then every level the selected model declares, and the level after the last one wraps back to
the provider default. Change model, change provider, change level — the next keystroke follows.
The plugin keeps no second copy of the level table.

```
provider default → low → high → max → provider default → …
```

## How it works

It reads the current session's model selection from `ctx.modelDirectories`, takes the next step
around the ring, and commits it through the same `ModelDirectory.select` the model menu uses. So:

- the level lands in the **session projection**, exactly as a menu pick does — it survives a reload;
- the plugin never touches the Host's RPC surface, never invents a level name, and never caches the
  level list;
- an open model menu is unaffected — the menu uses `Shift+Tab` itself to leave a drilled pane, and
  its `preventDefault` keeps the keystroke from reaching this plugin at all (see ADR-0001).

## Where the default binding lives

| Surface | `Shift+Tab` |
| --- | --- |
| dsh Desktop (macOS / Windows) | ✅ works out of the box |
| Web page / Linux desktop | ⬜ the command exists, but ships **no default binding**; assign one in Settings |

Skipping the default on Web and Linux is deliberate: in a browser `Shift+Tab` is reverse focus
traversal, and the registry itself rejects shift-only combinations there. The command is still
registered, so the row is present, searchable, rebindable, and unbindable in Settings → Shortcuts.

## Installing into a profile

As a bundle in `~/.dsh/profiles/<profile>/`:

```jsonc
// package.json
{
  "dependencies": {
    "dsh-reasoning-cycle": "link:/path/to/dsh-reasoning-cycle"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-reasoning-cycle"]
    }
  }
}
```

```bash
pnpm install
```

The bundle's own `cordis.patch.yml` mounts the row (`ui-reasoning-cycle`). **Do not insert it again
from the profile's `cordis.patch.yml`** — that only adds an empty host entry.

## Running the tests

```bash
npm test
```

Two suites:

- `test/client.test.mjs` — the ring, one step, where `resolve` stops and `run` starts, and the
  failure paths. Pure logic, no dependencies.
- `test/registration.test.mjs` — reads the **real shortcut registry bundle** out of the installed
  `DeepSeek Harness.app` and runs it: the command registers, the binding resolves to `⇧ Tab`, the
  gesture dispatches to this command, and a web surface **rejects** the same default (which is what
  pins the ADR-0002 tradeoff). On a machine without the app installed this suite prints one SKIP line
  and exits 0.

## Why go through the shortcut registry

Because in the Desktop shell DOM `keydown` delivery is skipped entirely
(`installKeyboard(..., native=true)`): Electron's main process matches keys against the **registered
binding table** before it forwards anything. A window listener for `Shift+Tab` would never fire on
Desktop. The full derivation is in `docs/adr/0001-register-with-the-shortcut-registry.md` (Chinese).
