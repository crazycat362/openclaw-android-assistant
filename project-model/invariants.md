# Invariants, rules, and known gaps

Each rule names where it is stated or enforced. "Stated" means a doc says it. "Enforced" means a
check or test in the tree fails when it breaks.

## Boundaries

| Rule | Where |
| --- | --- |
| Plugins import core only through `openclaw/plugin-sdk/*`. They never import `src/**`. | Stated in `docs/agent-runtime-architecture.md`. Checked by inspection: 0 extension files import `src/` directly, and 9,199 import from `openclaw/plugin-sdk`. Enforced by `check:architecture` (import cycles, deprecated API use). |
| Core stays lean. Optional capability ships as a plugin unless the plugin API cannot express it yet. | `VISION.md`, `PROJECT_SPEC.md` ("Plugins & Memory") |
| Only one memory plugin is active at a time (the memory slot). | `VISION.md` line 84 |
| The gateway is the only process that opens a messaging session (for example one WhatsApp/Baileys session per host). | `docs/concepts/architecture.md` (Invariants) |
| Nodes (apps) declare `role: node`, capabilities, and commands, and need device pairing. | `docs/concepts/architecture.md` |
| Non-loopback connects need explicit pairing approval. Gateway auth applies to every connection, local or remote. | `docs/concepts/architecture.md` |
| `gateway.auth.mode: "none"` disables shared-secret auth. Keep it off public or untrusted ingress. | `docs/concepts/architecture.md` |

## Protocol

| Rule | Where |
| --- | --- |
| The first WebSocket frame must be `connect`. Any other first frame is a hard close. | `docs/concepts/architecture.md` |
| Events are not replayed. Clients refresh after a gap. | `docs/concepts/architecture.md` |
| `send` and `agent` require idempotency keys. | `docs/concepts/architecture.md` |
| The protocol is defined in TypeBox. JSON Schema is generated from it, and Swift models are generated from the JSON Schema. Do not hand-edit generated output. | `docs/concepts/architecture.md`. Enforced by `check:protocol-coverage` and `check:base-config-schema --check`. |

## Configuration

| Rule | Where |
| --- | --- |
| Runtime code reads only the current config schema. There are no long-lived aliases that silently accept old or renamed keys. | `PROJECT_SPEC.md` ("Configuration compatibility") |
| A config change that invalidates existing user config needs a doctor migration. `openclaw doctor --fix` detects the old shape, explains it, backs it up when needed, and rewrites it. Core config is repaired by core doctor code. Plugin config is repaired by the plugin's doctor contract. | `PROJECT_SPEC.md`. Code: `src/commands/doctor/`, `src/plugins/doctor-contract-registry.ts`. |
| Diagnostics and status paths read config without writing it. | Commit `6fd9c1df` ("keep diagnostics config reads read-only") |

## Security defaults

| Rule | Where |
| --- | --- |
| Strong defaults, with explicit operator knobs for risky paths. | `PROJECT_SPEC.md` ("Security"), `SECURITY.md` (canonical policy) |
| Outbound network to user-supplied URLs goes through SSRF and net policy. | `packages/net-policy`, `src/security/`. About 13 `*ssrf*` test files exist under `src/` and `packages/`. |
| Secrets are configured through secret references. | `docs/gateway/secrets.md`, `src/secrets/` |

## Runtime

| Rule | Where |
| --- | --- |
| Node `>=22.19.0 <23` or `>=23.11.0`. The wrapper exits otherwise. | `package.json` `engines`, `openclaw.mjs` |
| The built-in runtime id is `openclaw`. `pi` normalizes to it, and `codex-app-server` normalizes to `codex`. | `docs/agent-runtime-architecture.md` |
| `auto` runtime selection picks a plugin harness that supports the model, else the built-in runtime. | Same doc |

## Contribution

| Rule | Where |
| --- | --- |
| One PR is one issue or topic. PRs over about 5,000 changed lines get review only in exceptional cases. | `VISION.md` ("Contribution rules") |
| Don't open large batches of tiny PRs at once. Group very small related fixes. | `VISION.md` |
| Static guards enforce several of these rules. `pnpm check` runs `scripts/check.mjs`. The individual guards are `check:*` scripts. Notable: `check:import-cycles`, `check:madge-import-cycles`, `check:no-conflict-markers`, `check:loc` (max 500 lines per TS file), `check:docs`. | `package.json` |

## Known gaps: docs that disagree with the tree

The model follows the code. These documents are out of date or describe a different scope.

1. **`README.md` project structure.** It lists `clawcode-android/` as the Claw Code tree. That
   directory is not in this repository. Its `src/` entry describes codexui, which now lives at
   `openclaw-android/src/`. The root `src/` is OpenClaw core.
2. **`PROJECT_SPEC.md`.** It describes only codexui (`codex-web-local`). Its paths are relative to
   that subproject, not to the repository root. It is not a spec for OpenClaw core.
3. **`AGENTS.md` (root; `CLAUDE.md` is a symlink to it), and `openclaw-android/AGENTS.md`.** Both
   describe a worktree merge workflow tied to `/Users/igor/Git-projects/codex-web-local` and a `zpw/`
   directory. Neither path exists here. Two of the rules still apply in general terms: commit after
   each discrete task, and run a headless Playwright check plus a screenshot after UI or behavior
   changes. The rest is not applicable.
4. **Codex install path in `android/README.md`.** Step 3 says `npm install -g @openai/codex
   codex-web-local`. The Kotlin code also downloads the native musl binary directly
   (`CodexServerManager.installPlatformBinary`), because npm cannot install that binary on Android.
   The README does not mention the direct download.
5. **`CodexServerManager.isServerBundleInstalled()`** (`android/app/src/main/java/com/codex/mobile/CodexServerManager.kt:101`)
   always returns `false`. The README describes a pre-built `server-bundle/` path. Treat the
   bundle check as a stub until it is wired up.

## What the model does not claim

- Behavior of individual channel integrations, provider APIs, or model output. The model describes
  where each concern lives, not whether it works against a live service.
- Runtime performance, memory use, or build times.
- That every script in `package.json` passes on this checkout. The model does not run the test
  suite.
