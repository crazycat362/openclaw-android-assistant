# Runtime flows

Each flow lists the modules it passes through. Line references are to `src/gateway/server.impl.ts`
unless noted, and point at call sites that set the order.

## F1. Gateway boot (`openclaw gateway`)

1. **Wrapper gate.** `openclaw.mjs` checks the Node version (`>=22.19 <23` or `>=23.11`), manages
   the compile cache, and loads `dist/entry.js` (falling back to `dist/entry.mjs`). If the build
   output is missing it reports `missing dist/entry.(m)js (build output)`.
2. **CLI bootstrap.** `src/entry.ts` parses argv, applies profile env, handles fast paths
   (version, root help), and routes to the `gateway` subcommand in `src/cli/` and `src/commands/`.
3. **`startGatewayServer(port = 18789, opts)`** (`server.impl.ts:529`) runs these steps in order:
   - Normalize the state-dir env and clean up retired managed npm plugin generations.
   - Bootstrap the network runtime (`server-network-runtime.ts`, line ~551).
   - Prepare plugin bootstrap (`server-plugin-bootstrap.ts`, line ~679). This loads the plugin
     lookup table from manifests.
   - Start plugin discovery (`server-discovery-runtime.ts`, Bonjour/mDNS) and plugin services
     (`startPluginServices`, line ~1461) after `prepareGatewayPluginLoad`.
   - Create the HTTP and WebSocket server (`server-http.ts`, `server-ws-runtime.ts`). Serve the
     Control UI from `server-control-ui-root.ts`. Attach WS handlers (`attachGatewayWsHandlers`,
     line ~1618).
   - Start channels (`startChannels`, line ~1713). Each enabled channel plugin connects to its
     service.
   - Start scheduled services (`server-cron.ts`, `startup-tasks.ts`, line ~1852), which includes
     the cron scheduler and maintenance.
4. **Ready.** Clients may connect. Startup logs go through `server-startup-log.ts`.

Shutdown runs the close handler (`server-close.ts`) in reverse. A failed startup calls the same
handler with reason `gateway startup failed` (line ~1172).

## F2. Client connection (control plane)

Used by the CLI, the Control UI, automations, and companion nodes.

1. The client opens a WebSocket. **The first frame must be `connect`.** Any other first frame is a
   hard close.
2. The gateway sends `connect.challenge` with a nonce. The client signs it with its device identity
   (signature payload `v3`, which binds `platform` and `deviceFamily`).
3. Auth resolves through `auth*.ts` and `connection-auth.ts` (token, password, Tailscale identity,
   or trusted proxy, depending on `gateway.auth.*`). Auth applies to local and remote connections.
4. A new device ID needs pairing approval (`src/pairing/`). Loopback can be auto-approved. A device
   token is issued for later connects.
5. The gateway replies `hello-ok` with the method and event lists plus a presence and health
   snapshot.
6. Requests are `{type:"req", id, method, params}`. The method registry is `server-methods.ts`, and
   `server-methods-list.ts` is its catalog. Each method is checked for authorization and
   control-plane rate limits (`server-methods.authorization`, `control-plane-rate-limit.ts`).
   Replies are `{type:"res", id, ok, payload|error}`.
7. Events (`agent`, `chat`, `presence`, `health`, `heartbeat`, `cron`, `tick`) are pushed by
   `server-broadcast.ts`. Events are **not replayed**, so clients refresh after a gap.

Side-effecting methods (`send`, `agent`) require an idempotency key. The server keeps a short dedupe
cache, so a retry is safe.

## F3. Inbound message to reply

This is the core product path. A message from a messaging app becomes an agent turn and a reply.

1. **Channel plugin receives the event.** For example `extensions/telegram` gets an update through
   its client, or `extensions/slack` gets an event. The plugin normalizes it through the
   `openclaw/plugin-sdk/*` channel contracts.
2. **Shared channel gating** (`src/channels/`). This checks the DM policy (`direct-dm*.ts`), the
   allowlists (`allowlist-match.ts`, `allow-from.ts`), mention requirements (`mention-gating.ts`),
   command gating (`command-gating.ts`), and inbound debounce (`inbound-debounce-policy.ts`).
   Rejected messages stop here.
3. **Auto-reply dispatch.** `dispatchInboundMessage` (`src/auto-reply/dispatch.ts:528`) takes the
   finalized context and config. Command detection (`command-detection.ts`, `commands-registry*`)
   may turn the message into a control command, which runs without a model call.
4. **Session resolution.** The session key is derived (`src/config/sessions/session-key.ts`,
   `src/gateway/server-session-key.ts`). Persisted session state and delivery metadata are loaded.
5. **Agent turn.** The reply resolver calls `runEmbeddedAttempt`
   (`src/agents/embedded-agent-runner/run/attempt.ts:854`) through `run/backend.ts`. The runtime is
   chosen by the harness selection in `architecture.md` section 4.
6. **Model call.** The provider transport in `src/llm/` (or the provider plugin's stream) sends the
   request. Per-provider request params live in `src/agents/embedded-agent-runner/extra-params.*`.
   Failover can switch models (see `docs/concepts/model-failover.md`).
7. **Tool use loop.** The model's tool calls go through `agent-tools*.ts`. Tool policy filters the
   available set, `before-tool-call` and `after-tool-call` hooks run, and results go back into the
   loop. Tool results can be transformed by middleware (`plugins/agent-tool-result-middleware*`).
8. **Context management.** When context grows, compaction runs
   (`src/agents/embedded-agent-runner/compact*.ts`, with built-in hooks in `src/agents/agent-hooks/`
   for the safeguard and pruning). The transcript is rewritten through the successor-transcript
   logic (`compaction-successor-transcript.ts`).
9. **Reply delivery.** Output streams to a draft preview (`draft-stream-*`, `progress-draft-*`) when
   the channel supports it, and the final payload goes through the reply dispatcher
   (`dispatch-dispatcher.ts`) to the channel's outbound adapter. Chunking follows the channel limits
   (`draft-streaming-chunking.ts`).
10. **Persistence.** The turn is written to the session transcript and session store. Events
    (`agent`, `chat`) are broadcast to subscribed clients.

## F4. Scheduled work (cron)

1. A job is defined by config or the `cron` RPC methods. `parse.ts`, `normalize.ts`, and
   `delivery-field-schemas.ts` validate it.
2. The scheduler (`active-jobs.ts`) fires the job at its time. Each run gets a run ID and a run log
   (`run-log-jsonl.ts`).
3. Agent jobs run through `isolated-agent/`: a fresh session with its own auth profile. Command jobs
   run through `command-runner.ts`.
4. Results are delivered to a channel through `delivery-plan.ts` and `delivery.ts`. Delivery
   targets are validated (`delivery-target-validation.ts`). Failures can notify the owner
   (`delivery.failure-notify.test.ts` covers this path).
5. Heartbeat is a separate periodic check (`heartbeat-policy.ts`).

## F5. Companion node (`apps/android`, `apps/ios`, `apps/macos`)

1. The app opens a gateway connection with `role: node`. It is set up through a setup code, a QR
   code, or manual entry (`GatewayDiscovery.kt`, `GatewayEndpoint.kt`, `GatewayRegistry.kt`).
2. The app generates a device identity (`DeviceIdentityStore.kt`) and signs the gateway challenge.
   It then waits for pairing approval. Credentials are stored encrypted, and the app can lock with
   biometrics.
3. The node declares its capabilities and commands (for example camera, location, screen, voice).
   The gateway routes `node.invoke` requests to it. Commands that need approval go through the
   approval flow.
4. The app sends background presence beacons (`GatewaySession.kt`) and receives push notifications
   for status updates.
5. Cron management from the app uses admin-scoped gateway access.

The gateway side of this lives in `server-node-*.ts` and `server-talk-nodes.ts`. The protocol is
generated from TypeBox schemas, and the Swift and Kotlin models follow the generated JSON Schema.

## F6. AnyClaw Android bootstrap (`android/`)

This flow is the APK's first-run path. The steps match `CodexServerManager.kt` and the README.

1. **Foreground service and bootstrap.** `CodexForegroundService.kt` keeps the process alive.
   `BootstrapInstaller.kt` extracts the Termux bootstrap archive into the app's private prefix.
2. **Toolchain.** `installNode`, `installProot`, and `installPython` install the runtime pieces
   into the prefix (`CodexServerManager.kt:117`, `:196`, `:252`).
3. **OpenClaw.** `installOpenClawDeps` and `installOpenClaw` (lines ~342, ~514) install the gateway.
   `buildKoffi` compiles a native module. Path and shebang fixes run for the Termux prefix
   (`patchOpenClawPaths`, `patchGatewayForAndroid`).
4. **Codex.** `installCodex` (pinned `CODEX_VERSION = "0.104.0"`) and
   `installPlatformBinary` download the musl binary directly, because npm will not install it on
   Android.
5. **Proxy.** `startProxy` runs `proxy.js` on `127.0.0.1:18924`. The musl binary sends its traffic
   through `HTTPS_PROXY` to this proxy.
6. **Auth.** `loginWithUrl` or `loginWithApiKey` store the Codex login. `configureOpenClawAuth`
   writes the gateway auth config and the control-UI allowed origins.
7. **Services.** `startOpenClawGateway` runs `openclaw gateway run --force --port 18789`.
   `startOpenClawControlUiServer` serves the Control UI on `19001`. `startServer` runs codexui
   (`node <server> --port 18923 --no-password`).
8. **Ready.** `waitForServer` polls `http://127.0.0.1:18923/` for up to 60 seconds. `MainActivity`
   then loads that URL in the WebView.

## F7. codexui (`openclaw-android/`)

1. The browser loads the Vue SPA. `useDesktopState.ts` holds all state in one composable.
2. The SPA calls `codexGateway.ts` (threads, turns, models) through `codexRpcClient.ts`, which sends
   HTTP POST to `/codex-api/*`.
3. The Express server (`httpServer.ts`) passes requests to `codexAppServerBridge.ts`. The bridge
   keeps **one** `codex app-server` child process and multiplexes JSON-RPC calls over its stdio.
4. Server-initiated requests (command approvals, file changes, tool calls) are held as pending and
   answered from the UI. Notifications stream to the browser over SSE (`/codex-api/events`).
5. `authMiddleware.ts` applies password auth when enabled. The CLI defaults to port 3000 and
   supports `--no-password`.
