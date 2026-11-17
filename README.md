# Prevenza: Scam Guard

A friendly, privacy-first Chrome extension that helps people pause before they pay a scammer.

**Status: Step 8 (Elder Mode, family-friendly protection).** On top of Steps 1 to 6 (foundation, URL intelligence, central risk engine, multilingual message checker, UPI payment analyzer, offline screenshot checker), Prevy now explains every result from the central risk engine in plain words, with safety steps, in English, Hindi or Tamil. Nothing is read from WhatsApp, SMS, banking sites or UPI apps, and nothing you check is stored.

### Elder Mode (Step 8)

Turn it on in **Settings > Assistant and accessibility**. It is stored as the existing `elderMode` setting in `chrome.storage.local`, so it survives closing the browser. No new data, no new permission, no network.

- **Look:** 22px text (normal mode is 16px), more spacing, buttons and lists at least 56px tall, stronger contrast (text 19.8:1, secondary text 15.6:1, measured in the browser test), heavier borders and focus rings.
- **Dashboard:** one column. "Ask someone you trust" and the four checkers come first. Statistics, the risk scale, the system check and the roadmap move to the bottom under "More tools and information". Nothing is removed.
- **Warnings:** the Step 7 card gets a plain panel: *What we found*, *Why this can be dangerous*, *What to do now* (one or two numbered steps) and an "Ask someone you trust" button. The level is always a word plus an icon, never colour alone. The Step 7 detail (signs, five safety steps) stays below in a section that is open by default and can be closed. A repeat of the same result shows the full panel again. Nothing is dismissed or approved by itself.
- **LOW and INCONCLUSIVE:** still small notes. They add one sentence ("check for yourself with the real bank or company", or "ask someone you trust"). Neither is ever called safe.
- **Levels:** LOW, MEDIUM, HIGH, CRITICAL and INCONCLUSIVE come from the central risk engine and its thresholds are unchanged.
- **Ask someone you trust:** information only (`src/shared/family-guide.js`). It lists how to check with someone safely. It has no input box, link or phone number, contacts nobody, and stores nothing. The panel exists in the page only while it is open.
- **Wording:** `src/shared/elder-text.js` holds the plain explanations (14 topics, chosen from the evidence the engine found) and the guide. `src/shared/holdy.js` adds `model.elder` only when Elder Mode is on.

### Languages (Step 8)

English, Hindi and Tamil are the interface languages (Settings > Language). What is translated: Prevy's warnings, the Elder Mode panel, the family guide, risk labels, and the main headings and buttons of the popup, dashboard and settings (`src/shared/i18n.js`). What is not: the explanations under each heading, the detailed reasons each checker gives, statistics, the system check, the roadmap, and messages such as "Could not save". The Hindi and Tamil text was written by the developer and **needs native-speaker review**. The roadmap still lists "Whole interface in Hindi and Tamil" as planned.

Hinglish is supported only for **checking messages** (the language list in the message checker). It is not an interface language. Changing the interface language does not change how messages are analysed (tested: same warning level).
### How Prevy decides what to say (Step 7)

- `src/shared/holdy.js` turns a risk-engine result into Prevy's message. It never scores: LOW gives a small note, MEDIUM a caution card, HIGH a warning card, CRITICAL a "stop and check first" card, INCONCLUSIVE a "could not confidently check" note. No result means Prevy says nothing.
- Headlines and simple explanations are chosen from the evidence the engine found. A specific warning (OTP, website look-alike, safe account, fake receipt...) appears only when matching evidence exists.
- `src/shared/holdy-card.js` shows it on the dashboard and, briefly, in the popup (popup only for MEDIUM or higher). Dismissing leaves a note that the result is still at its level. Repeats of the same result show a short card. Both are remembered only in the page's memory, by a fingerprint of the result (level and rule ids), never by the content checked.
- `src/shared/holdy-text.js` holds Prevy's text. Hindi and Tamil cover Prevy's short messages only and need native-speaker review. The detailed reasons stay in English.

## Load it in Chrome

1. Open `chrome://extensions` in Chrome (version 110 or newer).
2. Turn on **Developer mode** (top-right switch).
3. Click **Load unpacked**.
4. Choose this folder (the one that contains `manifest.json`).
5. Pin the shield icon from the puzzle-piece menu. Click it to open the popup.

To see Prevy on a page: open **Settings** (from the popup) and turn on "Show Prevy on pages", or open any website and click "Say hi to Prevy" in the popup.

After you change code, click the circular reload arrow on the extension's card in `chrome://extensions`.

If Chrome shows an error on the card, click **Errors** to read it. Most problems are a missing file named in `manifest.json`; `npm test` checks for that.

## What is in the box

| Path | What it does |
|---|---|
| `manifest.json` | Manifest V3 definition: one permission (`storage`), content script on http(s) pages, strict CSP that blocks network access. |
| `src/background/service-worker.js` | The background worker. Registers listeners and connects the router to Chrome. |
| `src/background/handler.js` | The message router. Decides who may send what and returns replies. Pure logic, fully unit tested. |
| `src/content/content.js` | Runs on web pages. Reads only the site name. Shows Prevy only if the user asks. |
| `src/popup/*` | Popup: protection switch, current site, risk status, shortcuts. |
| `src/settings/*` | Settings page: elder mode, language, sensitivity, assistant, quiet sites, data reset, privacy facts. |
| `src/dashboard/*` | Dashboard: counters, risk scale, system check, roadmap. |
| `src/shared/constants.js` | Brand, message types, storage keys, defaults. |
| `src/shared/settings.js` | Validation and cleaning of settings and statistics. |
| `src/shared/storage.js` | Storage layer (`chrome.storage.local` only) with a write queue. |
| `src/shared/messaging.js` | Helpers pages use to talk to the worker and to tabs. |
| `src/shared/url-rules.js` | Step 2: configurable rule data (weights, thresholds, brand names and real domains, shorteners, risky endings, keywords). |
| `src/shared/url-intel.js` | Step 2: the offline URL analyzer (safe parsing, punycode decoding, look-alike and structure checks, scoring, explanations). |
| `src/shared/risk-rules.js`, `risk-engine.js` | The central risk engine. The only place evidence becomes a 0-100 warning level (LOW, MEDIUM, HIGH, CRITICAL). Missing modules are "unavailable", never "safe". |
| `src/shared/message-rules.js` | Step 4: configurable message rules (phrase patterns per language, weights, plain-language explanations, scam categories). |
| `src/shared/message-scan.js` | Step 4: the offline message scanner (text cleaning, language guess, phrase matching, highlights, link extraction). It builds evidence and leaves scoring to the risk engine. |
| `src/dashboard/message-check.js` | Step 4: the "Check a message" section of the dashboard. |
| `src/shared/upi-rules.js`, `upi-analyze.js`, `src/dashboard/upi-check.js` | Step 5: the UPI payment analyzer (ID, name, amount, reason and pasted QR text) and its dashboard section. |
| `src/shared/screenshot.js`, `src/dashboard/ocr-runner.js`, `screenshot-check.js` | Step 6: screenshot checks (file type and size, reading quality, receipt facts), the offline OCR runner and the dashboard section. |
| `vendor/tesseract/*` | Step 6: the bundled offline OCR engine and language data (generated by `scripts/make-ocr-assets.js`). |
| `src/shared/elder-text.js`, `i18n.js`, `family-guide.js` | Step 8: Elder Mode wording, interface labels in three languages, and the information-only "Ask someone you trust" guide. |
| `src/shared/mascot.js`, `ui.js`, `theme.css` | Prevy, UI helpers, and the dark navy and blue theme. |
| `assets/icons/*` | Extension icons (generated by `scripts/make-icons.js`). |
| `test/*.test.js` | Unit tests (manifest, syntax, storage, messaging, security). |
| `e2e/run.js` | Real-browser test that loads the extension into Chromium. |
| `docs/KIRO_PROMPTS.md` | Step-by-step prompts for building the next steps with Kiro. |
| `.kiro/` | Kiro steering, spec and hook for this project. |

## How the parts talk

```
popup / settings / dashboard ──(chrome.runtime.sendMessage)──▶ background worker ──▶ chrome.storage.local
         │                                                         │
         └──(chrome.tabs.sendMessage: status, preview)──▶ content script ◀──(broadcast: settings updated)
                                                                   │
                                                  content script ──(CONTENT_READY)──▶ background worker
```

Every message is `{ type, payload }`. The worker checks the sender before acting: extension pages may read and change settings, content scripts may only announce themselves, and everything else is rejected.

## Privacy and security

- One permission: `storage`. No host permissions.
- The content script reads only `location.hostname` and `location.protocol`. It never reads form fields, passwords, cookies, page text or keystrokes.
- Stored data: your settings and four counters/timestamps. No web addresses, no page text.
- Settings use `chrome.storage.local`, so nothing is synced to a Google account.
- The page CSP includes `connect-src 'none'`, so the extension cannot make network requests at all. `test/security.test.js` also fails if a network API, `eval`, `innerHTML` or an external URL appears in the code.
- Step 6 added one CSP keyword, `'wasm-unsafe-eval'`, because the offline OCR engine is WebAssembly. It allows compiling WebAssembly only. JavaScript `eval`, inline scripts and every remote source stay blocked, and `connect-src 'none'` is unchanged.
- Screenshots are chosen by you with a file picker. Nothing is captured automatically. The image is read on this device, its bytes are released when reading ends, and neither the image nor its text is stored.
- Prevy is an original character. It is not Microsoft's Clippy.

## Offline text reading (Step 6)

The screenshot checker uses [Tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 (Apache-2.0), bundled in `vendor/tesseract/` with English, Hindi and Tamil language data (`best_int` models). Nothing is downloaded at run time: the worker, the WebAssembly engine and the language data are all local files, browser caching is turned off (`cacheMethod: "none"`), and the worker ends after every read.

- Size: about 11.3 MB in total (engine 3.7 MB, English 3.8 MB, Hindi 1.8 MB, Tamil 1.8 MB, as base64 text).
- Speed: measured at about 1 to 1.5 seconds per screenshot in the real-browser test on the development machine. Older phones and PCs will be slower.
- To rebuild the files after changing the pinned versions: `npm install`, then `npm run ocr:assets`.
- Limits: blurry, small, rotated or cropped text reads badly. Prevenza shows the text it read so you can correct it, and a poor reading with no warning signs is reported as "Inconclusive", never as safe.

## Emergency Help (Step 9)

- A calm "Emergency Help" button is in the popup and the dashboard header. It opens `src/emergency/emergency.html`.
- The user picks one of seven situations (money sent, OTP or UPI PIN shared, suspicious link, fake bank or KYC message, digital arrest threat, fake payment screenshot, other) and sees safety steps. Elder Mode shows one simpler step at a time.
- Reporting guidance for India: the National Cyber Crime Reporting Portal (opened only when the user presses the link) and the cyber financial fraud helpline 1930 (copied only when the user presses the button). Nothing is called, sent or filed by Prevenza.
- Content lives in `src/shared/emergency.js`. The steps are English only (not reviewed in Hindi or Tamil); the button, page title and the Ask someone you trust guide follow the chosen language.
- Nothing is stored. No new permission. The portal address and one `clipboard.writeText` call are the only exceptions to the "no external URLs / no clipboard" tests, each allowed in exactly one file.
## Unified dashboard (Step 10)

- The dashboard has a menu (website, message, UPI payment, screenshot, Emergency Help) that jumps to the existing checkers and puts the cursor in their first field. Each checker ends with "Back to the dashboard menu".
- `src/shared/risk-result.js` is one result summary used by every checker: category (word and shape), warning level, confidence, evidence found, recommended action, and what could not be checked. It only describes the central risk engine's assessment; it has no thresholds of its own.
- The overview shows aggregate counts: checks done, high or critical, low or medium, inconclusive, and the time of the last check. After a check, the page sends `prevenza/record-scan` with the risk category only. The checks themselves still never write to storage. Counts reset with "Reset statistics" in Settings.
- Nothing that was checked is stored. The "latest check" pill lives in the page's memory only.
## Tests

```
npm install            # installs the browser-test library (playwright-core)
npm test               # unit tests: manifest, syntax, storage, messaging, security, URL rules and URL analysis
npx playwright-core install chromium   # one time, downloads a test browser
npm run test:e2e       # checks in a real browser (opens a window for ~30 seconds)
```

Why a separate Chromium: current branded Chrome and Edge ignore the command-line flag that loads unpacked extensions, so automated tests use the open-source Chromium build.

## How URL checking works (Step 2)

Two ways in, with different privacy limits:

| Entry | What it receives | Where it is used |
|---|---|---|
| Open tab | **Site name and protocol only** (what the content script was already allowed to read) | Popup: replaces "Not scanned yet" with the real result |
| "Check a link" | A full address **the user typed or pasted** | Dashboard link checker |

Nothing is stored. Results contain the host name and reasons, never the path, query or password.

**What it looks for** (each reason is shown in plain language, strongest first):

- A famous name inside an address that is not theirs (`sbi-kyc-update.xyz`), placed in front of another site (`paytm.verify-now.in`, `paypal.com.evil.xyz`), misspelled by one letter (`paytmm.com`) or copied with look-alike characters (`paypa1.com`, `amaz0n.in`). About 25 names are built in, with their real domains.
- Mixed or look-alike alphabets in international names (a Cyrillic "a" in "apple"). Honest names in Hindi, Tamil and other languages are treated as Low, with a gentle note.
- A bare number instead of a name, including disguised forms (`http://3640205644/`). Addresses on your own network are Low.
- Link shorteners from a configurable list (Medium, because the destination is hidden).
- Tricks in the address: the `@` trick (`bank.com@evil.com`), the backslash trick, a long chain of sub-sites, many hyphens, risky endings, free-hosting pages, redirect parameters and heavy encoding.
- It does **not** punish plain `http` or treat `https` as proof of safety. One weak sign (a risky ending, a "login" word) never reaches Medium by itself.

**Scoring.** Each indicator has a weight in `src/shared/url-rules.js`. Score below 3 is Low, 3 to 5.9 is Medium, 6 and above is High. A few critical signs (the `@` trick, mixed alphabets, look-alike letters) are High on their own. A Low result is worded as "no strong warning signs", never "safe".

**Respecting your settings.** Protection off: nothing is analysed. Quiet site: the open tab is not analysed (a link you paste yourself is still checked, and the answer says the site is quiet).

**Limits.** The brand and official-domain lists are small and hand-written. A real site missing from the list whose name contains a listed brand can be flagged Medium. Domain age and reputation are not checked (they would need the network). A brand-new scam site with an ordinary-looking name scores Low. The list of two-part endings is small, not the full Public Suffix List.

## Not yet built

UPI payment analysis, payment screenshot reading, community data, warning pop-ups, and a risk score for links and open pages. See `docs/KIRO_PROMPTS.md` for how each is planned.
