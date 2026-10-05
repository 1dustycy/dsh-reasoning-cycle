# dsh-reasoning-cycle

English | [简体中文](README.md)

`Shift+Tab` advances the current session's reasoning effort by one level — a detent wheel bolted onto
the level list the model menu already shows.

The ring is derived on every keystroke from the model metadata of the moment: it walks the levels the
model declares, and the level after the last one wraps to the first. A leading **provider default**
stop appears only when the level that default resolves to is *not* one of the declared levels.
Change model, change provider, change level — the next keystroke follows. The plugin keeps no second
copy of the level table.

```
DeepSeek (defaultEffort = high, and high is declared):  off → low → high → max → off → …
A model whose default is not a declared level:          provider default → off → low → high → max → provider default → …
```

Why the first line is not `provider default → off → …`: that spelling makes the provider default and
`high` two adjacent ring positions pointing at the same level, so `max` steps onto `high` and never
leaves — the user sees a two-level toggle. Derivation in ADR-0003.

## How it works

It reads the current session's model selection from `ctx.modelDirectories`, takes the next step
around the ring, and commits it through the same `ModelDirectory.select` the model menu uses. So:

- the level lands in the **session projection**, exactly as a menu pick does — it survives a reload;
- the plugin never touches the Host's RPC surface, never invents a level name, and never caches the
  level list;
- a step that would land on the level already in effect (a one-stop ring) issues no Select — that is
  not a step;
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

Three suites:

- `test/client.test.mjs` — the shape of the ring (including "a redundant provider default leaves no
  stop"), one step, **four presses from `high` walking a full turn**, where `resolve` stops and `run`
  starts, and the failure paths. Pure logic, no dependencies. That walk is the ADR-0003 regression:
  a suite that only asserts the ring's contents could not catch it, because the wrong ring matched
  the wrong spec.
- `test/registration.test.mjs` — reads the **real shortcut registry bundle** out of the installed
  `DeepSeek Harness.app` and runs it: the command registers, the binding resolves to `⇧ Tab`, the
  gesture dispatches to this command, and a web surface **rejects** the same default (which is what
  pins the ADR-0002 tradeoff). On a machine without the app installed this suite prints one SKIP line
  and exits 0.
- `test/wiring.test.mjs` — resolves the bundle the way DSH does: the profile's
  `dsh.profile.bundles` lists it, the patch file the bundle declares exists, and that patch mounts
  exactly one row. Prints one SKIP line and exits 0 when no profile links the package; point it
  elsewhere with `DSH_PROFILE_DIR`.

## Why go through the shortcut registry

Because in the Desktop shell DOM `keydown` delivery is skipped entirely
(`installKeyboard(..., native=true)`): Electron's main process matches keys against the **registered
binding table** before it forwards anything. A window listener for `Shift+Tab` would never fire on
Desktop. The full derivation is in `docs/adr/0001-register-with-the-shortcut-registry.md` (Chinese).
