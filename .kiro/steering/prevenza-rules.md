# Prevenza: project rules for Kiro

These rules apply to every change. If a request conflicts with them, say so and ask before proceeding.

## Product
- Prevenza is a scam guard for ordinary people, including elders. Be calm, plain and respectful. Never scare or shame.
- Silent by default. A false alarm is worse than a miss. The assistant (Prevy) never appears unless the user asks, or a real warning is needed.
- Prevy is an original character. Never copy Microsoft's Clippy art, name or logo.
- "Continue anyway" must always be possible. Never trap the user.

## Privacy and security (non-negotiable)
- Permissions: only `storage` unless a step explicitly approves more, with the reason written in the PR/summary.
- Never read passwords, card numbers, OTPs, cookies, or what the user types. Never read form field values.
- Never transmit user data. The extension CSP has `connect-src 'none'`. Any step that needs the network (domain age, LLM, community feed) must be OFF by default, need explicit user consent, send the minimum (for example only a hostname), and update the CSP, manifest, README and tests in the same change.
- Store only settings and counters. Never store URLs, page text or message text.
- Use `chrome.storage.local`, never `sync`.
- No `eval`, no `innerHTML`, no inline scripts or styles, no remote code, no external URLs.
- Validate every message sender and payload in `src/background/handler.js`.

## Engineering
- Manifest V3. Plain JavaScript, no build step, no frameworks unless a step approves it.
- Shared logic goes in `src/shared/` as pure functions that also run in Node, so it can be unit tested.
- Every feature ships with unit tests, and a browser check in `e2e/run.js` if it changes what the user sees.
- Never weaken a security test to make it pass. If a test is wrong, explain why and fix the test's intent narrowly.
- Report test results exactly as printed. Do not claim accuracy numbers that were not measured.
- Accuracy claims need a held-out set that the rules were never tuned on.

## UI
- Dark navy and blue theme from `src/shared/theme.css`. Risk is never shown by colour alone: every level has a label and a shape.
- Respect `prefers-reduced-motion`. Keep tap targets at least 44px. Elder mode must keep working on every new screen.
