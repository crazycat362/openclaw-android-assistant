#!/usr/bin/env node
// Regenerates project-model/inventory.json from the repository tree.
// Dependency-free: run from anywhere with `node project-model/scripts/generate-inventory.mjs`.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outFile = join(here, "..", "inventory.json");

const readJson = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));

// Count non-test TypeScript/Kotlin/Swift source files under a directory.
const countSources = (dir) => {
  let count = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|kt|swift)$/.test(entry) && !/\.test\.ts$/.test(entry)) {
        count += 1;
      }
    }
  };
  walk(join(root, dir));
  return count;
};

// Classify each extension by the capabilities its manifest declares.
const classifyExtensions = () => {
  const groups = { channels: [], providers: [], memory: [], other: [], noManifest: [] };
  for (const name of readdirSync(join(root, "extensions")).sort()) {
    if (!statSync(join(root, "extensions", name)).isDirectory()) continue;
    const manifestPath = join("extensions", name, "openclaw.plugin.json");
    if (!existsSync(join(root, manifestPath))) {
      groups.noManifest.push(name);
      continue;
    }
    const manifest = readJson(manifestPath);
    if (manifest.channels?.length) groups.channels.push(name);
    else if (manifest.providers?.length) groups.providers.push(name);
    else if (manifest.kind === "memory") groups.memory.push(name);
    else groups.other.push(name);
  }
  return groups;
};

const listPackages = () =>
  readdirSync(join(root, "packages"))
    .sort()
    .filter((name) => existsSync(join(root, "packages", name, "package.json")))
    .map((name) => {
      const pkg = readJson(join("packages", name, "package.json"));
      return { dir: `packages/${name}`, name: pkg.name, description: pkg.description ?? "" };
    });

const listCoreModules = () =>
  readdirSync(join(root, "src"))
    .sort()
    .filter((name) => statSync(join(root, "src", name)).isDirectory())
    .map((name) => ({ dir: `src/${name}`, sourceFiles: countSources(`src/${name}`) }))
    .sort((a, b) => b.sourceFiles - a.sourceFiles);

const listSubprojects = () => {
  const subprojects = [
    { dir: "ui", role: "Control UI (lit) for the OpenClaw gateway" },
    { dir: "apps/android", role: "OpenClaw companion Android app (Gradle, Kotlin)" },
    { dir: "apps/ios", role: "OpenClaw companion iOS app (Swift)" },
    { dir: "apps/macos", role: "OpenClaw companion macOS app (Swift)" },
    { dir: "android", role: "AnyClaw Android APK: Termux-style bootstrap that runs the stack in a WebView" },
    { dir: "openclaw-android", role: "codexui: Vue SPA + Express bridge to `codex app-server` (JSON-RPC over HTTP/SSE)" },
    { dir: "packages", role: "Workspace packages published as @openclaw/* libraries" },
    { dir: "extensions", role: "Bundled plugins (channels, providers, tools, memory)" },
  ];
  return subprojects.map((item) => ({ ...item, present: existsSync(join(root, item.dir)) }));
};

const pkg = readJson("package.json");
const inventory = {
  generatedFrom: relative(root, outFile).split("\\").join("/"),
  project: { name: pkg.name, version: pkg.version, engines: pkg.engines, packageManager: pkg.packageManager },
  entryPoints: {
    cliWrapper: "openclaw.mjs",
    cliBootstrap: "src/entry.ts",
    gatewayServer: "src/gateway/server.impl.ts (startGatewayServer)",
    inboundDispatch: "src/auto-reply/dispatch.ts (dispatchInboundMessage)",
    agentAttempt: "src/agents/embedded-agent-runner/run/attempt.ts (runEmbeddedAttempt)",
    pluginSdkWorkspace: "packages/plugin-sdk",
  },
  ports: { gateway: 18789, anyclawWebView: 18923, connectProxy: 18924, controlUiStatic: 19001 },
  extensions: classifyExtensions(),
  packages: listPackages(),
  coreModules: listCoreModules(),
  subprojects: listSubprojects(),
  scripts: Object.keys(pkg.scripts ?? {}).length,
};

writeFileSync(outFile, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Wrote ${relative(process.cwd(), outFile)} (${inventory.coreModules.length} core modules, ${inventory.packages.length} packages)`);
