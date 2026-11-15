# Kiro prompt pack: Prevenza: Scam Guard

How to use this file
1. Open the `prevenza` folder in Kiro. The steering file `.kiro/steering/prevenza-rules.md` is loaded automatically, so you do not need to repeat the rules in every prompt.
2. Paste ONE step prompt at a time. Wait until tests pass and you have read the summary before starting the next step.
3. After each step, run `npm test` and `npm run test:e2e`, load the extension from `chrome://extensions`, and try it by hand.
4. If Kiro asks to add a permission, a network call or a library, stop and decide on purpose. The defaults protect your users.

Important: some of your ideas need the internet (domain age and reputation, an LLM, community data). Step 1 promises "nothing leaves the device". Each networked feature below is therefore OFF by default, asks for consent, sends the minimum, and is written up in the README. Decide in Step 8 whether you want any of them at all. A fully offline product is a legitimate and stronger privacy story.

Suggested order and time (about 19 days left on 15 Nov):
Step 2 URL checks (2 days) -> Step 3 risk score and explanation (1-2) -> Step 4 payment page warning and UPI analyzer (2-3) -> Step 5 message checker (2-3) -> Step 6 Prevy intervention and emergency button (2) -> Step 7 elder mode and languages (2) -> Step 8 optional network features (1-2, can skip) -> Step 9 screenshot OCR (3, can skip) -> Step 10 evaluation, polish, video (3).

---

## Step 1 (done): Foundation
Already built and tested in this folder. If you want Kiro to rebuild or review it, use:

> Review the Step 1 foundation against `.kiro/specs/step-1-foundation/requirements.md`. Do not add features. Run `npm test` and `npm run test:e2e`, report the exact results, and list anything that violates `.kiro/steering/prevenza-rules.md`.

---

## Step 2: Smart URL intelligence (offline, rule-based) - DONE (see .kiro/specs/step-2-url-intelligence)

> Goal: add an offline URL analyzer. No scam scoring UI yet beyond a debug view.
>
> Create `src/shared/url-analyzer.js` (pure functions, works in Node and the browser) exporting `analyzeUrl(urlString)` that returns `{ signals: [{id, weight, label, why}] }`. Signals to implement:
> - IP address host, userinfo trick (`https://bank.com@evil.com`), very long hostnames, many subdomains
> - punycode / mixed-script lookalike characters
> - suspicious TLDs (a small configurable list), URL shorteners (a small list)
> - brand impersonation: a famous brand name inside a hostname that is not that brand's real domain (start with 15 Indian banks, UPI apps, government portals, and 10 global brands; keep the data in `src/shared/data/brands.js`)
> - HTTP (not HTTPS) on a page that looks like login or payment, judged from the URL path words only
> Each signal needs a plain-language `why` that a 70-year-old can understand.
>
> Constraints: do not fetch anything. Do not use WHOIS or domain-age lookups (that needs the network and is planned as an optional feature in Step 8). The content script may read `location.href` hostname and path only, never the page body or form fields. If you need to read more of `location`, update the security test in the same change and explain why.
>
> Tests: unit tests with at least 40 URLs (20 malicious-looking, 20 normal including real bank and UPI domains, subdomains like `retail.onlinesbi.sbi`, and tricky legitimate ones). Include a fast-check property test that the analyzer never throws and never takes more than 20 ms on random strings. Report the real numbers. Do not tune on the test list; keep a separate frozen list in `test/data/url-holdout.json`.
>
> Deliverables: code, tests, README update, and a list of files changed.

---

## Step 3: Scam risk score and explanation

> Goal: combine signals into one risk score with a clear explanation, and show it in the popup, dashboard and content script.
>
> Create `src/shared/risk-engine.js` with `scoreSignals(signals, sensitivity)` returning `{ score: 0-100, level: "safe"|"caution"|"danger"|"unknown", reasons: [top 3 plain-language reasons], confidence }`. Level thresholds depend on the existing `sensitivity` setting (relaxed/balanced/strict). Negative signals (a known real domain, HTTPS with a clean host) reduce the score. A single weak signal must never reach "danger".
>
> UI: in the popup, replace the static "Not scanned yet" pill with the real level (label plus shape, never colour alone) and a "Why?" section listing the reasons. The dashboard counts warnings. The content script shows Prevy only when level is "danger" (and "caution" only if sensitivity is strict). It must respect quiet sites, the protection switch and elder mode, and never show more than 3 banners per 10 minutes.
>
> Messaging: add new message types to `constants.js` and the policy table in `handler.js`; the content script sends only the hostname and path to the worker (no page text). Update the security tests to match, narrowly.
>
> Tests: unit tests for the engine (including the "one weak signal" rule), e2e tests with a local page that has a lookalike URL and a normal one. Report results exactly.

---

## Step 4: Payment page warning and UPI payment analyzer

> Goal: warn before a risky payment, and analyse UPI payment links and QR text.
>
> Part A, UPI analyzer (`src/shared/upi-analyzer.js`): parse `upi://pay?pa=&pn=&am=&cu=&tn=&mc=` strings. Flag: payee name that does not match the VPA handle, prefilled amount the user did not choose, "collect request" patterns, QR text that asks the user to scan to RECEIVE money, mismatched or unknown VPA handles. Return signals in the same format as Step 2. Add a "Check a payment link" box in the dashboard where the user pastes text; no camera in this step.
>
> Part B, payment page pause: detect that a page is a payment/checkout page using only the URL path words and button labels (for example buttons whose text matches Pay, Transfer, Send). Do NOT read form values, card fields or amounts. When the risk level is "danger", intercept the click, show a calm confirmation card with Cancel, "Ask family" and "Continue anyway". "Continue anyway" must always work after a short wait.
>
> Constraints: no network, no new permissions. Never read what the user typed. Tests: unit tests for the UPI parser (20 valid and 20 hostile strings), an e2e test with a fake payment page that checks the pause appears on a danger URL, does not appear on a normal one, and that Continue works. Report results.

---

## Step 5: Scam message detection (multilingual, rule-based first)

> Goal: let the user paste or share a message and get a verdict and explanation.
>
> Create `src/shared/message-analyzer.js`: weighted rules for English, Hindi, Tamil and Hinglish: fake authority (police, CBI, bank), urgency, secrecy, OTP/PIN requests, "safe account", remote-access apps, fake KYC, parcel fees, prizes, job and investment lures. Handle negation, because "never share your OTP" from a real bank is a warning, not a scam; Hindi negation comes AFTER the phrase ("OTP kisi ko mat batana"), so check both sides. Reuse the scoring from Step 3 and give scam-type names plus a "what usually happens next" line.
>
> UI: a "Check a message" page reachable from the popup and dashboard. Nothing is stored.
>
> Evaluation rules (important): write a tuning set and a SEPARATE frozen holdout set of at least 40 messages each (half scams, half normal, including genuine bank alerts and advisories) before you write the rules. Never edit rules after looking at holdout results; if you do, say so and create a new holdout. Report recall and false alarms for both sets honestly, including the result on the very first run.
>
> Constraints: no LLM and no network in this step (see Step 8). Tests include fast-check properties: harmless text is always safe; negated warnings are never flagged; adding harmless text never lowers a scam's score.

---

## Step 6: Prevy emergency intervention and safety button

> Goal: when risk is "danger", Prevy steps in calmly; the user can always reach help.
>
> Build a Prevy intervention card (shadow DOM, original character): a clear headline, the top reasons, "What to do now", and three buttons: "Stop", "Ask family", "Report". The always-available Emergency button (in the popup and on the card) offers: call 1930 (India's cybercrime helpline), open cybercrime.gov.in, and copy an evidence summary (the matched reasons and time, never page text) to the clipboard. "Ask family" opens WhatsApp with a pre-written message to a number the user saved in Settings (stored locally).
>
> Add a short cooling-off wait before "Continue anyway" on danger pages, skipped in elder mode only if the user turns that on. Respect reduced motion. Add a spoken warning using the browser's own speech engine, in the interface language, with a clear message if the device has no voice for that language.
>
> Constraints: clipboard write only on a user click; no network; no new permissions beyond what is justified in writing (`clipboardWrite` may be needed, explain it). Tests: unit tests for the evidence text (it must contain no page text), e2e for the card and buttons.

---

## Step 7: Elderly protection mode and multilingual interface

> Goal: make the whole interface work for elders and in English, Hindi and Tamil.
>
> Add `src/shared/i18n.js` with the three languages and a fallback to English. Translate every user-visible string in the popup, settings, dashboard, Prevy card and emergency flow. Elder mode: larger text, fewer buttons, higher contrast, one reason instead of three, and read-aloud on by default. Add a test that every key exists in every language and that placeholders like `{n}` survive translation.
>
> Mark the Hindi and Tamil text in the file header as "needs native-speaker review". Do not machine-translate silently; keep the text plain and short.
>
> Tests: completeness test, e2e check that switching language changes the popup and the card, and that elder mode keeps all tap targets at least 44px.

---

## Step 8: Optional networked features (decide first, you can skip)

> Before coding anything here, write `docs/PRIVACY_DECISION.md` listing what each feature would send, to whom, and why. Then implement ONLY the ones I approve.
>
> Candidates, all OFF by default and behind a clear consent screen:
> 1. Domain age and reputation: query only the registrable hostname to a public RDAP service. Add the minimum `host_permissions`, update the CSP `connect-src` to that single origin, show a "this sends the site name to X" notice, cache results, and handle failure silently.
> 2. LLM message analysis: send only the message text the user pasted, only when they press a button, never automatically. Never send page content. Show exactly what will be sent before sending.
> 3. Community scam reports: a signed JSON blocklist that is downloaded, never uploaded. No accounts. Reports stay on the device unless the user exports them.
>
> Tests: assert that with consent off no request is made, that each request contains only the documented fields, and update the security tests to allow exactly the approved origins and nothing else. Update the README privacy section.

---

## Step 9: Payment screenshot reader (OCR) (optional)

> Goal: let the user drop in a screenshot (a fake payment receipt or scam chat) and check it on the device.
>
> Bundle an offline OCR engine (Tesseract.js WebAssembly with English and Hindi data) inside the extension; no CDN. The image never leaves the device and is not stored. Feed the extracted text into the Step 5 analyzer and show the verdict. Also flag screenshot-specific signs a rule can catch: "payment successful" text with a mismatched amount or name the user types in, and missing transaction ID.
>
> Be honest: OCR is weak on blurry or cropped images; show the extracted text so the user can see what was read, and say when confidence is low. Measure speed and size and report them. Tests with 10 sample images you generate; report accuracy honestly.

---

## Step 10: Evaluation, polish and submission

> 1. Evaluation: create a final frozen holdout of at least 60 messages and 40 URLs that no rule was tuned on. Run it once. Put the first-run numbers in the README with the caveat that the data is small and author-written.
> 2. Polish: run the e2e suite, fix layout issues at 360px, 768px and 1280px widths, check keyboard-only use and focus order, check colour contrast, and check `prefers-reduced-motion`.
> 3. Docs: update the README, the permissions table and the limitations (it cannot hear calls; rules can be evaded; small test data).
> 4. Packaging: add `npm run zip` that builds `prevenza.zip` containing only what the extension needs.
> 5. Write the hackathon text: problem, who it is for, what it does, how Kiro was used (specs, steering, hooks, agent), honest results and limits. Draft a 3-minute demo script.

---

## A reusable "review before merge" prompt

> Act as a security reviewer. Read `.kiro/steering/prevenza-rules.md`. Review the latest changes. List any violation of the privacy rules, any new permission, any new network access, any place that reads form values or page text, and any test that was weakened. Run `npm test` and `npm run test:e2e` and report the exact output. Do not fix anything; only report.
