# Changelog

## 3.4.1 — GLM-5.4, and a request log that keeps your text off the disk

Two additions, both about what the proxy knows and what it writes down.

### Added

- **GLM-5.4 is a first-class model.** The vendor's id for it is
  `zai_glm-x-preview`; the proxy now treats it like the other GLM models: it is
  capped at the same verified 131072 output tokens (the vendor's catalog entry
  advertises 307200, which the proxy does not repeat), it is in the built-in
  fallback list so it survives a catalog outage, and the credit-tier heuristic
  knows it is a High-tier model — so the `claude-opus-*` / `claude-sonnet-*`
  aliases can route to it.
- **`GLMP_LOG_MESSAGES` keeps the conversation out of the log.** `0` = the
  request log (`proxy_requests.json`) keeps the shape of every entry (model,
  status, timing, message count) but does **not** write `last_message` — the
  text of your own last message. The `.bat` launchers in this fork set it to
  `0` by default; set it to `1` to get the message back. The startup banner
  says which way it is set, so a quiet log is never a mystery.

### Notes

- GLM-5.4 is multimodal: it takes image, video and file input (native vision,
  announced with the 23 Nov launch). AutoClaw's model catalog nevertheless still
  lists `zai_glm-x-preview` as `input: ["text"]`, so the desktop app reads image
  attachments through its separate AutoGLM Image Recognition service and hands
  the model a text description instead of the picture. The proxy passes image
  parts through untouched, so a client that attaches an image gets the model
  looking at it directly.
- The dry-run dump (`proxy_dryrun.json`) still holds the whole captured
  request, text included — that is what the mode is for. The flag governs the
  request ring log only.

## 3.4.0 — the SillyTavern profile

The first release of this fork. Upstream's GLM Proxy keeps working exactly as
before; this release adds a profile tuned for roleplay clients.

### Added

- **Client parameters survive the proxy.** `presence_penalty`,
  `frequency_penalty`, `reasoning_effort`, `enable_thinking` and
  `clear_thinking` are forwarded instead of being dropped silently.
- **The reasoning switches go on the wire in the app's own shape.** The
  installed AutoClaw app sends a quartet — `thinking.type`, `enable_thinking`,
  `reasoning_effort` and `reasoning.effort` — so the proxy derives the quartet
  from whatever the client said.
- **The output limit is forwarded** as `max_completion_tokens` on the 2.x
  upstream (the field the app itself sends) and clamped to the model's real
  cap. The upstream still does not enforce the limit.
- **The vendor banner rides as a system message of its own** (`separate`
  mode), so a persona reaches the model byte-for-byte as it was written.
  `GLMP_BANNER_MODE=merge` restores upstream's folded banner.
- **The identity headers are the installed app's own** on AutoClaw 2.x:
  `X-Version` is read from the app's own `package.json` instead of the pinned
  `2.0.3`, and the app's `X-Query-Id` is sent too.
- **A dry-run mode** (`GLMP_DRY_RUN=1`): every request is captured to
  `proxy_dryrun.json` and answered locally — nothing reaches the cloud and no
  credit is spent.
- **`start.bat`, `start-dryrun.bat` and `start-merge.bat`** for double-click
  starts on Windows.

### Notes

- The 1.x upstream branch is unchanged: it keeps `X-Version: 1.18.5`,
  `X-Lang: en`, and the output limit travels as `max_tokens`.
- `zai_auto` is an alias — the upstream picks the model to serve, and a request
  for `zai_auto` can come back served (and billed) by DeepSeek. Ask for a
  concrete id (`zaicoding_glm-5.3`) when the credit tier matters.
- This fork is distributed through GitHub Releases, not npm.
