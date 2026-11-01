# GLM Proxy for AutoClaw — SillyTavern profile

A local proxy that exposes AutoClaw's GLM and DeepSeek models as an
OpenAI-compatible API, so SillyTavern — and anything else that speaks the same
dialect — can talk to them.

This is a fork of [upstream's GLM Proxy](https://github.com/eequaled/GLMproxy).
Upstream keeps working exactly as before; this fork adds a profile tuned for
roleplay clients.

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js >=18">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License MIT">
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey" alt="Platform">
  <img src="https://github.com/kolobanaga/GLMproxyForSillyTavern/actions/workflows/ci.yml/badge.svg" alt="CI">
</p>

**What this fork adds**

- your parameters survive the proxy (upstream dropped them silently);
- the reasoning switches go on the wire in the app's own shape, not in a shape the
  upstream is free to ignore;
- the vendor banner rides as a system message **of its own**, so your persona
  reaches the model byte-for-byte as you wrote it;
- the identity headers are the installed app's own — no more announcing a
  version the app moved past;
- a **dry-run mode**: see exactly what would go on the wire without spending a
  credit.

> **The full upstream documentation lives in [README.upstream.md](README.upstream.md)** —
> integrations with Claude Code, Cursor, OpenCode and the SDKs, the per-OS model
> tables, `/healthz` and `/v1/models`, the error taxonomy, account safety and
> throttle retries. This page covers the SillyTavern profile only.

---

## Requirements

- **Windows.** This profile is developed and tested on Windows; upstream also
  runs on macOS and Linux — see [README.upstream.md](README.upstream.md).
- **AutoClaw** installed, running and logged in. The proxy takes the
  authentication from the app itself (AutoClaw 2.x stores an encrypted vault,
  which the proxy decrypts locally via DPAPI) — no token copying, no API key
  juggling.
- **Node.js 18 or newer.**

## Quick start

1. Download or clone this repository.
2. **Double-click `start.bat`.** A window opens with the proxy running on
   `http://127.0.0.1:18791/v1`. Close the window to stop it.
3. In SillyTavern, add the connection (see below) and pick a model.

From a terminal instead:

```powershell
node openai.js
```

The proxy needs the AutoClaw app to be running and logged in — it takes the
token from the app, so there is nothing to copy. Without a token the proxy
stays up but every request comes back as `503` with
`Cannot read AutoClaw token … Make sure AutoClaw is running and you are logged
in.`

## The .bat scripts

| File | What it does |
|---|---|
| `start.bat` | Normal run. The proxy serves requests to the cloud. |
| `start-dryrun.bat` | Dry run: every request is captured to `proxy_dryrun.json` and answered locally. Nothing reaches the cloud, no credit is spent, no budget slot is used. |
| `start-merge.bat` | Upstream's folded banner: the vendor banner is merged into your first system message instead of riding as a message of its own. |

## SillyTavern settings

| Field | Value |
|---|---|
| API type | Chat Completion |
| URL | `http://127.0.0.1:18791/v1` |
| API key | `mewmew` (or whatever `PROXY_KEY` is set to) |
| Model | `zaicoding_glm-5.3`, `zai_glm-5.3-flash`, `zai_auto`, … |

Model ids are served live from AutoClaw's own catalog — whatever the app
offers, `/v1/models` lists. The Windows catalog usually contains
`zaicoding_glm-5.3`, `zai_glm-5.3-flash`, `zai_glm-5-turbo`, `zai_auto`,
`zai_auto-fast` and the DeepSeek entries `tdpsk_deepseek-v4-flash-202605` /
`tdpsk_deepseek-v4-pro-202606`.

> **The model in the answer is not always the model you asked for.**
> `zai_auto` is an alias: the upstream picks the model it wants to serve, and a
> request for `zai_auto` can come back as
> `deepseek/deepseek-v4-flash-vision-exp` — served (and billed) by DeepSeek
> rather than by a GLM model. When the credit tier matters, ask for a concrete
> id (`zaicoding_glm-5.3`, `zai_glm-5.3-flash`).

## How it works

```
Your client          GLM Proxy                    AutoClaw Backend
(OpenAI API)  ───▶ 127.0.0.1:18791  ────────────▶  autoglm-api.autoglm.ai
                   127.0.0.1:18792 (Anthropic)        (cloud)
                         │
                         └── auth is taken from the local AutoClaw vault
```

## What this fork changes

1. **The client's body parameters survive.** A ST sends
   `presence_penalty`, `frequency_penalty`, `reasoning_effort`,
   `enable_thinking` and `clear_thinking` on every turn. Upstream dropped them
   silently — the request still returned 200. They are forwarded now. (The three reasoning fields are
   then rewritten into the app's quartet — see item 2.)
2. **The reasoning switches go on the wire in the app's own shape.** The
   installed app does not send one reasoning field — it sends a quartet:

   ```json
   { "thinking": { "type": "enabled" },
     "enable_thinking": true,
     "reasoning_effort": "high",
     "reasoning": { "effort": "high" } }
   ```

   A client that sends only the flat fields makes a request the app would never
   make, and the upstream is free to honour the half it recognises. The proxy
   derives the quartet from whatever the client said.
3. **The output limit is forwarded, but the upstream does not enforce it.** The
   2.x upstream answers a bare 406 to a client-specified `max_tokens`, but
   accepts `max_completion_tokens` — which is also the field the app itself
   sends. So the limit is renamed rather than dropped, and clamped to the
   model's real cap (asking for more than the cap makes the cloud serve a
   different model and bill that model's credits). Measured 2026-11-01: the
   upstream ignores it either way — a request for 100 tokens and one for 20000
   both answered in ~350 tokens. The rename is a 2.x rule: on the 1.x upstream
   the limit travels as `max_tokens`, as it always did.
4. **The banner is a system message of its own.** The vendor banner is no
   longer folded into the client's first system message, so a persona reaches
   the model byte-for-byte as the user wrote it. The identity guard and the
   system quarantine are unchanged and still active.
5. **The identity headers are the installed app's own** (on AutoClaw 2.x).
   `X-Version` is read from the app's own `package.json` instead of the pinned
   `2.0.3`, `X-Lang` follows `GLMP_X_LANG` (default `en`, the overseas build's
   own value), and the app's `X-Query-Id` is sent too. The 2.x runtime snapshot
   carries no `X-*` headers at all, so before this the wire carried a version
   the installed app had moved past — and the proxy warned about a "stale
   client" that was not the one on the wire. The 1.x branch is untouched: it
   keeps `X-Version: 1.18.5` and `X-Lang: en`.
6. **A dry-run mode** — see below.

## Environment variables

Everything has a default; set only what you need.

| Variable | Default | What it does |
|---|---|---|
| `GLMP_BANNER_MODE` | `separate` | `separate` = the banner is its own system message; `merge` = upstream's folded banner |
| `GLMP_MAX_TOKENS_MODE` | `completion` | `completion` = the client's limit is sent as `max_completion_tokens` (on the 2.x upstream); `omit` = upstream's behaviour (no limit sent at all on 2.x — on 1.x the limit is always sent as `max_tokens`) |
| `GLMP_FORWARD_PARAMS` | `presence_penalty,frequency_penalty,reasoning_effort,enable_thinking,clear_thinking,thinking` | which client body parameters are copied verbatim (in `app` reasoning shape the quartet wins over `reasoning_effort` / `enable_thinking` / `thinking`) |
| `GLMP_REASONING_SHAPE` | `app` | `app` = derive the app's reasoning quartet from the client's fields; `off` = nothing derived |
| `GLMP_X_LANG` | `en` | the value sent in `X-Lang` (the app sends its UI language — set `zh-CN` for the domestic build) |
| `GLMP_IDENTITY_VERSION` | discovered (fallback `1.18.5`) | overrides `X-Version` outright |
| `GLMP_APP_PACKAGE` | — | path to the installed app's `package.json`; an override that replaces the platform roots (point it at nothing to exercise the pinned rung) |
| `AUTOCLAW_INSTALL_DIR` | — | an extra root searched for the installed app's `package.json` (in addition to `%LOCALAPPDATA%\Programs\AutoClaw2`, `…\AutoClaw`, `/Applications/AutoClaw.app`, `/opt/AutoClaw`, …) |
| `GLMP_DRY_RUN` | off | `1` = build the upstream request, write it to the dump file, answer the client locally, never touch the network (OpenAI proxy only — the Anthropic entry point has no dry run) |
| `GLMP_DRY_RUN_FILE` | `./proxy_dryrun.json` | where the dry run writes the captured requests (a pretty-printed JSON array) |
| `GLMP_DRY_RUN_MAX_ENTRIES` | `100` | how many captured requests the dump file keeps (the oldest are dropped) |
| `GLMP_DRY_RUN_VERBOSE` | off | `1` = also print the captured upstream body to the log |

Upstream's own knobs (`PROXY_KEY`, `PORT`, `LOG_LEVEL`, `JSONL_LOG`,
`BUDGET_REQUESTS_PER_HOUR`, …) keep working — see
[README.upstream.md](README.upstream.md).

## Dry run — look at the request without spending a credit

Double-click `start-dryrun.bat` (or set `GLMP_DRY_RUN=1` and run
`node openai.js`). The client keeps talking, the proxy answers locally, and
nothing reaches the cloud.

Each request is captured to `proxy_dryrun.json`: the client body, the exact
upstream body, and the upstream headers with the per-request secrets replaced
by markers (`<REDACTED: per-request JWT>`). The file is a pretty-printed JSON
**array**, so an editor expands it as a tree instead of showing one long line
per request. It is rewritten in full on every capture and keeps the last
`GLMP_DRY_RUN_MAX_ENTRIES` requests; a legacy `proxy_dryrun.jsonl` next to it
is carried over on the first capture. The shape of one entry (abridged — the
bodies carry the whole conversation):

```json
[
  {
    "ts": "...",
    "model": "zaicoding_glm-5.3",
    "stream": false,
    "clientBody": {},
    "upstreamBody": {
      "model": "glm-5.3",
      "messages": [],
      "max_completion_tokens": 60000,
      "presence_penalty": 0,
      "reasoning_effort": "high"
    },
    "upstreamHeaders": {
      "X-Request-Model": "zaicoding_glm-5.3",
      "X-Authorization": "<REDACTED: per-request JWT>"
    },
    "limit": "max_tokens 60000 -> max_completion_tokens 60000",
    "bannerMode": "separate",
    "forwardedParams": ["presence_penalty", "frequency_penalty"]
  }
]
```

## Logs

| File | What it holds |
|---|---|
| `proxy_requests.json` | The last 50 requests with their terminal outcome (status, model, error class). Rewritten in place, no time limit — older entries fall off as new ones arrive. |
| `proxy_requests.jsonl` | One JSON line per request. Only written when `JSONL_LOG=true` or `LOG_LEVEL=debug`; rotates past 10 MB. |
| `proxy_dryrun.json` | The dry-run dump (see above). |

These files live in the folder the proxy was started from. Override the paths
with `REQUEST_LOG_FILE` and `JSONL_FILE`.

## Antivirus false positives

Heuristic engines may flag this proxy. It is a false positive:
the shape of what it does matches a credential stealer — a script that reads a
local encrypted credential store (AutoClaw's vault, via DPAPI), computes a
request signature, and opens a TLS connection to a host that is not a package
registry. The code is upstream's MIT-licensed project plus this fork's patch,
and it can be checked at any time (`1441d6c` is the upstream commit this fork
starts from):

```bash
git diff --stat 1441d6c              # this fork's patch, file by file
git show 1441d6c:openai.js           # the upstream blob, byte-for-byte
git status --porcelain               # only this fork's changed files
```

Excluding the **folder** from the scanner is the right fix. Excluding
`node.exe` globally would blind the antivirus for every script on the machine.

## Tests

```powershell
npm run test:offline
```

The offline suites never touch the network and never spend a credit. The
SillyTavern profile has its own suite: `tests/st-profile.mjs`.

`npm test` (the full suite) additionally runs the **live** pen-tests and the
catalog refresh — those really talk to the cloud and spend a credit each.

## Upstream documentation

Everything that is not specific to this fork lives in
**[README.upstream.md](README.upstream.md)** — the upstream README, kept
verbatim:

- Claude Code CLI and the Anthropic Messages API;
- OpenCode, Cursor, Continue, and anything else OpenAI-compatible;
- Python and JavaScript SDK examples;
- the model catalog per OS and AutoClaw version;
- the in-flight queue for subagents and parallel turns;
- `/healthz`, `/v1/models`, `/v1/chat/completions`, `/v1/messages`;
- the error taxonomy, throttle retries and account safety
  (also [BAN-RISK-AND-LIMITS.md](BAN-RISK-AND-LIMITS.md)).

> **A ban is not a throttle, and this proxy cannot undo one.** `403` + `410004`
> is a real, permanent ban. Details: [error handling](README.upstream.md#error-handling) ·
> [ban risk](BAN-RISK-AND-LIMITS.md)

## License

MIT — see [LICENSE](LICENSE). Upstream copyright (c) 2026 eequaled is preserved;
this fork adds the SillyTavern profile on top.
