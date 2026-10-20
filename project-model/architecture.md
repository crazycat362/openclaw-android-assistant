# Architecture

## 1. Three stacks, one repository

```
                 ┌─────────────────────── OpenClaw core (root) ───────────────────────┐
 Messaging apps  │                                                                    │
 Telegram, Slack │  channel plugins ──► auto-reply ──► agent runtime ──► LLM providers│
 Discord, Matrix │  (extensions/*)      (src/auto-    (src/agents/,     (src/llm/,   │
 WhatsApp, …  ◄──┼──────────────────── reply/)        harness, tools)  provider plugins)
                 │        ▲                  ▲                                         │
                 │        │                  │                                         │
                 │  ┌─────┴──────────────────┴─────────────────────────────────────┐   │
                 │  │ Gateway daemon  (src/gateway/, ws + http on :18789)          │   │
                 │  │  methods · events · auth · pairing · cron · plugin bootstrap │   │
                 │  └─────▲───────────────▲──────────────────────────▲─────────────┘   │
                 └────────┼───────────────┼──────────────────────────┼─────────────────┘
                          │ ws            │ ws (role: operator)      │ ws (role: node)
                 Control UI (ui/)   CLI / automations        Companion apps
                 served by gateway                          apps/android, apps/ios,
                                                            apps/macos

 AnyClaw APK (android/)            Embedded Linux prefix ($PREFIX)
 WebView ──► :18923 codexui ─────► codex app-server (JSON-RPC over stdio)
                                   openclaw gateway  :18789  (same core as above)
                                   openclaw Control UI static :19001
                                   CONNECT proxy     :18924  (DNS/TLS bridge for musl binaries)

 codexui (openclaw-android/)  Vue SPA ──HTTP/SSE──► Express bridge ──stdio──► codex app-server
```

The three stacks share no code at runtime, with one exception: the APK runs OpenClaw core
(the gateway) inside the embedded prefix. The companion apps and codexui talk to a
gateway or a Codex process over the network or stdio. They are not imported by core.

## 2. OpenClaw core: layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| CLI bootstrap | `openclaw.mjs`, `src/entry.ts`, `src/cli/`, `src/commands/` | Node version gate, compile cache, respawn, argv routing, subcommands (`gateway`, `doctor`, `config`, …) |
| Gateway | `src/gateway/` | WebSocket and HTTP server, typed method dispatch, auth, device pairing, events, startup/shutdown, config hot reload |
| Channels | `src/channels/` (shared), `extensions/<channel>/` (plugins) | Inbound event normalization, allowlists, DM policy, mention gating, draft streaming, outbound delivery |
| Auto-reply | `src/auto-reply/` | Turns an inbound message into a reply: command detection, session resolution, dispatch to the reply resolver |
| Agent runtime | `src/agents/` (`embedded-agent-runner/`, `harness/`, `agent-tools*.ts`, `sessions/`, `agent-hooks/`) | Attempt loop, compaction, tool policy, before/after tool-call hooks, skill and prompt assembly |
| Agent core package | `packages/agent-core/` (`@openclaw/agent-core`) | Reusable loop, message and harness types, session-storage contracts. Consumed by `src/agents/runtime/` |
| LLM and providers | `src/llm/`, `packages/ai/`, `packages/llm-core/`, `extensions/<provider>/` | Model registry, provider transports and streaming, per-provider request quirks |
| Plugins | `src/plugins/` (loader, registry, activation), `src/plugin-sdk/` | Manifest discovery, activation planning, registration of channels/providers/tools/hooks, plugin-facing barrels |
| Plugin SDK | `packages/plugin-sdk/` (`@openclaw/plugin-sdk`), `openclaw/plugin-sdk/*` | The only supported import surface for plugins |
| Config | `src/config/` | Schema (TypeBox), load/write (`io.ts`), paths (`~/.openclaw`), sessions store, legacy-shape detection |
| Cron | `src/cron/` | Scheduled jobs; isolated agent runs; delivery of results to channels; run logs |
| Sessions | `src/sessions/`, `src/config/sessions/` | Session keys, persistence, delivery metadata, pruning and compaction |
| Protocol | `packages/gateway-protocol/`, `packages/gateway-client/` | Gateway wire types and the client used by CLI and nodes |
| Infra and security | `src/infra/`, `src/security/`, `src/secrets/`, `src/daemon/` | Env policy, process supervision, SSRF and net policy, secret refs, launchd/systemd helpers |
| Media and voice | `src/media*/`, `src/tts/`, `src/talk/`, `src/realtime-transcription/`, `src/image-generation/`, `src/video-generation/`, `src/music-generation/` | Media understanding and generation, speech, realtime talk |
| Tools and web | `src/web-fetch/`, `src/web-search/`, `src/mcp/`, `src/acp/`, `src/node-host/` (browser automation lives in `extensions/browser`) | Web fetch and search, MCP client integration, ACP (agent client protocol), remote node execution |
| UX surfaces | `src/tui/`, `src/wizard/`, `src/crestodian/`, `ui/`, `src/flows/` | Terminal UI, onboarding wizard, Control UI (`ui/`, package `openclaw-control-ui`), guided flows |

Sizes (non-test source files, from `inventory.json`): `agents` ≈ 1,004, `plugin-sdk` ≈ 466,
`infra` ≈ 438, `gateway` ≈ 425, `commands` ≈ 397, `plugins` ≈ 368, `auto-reply` ≈ 348,
`cli` ≈ 278, `config` ≈ 242, `channels` ≈ 224.

## 3. Extension model

Every directory under `extensions/` is a plugin, and each one ships an
`openclaw.plugin.json` manifest. The manifest decides what the plugin contributes:

- **Channel plugins** (25) declare `channels`. Examples: `telegram`, `slack`, `discord`,
  `whatsapp`, `matrix`, `signal`, `irc`, `zalo`, `msteams`, `googlechat`, `qa-channel`.
- **Provider plugins** (56) declare `providers`. Examples: `anthropic`, `openai`, `codex`,
  `github-copilot`, `ollama`, `vllm`, `amazon-bedrock`, `openrouter`.
- **Memory plugins** (2): `memory-core` and `memory-lancedb`. Only one memory plugin can be
  active at a time (see `invariants.md`).
- **Other plugins** (58): tools, search backends (`brave`, `exa`, `tavily`, `searxng`),
  speech (`elevenlabs`, `deepgram`), browser, canvas, diagnostics exporters
  (`diagnostics-otel`, `diagnostics-prometheus`), workboard, webhooks, voice-call,
  migration helpers (`migrate-claude`, `migrate-hermes`), and more.
- **Shared helpers without a manifest** (4): `image-generation-core`,
  `media-understanding-core`, `video-generation-core`, `test-support`.

Two plugin styles exist (from `PROJECT_SPEC.md` and `VISION.md`):

- **Code plugins** run in-process and register runtime hooks, providers, channels, or tools.
- **Bundle plugins** package skills, MCP servers, and configuration declaratively through
  `package.json` `openclaw` metadata. The docs prefer this style when it is enough.

## 4. Runtime selection for agent turns

The agent runtime is pluggable through "harnesses":

- The built-in runtime id is `openclaw`. The legacy alias `pi` normalizes to it.
- `codex-app-server` normalizes to `codex`, which a plugin harness registers.
- Selection is config-driven (`agentRuntime.id` at model or provider scope). `auto`, the
  default, picks a registered plugin harness that supports the provider and model, and
  otherwise falls back to the built-in runtime.
- The `openai` provider on the official endpoint defaults to the `codex` harness. A custom
  `baseUrl` keeps its configured behavior.

Source: `docs/concepts/agent-runtimes.md`, `docs/openclaw-agent-runtime.md`, and
`src/agents/harness/` in the tree.

## 5. Ports and processes

| Port | Process | Stack | Purpose |
| --- | --- | --- | --- |
| 18789 | `openclaw gateway` | Core | WebSocket control plane and HTTP. Canvas lives under `/__openclaw__/canvas/` on the same port |
| 18923 | codexui server | APK / codexui | HTTP for the WebView (default in codexui CLI is 3000 when run standalone) |
| 18924 | CONNECT proxy (`proxy.js`) | APK | DNS and TLS bridge for musl-linked native binaries |
| 19001 | Control UI static server | APK | Serves the OpenClaw Control UI assets |

Gateway bind is loopback by default. Non-loopback exposure is an explicit operator choice
(see `docs/gateway/network-model.md` and `invariants.md`).

## 6. Ownership boundaries

- **Plugins talk to core only through `openclaw/plugin-sdk/*`.** They do not import
  `src/**`. This is the most important boundary in the codebase.
- **The gateway owns every messaging connection.** One gateway per host holds the WhatsApp
  (Baileys) session. Clients and nodes never open it directly.
- **Companion apps are nodes.** They connect to the gateway with `role: node`, declare their
  capabilities and commands, and rely on device pairing. They do not run agents.
- **The APK is a host, not a node.** It starts its own gateway process inside the embedded
  prefix and points the WebView at codexui.
- **codexui owns no agent logic.** It forwards JSON-RPC between the browser and `codex app-server`.
