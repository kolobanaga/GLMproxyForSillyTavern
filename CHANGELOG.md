# Changelog

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
