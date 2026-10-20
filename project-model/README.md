# Project model: openclaw-android-assistant

A working model of this repository: what it contains, how the parts connect, how a
request flows through them, and the rules the code enforces. The model is split into
four documents plus a machine-readable inventory.

| File | Read it for |
| --- | --- |
| [architecture.md](architecture.md) | The three deployable stacks, the core layers, ports, and ownership boundaries |
| [flows.md](flows.md) | Step-by-step runtime flows: gateway boot, inbound message to reply, cron, companion nodes, Android bootstrap |
| [invariants.md](invariants.md) | Rules the code and tooling enforce, plus stale docs that disagree with the tree |
| [inventory.json](inventory.json) | Generated counts and lists: plugin classification, workspace packages, core modules, subprojects |

`inventory.json` is produced by `scripts/generate-inventory.mjs`. Regenerate it after
adding plugins, packages, or core modules:

```bash
node project-model/scripts/generate-inventory.mjs
```

## What this repository is

The name suggests one app, but the tree holds three related products:

1. **OpenClaw core** (root `package.json`, `src/`, `extensions/`, `packages/`, `ui/`,
   `apps/`). A multi-channel AI gateway: one long-lived daemon that connects an agent
   runtime to messaging channels (Telegram, Slack, Discord, WhatsApp, Matrix, and
   more), exposes a WebSocket control plane, and serves a web Control UI.
2. **AnyClaw Android APK** (`android/`). A Kotlin app that embeds a Termux-style Linux
   prefix, installs Node, Codex, and OpenClaw into it on first run, and shows the web
   UI in a WebView. This is the "OpenClaw + Codex on Android" product in the README.
3. **codexui** (`openclaw-android/`, npm `@friuns/codexui`). A Vue SPA plus an Express
   bridge that drives `codex app-server` over JSON-RPC and streams results to the
   browser over SSE. The APK's WebView points at this server.

Two more Android-side trees exist and are separate from the APK above:

- `apps/android/` is the official OpenClaw companion app (Gradle, Kotlin). It is a
  **node** that connects to a gateway, not a host for one.
- `apps/ios/`, `apps/macos/`, and `apps/shared/` are companion apps in Swift.

## Scale

Numbers come from `inventory.json` (regenerate to refresh):

- 151 entries under `extensions/`: 25 channel plugins, 56 provider plugins, 2 memory
  plugins, 58 other plugins, and 4 shared helpers without a manifest.
- 21 workspace packages under `packages/` published as `@openclaw/*`.
- 69 `src/` modules; the largest are `agents` (about 1,000 source files), `plugin-sdk`,
  `infra`, `gateway`, `commands`, and `plugins`.
- Node `>=22.19.0 <23` or `>=23.11.0`; pnpm 11 workspace (`pnpm-workspace.yaml`).
- About 490 root `package.json` scripts, including `build`, `test:fast`, and many
  `check:*` guards.

## Common commands

```bash
pnpm install          # workspace install (pnpm 11)
pnpm build            # tsdown build -> dist/, entry at dist/entry.js
pnpm test:fast        # vitest unit project
pnpm check            # aggregate static checks (see invariants.md)
node openclaw.mjs gateway   # run the gateway in the foreground (after build)
```

The Android companion has its own Gradle build (`pnpm android:test`, `pnpm android:assemble`).
The codexui project builds with `npm run build` inside `openclaw-android/`.

## Scope of this model

This model describes structure and flows as they appear in the source tree and existing
docs. It does not replace `docs/` (the published documentation) or `CHANGELOG.md`. Where
an existing document disagrees with the tree, `invariants.md` lists the disagreement
and the model follows the code.
