// ST profile — this fork's specialisation for roleplay clients.
//
// Four things are pinned down here, each of them measured against the live 2.x
// gateway before it was written down:
//
//   1. the body parameters a roleplay client sends on every turn survive the
//      proxy — they used to be dropped silently, which changes how the model
//      answers while still returning HTTP 200;
//   2. the client's output limit is honoured as max_completion_tokens instead
//      of being discarded on the 2.x upstream;
//   3. the vendor banner rides in a system message of its own and the client's
//      persona is left byte-for-byte alone, while the identity guard and the
//      quarantine keep working exactly as before;
//   4. the dry-run mode shows the outgoing request without touching the cloud.
//
// Offline only: no network, no credits, no upstream.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { check, summary, startProxy, stopProxy, post } from "./_helpers.mjs";
import { PEN_TEST_PORTS } from "../lib/constants.js";
import { loadConfig, getShapeLayer, inspectUpstreamRequest, writeDryRunRecord } from "../lib/core.js";
import { createIdentityLayer } from "../lib/identity.js";
import { PINNED_BANNER_2X, BANNER_MODE_MERGE, BANNER_MODE_SEPARATE } from "../lib/shape.js";

function captureLog() {
  const warns = [];
  const infos = [];
  return {
    warns,
    infos,
    log: {
      warn: (m) => warns.push(String(m)),
      info: (m) => infos.push(String(m)),
      debug: () => {},
      error: () => {},
      success: () => {},
    },
  };
}

// loadConfig() reads the env at call time, so a case that needs a different
// mode has to hold the env swap for its whole body.
async function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined || v === "") delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// A fresh fake HOME per case, so banner discovery never sees this machine's app.
function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "glmp-st-"));
}

async function withHome(home, fn) {
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
    PROXY_STATE_DIR: process.env.PROXY_STATE_DIR,
  };
  const restore = (key) => {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.PROXY_STATE_DIR;
  try {
    return await fn();
  } finally {
    restore("HOME");
    restore("USERPROFILE");
    restore("OPENCLAW_STATE_DIR");
    restore("PROXY_STATE_DIR");
  }
}

// The exact body a roleplay client sends, as captured from its console.
function stBody(overrides = {}) {
  return {
    model: "zaicoding_glm-5.3",
    messages: [
      { role: "system", content: "You are Aria, a cheerful guide to the city." },
      { role: "user", content: "hello" },
    ],
    stream: false,
    temperature: 0,
    max_tokens: 60000,
    presence_penalty: 0,
    frequency_penalty: 0,
    top_p: 1,
    enable_thinking: true,
    clear_thinking: false,
    reasoning_effort: "high",
    ...overrides,
  };
}

// ---- 1. the client's own parameters reach the upstream ----------------------

const home = makeHome();
await withHome(home, async () => {
  await withEnv({ GLMP_AUTOCLAW2: "1" }, async () => {
    const config = loadConfig({ format: "openai" });
    const { log } = captureLog();
    const out = inspectUpstreamRequest(config, stBody(), "zaicoding_glm-5.3", { log });
    const body = out.body;

    check("st: presence_penalty is forwarded", body.presence_penalty === 0, String(body.presence_penalty));
    check("st: frequency_penalty is forwarded", body.frequency_penalty === 0, String(body.frequency_penalty));
    check("st: reasoning_effort is forwarded", body.reasoning_effort === "high", String(body.reasoning_effort));
    check("st: enable_thinking is forwarded", body.enable_thinking === true, String(body.enable_thinking));
    check("st: clear_thinking is forwarded", body.clear_thinking === false, String(body.clear_thinking));
    check("st: temperature is forwarded", body.temperature === 0, String(body.temperature));
    check("st: top_p is forwarded", body.top_p === 1, String(body.top_p));

    // The app's own quartet, derived from what the client said. The app never
    // sends one of these fields alone.
    check("st: the app's reasoning quartet is on the wire",
      body.thinking?.type === "enabled" && body.enable_thinking === true
        && body.reasoning_effort === "high" && body.reasoning?.effort === "high",
      JSON.stringify({ t: body.thinking, e: body.enable_thinking, r: body.reasoning_effort, o: body.reasoning }));

    // An explicit "no thinking" wins over a leftover effort value.
    const off = inspectUpstreamRequest(config, stBody({ enable_thinking: false }), "zaicoding_glm-5.3", { log });
    check("st: enable_thinking=false wins over the effort value",
      off.body.thinking?.type === "disabled" && off.body.enable_thinking === false
        && off.body.reasoning_effort === "none" && off.body.reasoning?.effort === "none",
      JSON.stringify({ t: off.body.thinking, r: off.body.reasoning_effort }));

    // GLMP_REASONING_SHAPE=off forwards the client's fields and derives nothing.
    const raw = { ...stBody(), thinking: { type: "enabled" } };
    delete raw.reasoning_effort;
    const offShape = inspectUpstreamRequest(config, raw, "zaicoding_glm-5.3", { log });
    check("st: the quartet is derived even when the client sent only enable_thinking",
      offShape.body.reasoning_effort === "high" && offShape.body.reasoning?.effort === "high",
      JSON.stringify({ r: offShape.body.reasoning_effort, o: offShape.body.reasoning }));

    // The output limit: the 2.x upstream answers a bare 406 to a client
    // specified max_tokens, but accepts max_completion_tokens (measured
    // 2026-10-29, HTTP 200). So the limit is renamed, not dropped.
    check("st: the client's output limit survives as max_completion_tokens",
      body.max_completion_tokens === 60000, String(body.max_completion_tokens));
    check("st: the 2.x upstream never sees a max_tokens field",
      body.max_tokens === undefined, String(body.max_tokens));

    // A limit over the model's real cap is clamped, never passed through.
    const over = inspectUpstreamRequest(config, stBody({ max_tokens: 999999 }), "zaicoding_glm-5.3", { log });
    check("st: an over-cap limit is clamped to the model's real cap",
      over.body.max_completion_tokens === 131072, String(over.body.max_completion_tokens));

    // The body the upstream sees carries the bare model id.
    check("st: the upstream model id is the bare one",
      body.model === "glm-5.3", String(body.model));
  });
});

// ---- 2. the omit mode restores upstream's behaviour ------------------------

await withHome(makeHome(), async () => {
  await withEnv({ GLMP_AUTOCLAW2: "1", GLMP_MAX_TOKENS_MODE: "omit" }, async () => {
    const config = loadConfig({ format: "openai" });
    const { log } = captureLog();
    const out = inspectUpstreamRequest(config, stBody(), "zaicoding_glm-5.3", { log });
    check("st: GLMP_MAX_TOKENS_MODE=omit sends no output limit at all",
      out.body.max_completion_tokens === undefined && out.body.max_tokens === undefined,
      JSON.stringify({ max: out.body.max_tokens, completion: out.body.max_completion_tokens }));
  });
});

// ---- 3. the forward list is operator-configurable --------------------------

await withHome(makeHome(), async () => {
  await withEnv({ GLMP_AUTOCLAW2: "1", GLMP_FORWARD_PARAMS: "presence_penalty" }, async () => {
    const config = loadConfig({ format: "openai" });
    const { log } = captureLog();
    const out = inspectUpstreamRequest(config, stBody(), "zaicoding_glm-5.3", { log });
    check("st: GLMP_FORWARD_PARAMS narrows what is copied verbatim",
      out.body.presence_penalty === 0 && out.body.frequency_penalty === undefined,
      JSON.stringify({ p: out.body.presence_penalty, f: out.body.frequency_penalty }));
    check("st: the derived quartet is its own knob, not the forward list's",
      out.body.reasoning_effort === "high" && out.body.reasoning?.effort === "high",
      JSON.stringify({ r: out.body.reasoning_effort, o: out.body.reasoning }));
  });

  await withEnv({ GLMP_AUTOCLAW2: "1", GLMP_REASONING_SHAPE: "off" }, async () => {
    const config = loadConfig({ format: "openai" });
    const { log } = captureLog();
    const out = inspectUpstreamRequest(config, stBody(), "zaicoding_glm-5.3", { log });
    check("st: GLMP_REASONING_SHAPE=off derives nothing",
      out.body.reasoning === undefined && out.body.thinking === undefined
        && out.body.reasoning_effort === "high" && out.body.enable_thinking === true,
      JSON.stringify({ r: out.body.reasoning_effort, o: out.body.reasoning, t: out.body.thinking }));
  });
});

// ---- 4. the banner is a system message of its own --------------------------

await withHome(makeHome(), async () => {
  await withEnv({ GLMP_AUTOCLAW2: "1" }, async () => {
    const config = loadConfig({ format: "openai" });
    const { log } = captureLog();
    const layer = getShapeLayer(config, log);
    check("st: the fork's default banner mode is separate",
      layer.bannerMode === BANNER_MODE_SEPARATE, layer.bannerMode);

    const persona = "You are Aria, a cheerful guide to the city.";
    const out = layer.apply([{ role: "system", content: persona }, { role: "user", content: "hello" }], []);

    check("st: the banner is the first message and it is a system message",
      out.messages[0].role === "system" && out.messages[0].content === PINNED_BANNER_2X,
      JSON.stringify(out.messages[0]).slice(0, 120));
    check("st: the client's persona is untouched",
      out.messages[1].role === "system" && out.messages[1].content === persona,
      JSON.stringify(out.messages[1]).slice(0, 160));
    check("st: the client's message order is preserved",
      out.messages[2].role === "user" && out.messages[2].content === "hello",
      JSON.stringify(out.messages[2]));
    check("st: the persona is not merged with the banner",
      !String(out.messages[1].content).includes(PINNED_BANNER_2X),
      String(out.messages[1].content).slice(0, 120));
  });
});

// ---- 5. merge mode is still available (upstream's shape) --------------------

await withHome(makeHome(), async () => {
  await withEnv({ GLMP_AUTOCLAW2: "1", GLMP_BANNER_MODE: "merge" }, async () => {
    const config = loadConfig({ format: "openai" });
    const { log } = captureLog();
    const layer = getShapeLayer(config, log);
    check("st: GLMP_BANNER_MODE=merge selects the folded banner",
      layer.bannerMode === BANNER_MODE_MERGE, layer.bannerMode);

    const persona = "You are Aria, a cheerful guide to the city.";
    const out = layer.apply([{ role: "system", content: persona }, { role: "user", content: "hello" }], []);
    check("st: merge mode folds the banner into the first system message",
      out.messages[0].role === "system" && out.messages[0].content.includes(PINNED_BANNER_2X)
        && out.messages[0].content.includes(persona),
      String(out.messages[0].content).slice(0, 160));
    check("st: merge mode adds no message of its own",
      out.messages.length === 2, String(out.messages.length));
  });
});

// ---- 6. the identity guard still reaches the client's persona ---------------

await withHome(makeHome(), async () => {
  await withEnv({ GLMP_AUTOCLAW2: "1" }, async () => {
    const config = loadConfig({ format: "openai" });
    const { log } = captureLog();
    const layer = getShapeLayer(config, log);
    const claudeCode = "You are Claude Code, an interactive CLI tool that helps users with software engineering tasks.";
    const out = layer.apply([{ role: "system", content: claudeCode }, { role: "user", content: "hello" }], []);

    const persona = String(out.messages[1]?.content ?? "");
    check("st: the guard still neutralises a coding-harness signature in the persona",
      !persona.toLowerCase().includes("you are claude code"), persona.slice(0, 120));
    check("st: the guard's hit is reported", out.neutralizedIdentities.length > 0,
      JSON.stringify(out.neutralizedIdentities));
    check("st: the guard does not touch the banner message",
      out.messages[0].content === PINNED_BANNER_2X, JSON.stringify(out.messages[0]).slice(0, 120));
  });
});

// ---- 7. the quarantine still works, and does not double the banner ---------

await withHome(makeHome(), async () => {
  await withEnv({ GLMP_AUTOCLAW2: "1" }, async () => {
    const config = loadConfig({ format: "openai" });
    const { log } = captureLog();
    const layer = getShapeLayer(config, log);
    const pi = "You are Pi, a personal AI assistant. Be brief and helpful.";
    const out = layer.apply(
      [{ role: "system", content: pi }, { role: "user", content: "hello" }], [], { quarantine: true });

    const systemCount = out.messages.filter((m) => m.role === "system").length;
    check("st: quarantine leaves exactly one system message", systemCount === 1, String(systemCount));
    check("st: that system message is the banner alone",
      out.messages[0].content === PINNED_BANNER_2X, JSON.stringify(out.messages[0].content).slice(0, 120));
    check("st: the harness text is grafted into the first user message",
      out.messages[1].role === "user" && out.messages[1].content.includes(pi),
      String(out.messages[1].content).slice(0, 160));
    check("st: the quarantine is reported", out.quarantined === true, String(out.quarantined));
  });
});

// ---- 8. dry run: the outgoing request is visible, the cloud is not ----------

const dumpFile = path.join(makeHome(), "dryrun.json");
const port = PEN_TEST_PORTS.st || 19920;

// The shared startProxy helper waits a fixed budget for the server to come up,
// and on a loaded machine (the whole offline suite has just been running) that
// budget can expire before the child is even listening. A flaky start must not
// read as a failed feature, so the spawn is retried once and, if it still
// fails, the reason is reported instead of the suite dying on a stack trace.
let proc = null;
let res = null;
let spawnError = null;
for (let attempt = 0; attempt < 2 && !res; attempt++) {
  try {
    proc = await startProxy(port, {
      GLMP_DRY_RUN: "1",
      GLMP_DRY_RUN_FILE: dumpFile,
      GLMP_AUTOCLAW2: "1",
    });
    res = await post(port, { body: stBody() });
  } catch (err) {
    spawnError = err;
    await stopProxy(proc);
    proc = null;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

try {
  const why = spawnError ? `the proxy did not start: ${spawnError.message}` : String(res?.status);
  check("st: dry run answers the client with 200", res?.status === 200, why);
  check("st: dry run says so in the answer", /dry-run/.test(res?.body || ""), String(res?.body).slice(0, 160));

  const written = fs.existsSync(dumpFile);
  check("st: dry run wrote the request to the dump file", written, dumpFile);

  if (written) {
    const raw = fs.readFileSync(dumpFile, "utf8");
    // The dump is a pretty-printed JSON ARRAY so an editor expands it as a
    // tree - one long JSON line per request (the old JSONL layout) is exactly
    // what the user complained about.
    let entries = null;
    try { entries = JSON.parse(raw); } catch (_) { /* reported below */ }
    check("st: the dump file is a JSON array", Array.isArray(entries), raw.slice(0, 120));
    check("st: the dump file is pretty-printed, not one long line",
      raw.split("\n").length > 4, String(raw.split("\n").length));

    const list = Array.isArray(entries) ? entries : [];
    const rec = list[list.length - 1] || {};
    const up = rec.upstreamBody || {};

    check("st: the dump holds exactly the captured request", list.length === 1, String(list.length));
    check("st: the dump carries the upstream body", !!up && !!up.messages, JSON.stringify(Object.keys(rec)));
    check("st: the dumped body has the banner as its own system message",
      up.messages?.[0]?.content === PINNED_BANNER_2X, JSON.stringify(up.messages?.[0]).slice(0, 120));
    check("st: the dumped body keeps the persona intact",
      up.messages?.[1]?.content === "You are Aria, a cheerful guide to the city.",
      JSON.stringify(up.messages?.[1]).slice(0, 160));
    check("st: the dumped body carries the forwarded parameters",
      up.presence_penalty === 0 && up.reasoning_effort === "high" && up.enable_thinking === true,
      JSON.stringify({ p: up.presence_penalty, r: up.reasoning_effort, t: up.enable_thinking }));
    check("st: the dumped body carries the output limit",
      up.max_completion_tokens === 60000, String(up.max_completion_tokens));
    check("st: the dump holds the client body as it arrived",
      rec.clientBody?.reasoning_effort === "high", JSON.stringify(rec.clientBody?.reasoning_effort));
    check("st: the dump holds the upstream headers",
      rec.upstreamHeaders?.["X-Request-Model"] === "zaicoding_glm-5.3",
      JSON.stringify(rec.upstreamHeaders?.["X-Request-Model"]));
    check("st: the dump never contains a credential",
      !JSON.stringify(rec).includes("eyJ") && /REDACTED/.test(rec.upstreamHeaders?.["X-Authorization"] || ""),
      String(rec.upstreamHeaders?.["X-Authorization"]));
    check("st: the dump carries the client body only, no token", !("token" in (rec.clientBody || {})));
  }
} finally {
  await stopProxy(proc);
}

// ---- 8b. the dump file itself: JSON array, legacy carry-over, a ceiling ----

await withHome(makeHome(), async () => {
  const dir = makeHome();
  const target = path.join(dir, "proxy_dryrun.json");
  const legacy = path.join(dir, "proxy_dryrun.jsonl");

  // A legacy JSONL dump sitting next to the target must survive the switch -
  // the operator's captured history is not worth losing over a file format.
  fs.writeFileSync(legacy, JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", model: "legacy-model" }) + "\n", "utf8");

  const cfg = { DRY_RUN_FILE: target, DRY_RUN_MAX_ENTRIES: 3 };
  const written = writeDryRunRecord(cfg, { model: "m1", clientBody: { a: 1 } });
  check("st: dry run reports the file it wrote", written === target, String(written));

  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(target, "utf8")); } catch (_) { /* reported below */ }
  check("st: the dump is a JSON array", Array.isArray(entries), String(typeof entries));
  check("st: the legacy dump was carried over", entries.some((e) => e.model === "legacy-model"),
    JSON.stringify(entries.map((e) => e.model)));
  check("st: the carried-over entry kept its own fields", entries.some((e) => e.ts === "2026-01-01T00:00:00.000Z"),
    JSON.stringify(entries.map((e) => e.ts)));

  // The ceiling: the file is rewritten in full on every capture, so it needs a
  // limit - the oldest captures are the ones that go.
  for (let i = 0; i < 4; i++) writeDryRunRecord(cfg, { model: `m${i + 2}` });
  entries = JSON.parse(fs.readFileSync(target, "utf8"));
  check("st: the dump keeps at most DRY_RUN_MAX_ENTRIES entries", entries.length === 3, String(entries.length));
  check("st: the dump keeps the newest entries", entries[entries.length - 1]?.model === "m5",
    JSON.stringify(entries.map((e) => e.model)));

  // A corrupt file must not eat the request: the capture still lands.
  fs.writeFileSync(target, "{not json at all", "utf8");
  writeDryRunRecord(cfg, { model: "m6" });
  entries = JSON.parse(fs.readFileSync(target, "utf8"));
  check("st: a corrupt dump file is replaced, not fatal", entries.some((e) => e.model === "m6"),
    JSON.stringify(entries.map((e) => e.model)));
});

// ---- 9. the client version comes from the installed app --------------------

await withHome(makeHome(), async () => {
  // A fixture "installed app": the same package.json the real app ships, in
  // the same place the proxy looks.
  const appDir = path.join(makeHome(), "AutoClaw2");
  fs.mkdirSync(path.join(appDir, "resources", "app"), { recursive: true });
  const pkg = path.join(appDir, "resources", "app", "package.json");
  fs.writeFileSync(pkg, JSON.stringify({ name: "zwork", version: "9.9.9" }), "utf8");

  await withEnv({ GLMP_AUTOCLAW2: "1", GLMP_APP_PACKAGE: pkg }, async () => {
    const config = loadConfig({ format: "openai" });
    check("st: the installed app's version is discovered",
      config.APP_VERSION === "9.9.9", String(config.APP_VERSION));

    const cap = captureLog();
    const identity = createIdentityLayer(config, cap.log).getIdentity();
    check("st: the identity layer reports the installed app as its source",
      identity.source === "installed-app", identity.source);
    check("st: the identity layer carries the installed app's version",
      identity.headers["X-Version"] === "9.9.9", String(identity.headers["X-Version"]));
    check("st: a discovered version is not announced as a stale client",
      !cap.warns.some((w) => /running on pinned identity/.test(w)), cap.warns.join(" | "));

    const out = inspectUpstreamRequest(config, stBody(), "zaicoding_glm-5.3", { log: captureLog().log });
    check("st: the dry-run dump carries the installed app's version",
      out.headers["X-Version"] === "9.9.9", String(out.headers["X-Version"]));
  });

  await withEnv({ GLMP_AUTOCLAW2: "1", GLMP_APP_PACKAGE: path.join(makeHome(), "nope", "package.json") }, async () => {
    const config = loadConfig({ format: "openai" });
    check("st: with no app to ask, the version stays pinned",
      config.APP_VERSION === null, String(config.APP_VERSION));
  });
});

summary();
