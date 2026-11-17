# Prevenza: Scam Guard

**Pause. Check. Stay safe.** A friendly, privacy-first Chrome extension that helps people in India stop and check before they pay a scammer, share an OTP or trust a fake payment screenshot.

Prevy, the extension's assistant, explains every result in plain words. Everything runs on your device. Nothing you check is stored or sent anywhere.

> The project brief calls the product "Hold On: Scam Guard" and the assistant "Holdy". In this codebase the product is **Prevenza** and the assistant is **Prevy** (the `holdy*.js` file names are left over from the brief). They are the same thing.

## The problem

Online fraud in India often arrives as an ordinary-looking SMS, WhatsApp message, link, UPI request or "payment successful" screenshot. Common tricks are fake KYC updates, "digital arrest" calls, parcel re-delivery fees, lottery prizes, fake customer care and requests to move money to a "safe account". Scammers create panic so people act before they think. Older people and first-time digital payment users are hit hardest.

## The solution

Prevenza gives people a calm place to check something **before** they act:

- Paste a link, a message or payment details, or choose a screenshot.
- Prevenza checks it offline, explains what looks wrong and what to do next, and never says "safe". A low result is worded as "no strong warning signs".
- If something has already gone wrong, **Emergency Help** gives step-by-step guidance and the official Indian reporting channels.

## Main features

| Feature | What it does |
|---|---|
| Popup | Protection on/off, a rating of the open website (from its site name only), shortcuts, Emergency Help. |
| Website checker | Offline URL analysis: look-alike brand names, misleading sub-sites, number addresses, link shorteners, the `@` and backslash tricks, mixed alphabets and punycode. |
| Message checker | English, Hindi, Tamil and Hinglish. Fake KYC, digital arrest, parcel fees, OTP or UPI PIN requests, fake support, lottery, safe-account and other patterns. Suspicious phrases are marked in your own text. Links inside are checked too. |
| UPI payment checker | Recipient ID, name, amount, reason and pasted QR text. Flags "pay to receive", fake refunds, KYC charges and PIN-to-receive requests. There is no field for a PIN or OTP. |
| Screenshot checker | You choose a PNG or JPEG. Its text is read on your device by bundled offline OCR (English, Hindi, Tamil), shown to you for correction, then checked. A screenshot is never treated as proof of payment. |
| Central risk engine | One engine turns evidence from every checker into a 0 to 100 warning level and a category: LOW, MEDIUM, HIGH, CRITICAL, or INCONCLUSIVE when it cannot decide. Missing or failed checks are never counted as safe. |
| Prevy | One assistant card for every checker. It explains the warning, shows the signs found and suggests the next step. It is quiet for LOW, and a repeated result gets a short card. |
| Elder Mode | 22px text, buttons at least 56px tall, stronger contrast, one-column dashboard, plain explanations with numbered steps, and an "Ask someone you trust" guide. |
| Emergency Help | Seven situations (money sent, OTP or PIN shared, suspicious link, fake KYC, digital arrest, fake receipt, other). Reporting guidance: the National Cyber Crime Reporting Portal and helpline 1930. Nothing is called, sent or filed by the extension. |
| Unified dashboard | A menu to every checker, a shared result summary, and privacy-safe counts (checks done by category, last check time). |
| Languages | Interface labels, Prevy's messages, the Elder Mode panel and the trust guide in English, Hindi and Tamil. Detailed reasons and the emergency steps are English only. Hindi and Tamil text needs native-speaker review. |

## Architecture

```
 popup / settings / dashboard / emergency pages
        │  chrome.runtime.sendMessage  { type, payload }
        ▼
 background service worker ── handler.js (checks every sender and payload)
        │
        ├── url-intel.js ────────┐
        ├── message-scan.js ─────┤  each checker returns EVIDENCE only
        ├── upi-analyze.js ──────┤  (indicators with weights)
        ├── screenshot.js ───────┤
        │                        ▼
        │                 risk-engine.js  ← the ONLY place a score or category is made
        │                        │
        │                        ▼
        │        assessment { score, category, confidence, evidence, reasons, actions }
        │
        └── storage.js ── chrome.storage.local: settings + counters only

 dashboard page: ocr-runner.js runs Tesseract (WebAssembly) locally on the chosen image and sends only the text.
 pages: risk-result.js (summary) and holdy-card.js (Prevy) DISPLAY the assessment; they never score.
 content script (on websites): reads only location.hostname and location.protocol; shows Prevy only if asked.
```

## Technology

- Chrome Extension Manifest V3 (minimum Chrome 110).
- Plain JavaScript, HTML and CSS. No framework and no build step.
- [Tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 (Apache-2.0) with English, Hindi and Tamil data, bundled in `vendor/tesseract/` (about 11.3 MB).
- Tests: Node's built-in test runner, [fast-check](https://github.com/dubzzz/fast-check) for property tests, and [playwright-core](https://playwright.dev) to drive a real Chromium with the extension loaded. These are development-only; the extension itself has no dependencies to download.

## Folder structure

```
manifest.json              Manifest V3: permission "storage" only, strict CSP (connect-src 'none')
assets/icons/              extension icons
src/background/            service-worker.js (wiring), handler.js (message router and validation)
src/content/content.js     runs on websites: site name only, optional Prevy bubble
src/popup/                 the toolbar popup
src/settings/              settings page (protection, Elder Mode, language, sensitivity, quiet sites, reset)
src/dashboard/             dashboard page and the four checkers (link in dashboard.js, message-check, upi-check, screenshot-check, ocr-runner)
src/emergency/             Emergency Help page
src/shared/                pure logic shared by every page, also loaded in Node for tests:
  constants.js settings.js storage.js messaging.js ui.js theme.css mascot.js
  url-rules.js url-intel.js            website checks
  message-rules.js message-scan.js     message checks
  upi-rules.js upi-analyze.js          UPI checks
  screenshot.js                        image validation, OCR quality, receipt facts
  risk-rules.js risk-engine.js         the central risk engine
  risk-result.js                       the shared result summary (display only)
  holdy.js holdy-text.js holdy-card.js Prevy
  elder-text.js i18n.js family-guide.js Elder Mode, languages, trust guide
  emergency.js                         Emergency Help content and official details
vendor/tesseract/          bundled offline OCR engine and language data
test/                      unit, security and privacy tests (npm test)
e2e/run.js                 real-browser checks (npm run test:e2e)
scripts/                   icon and OCR asset generators, detection spot-check
DEMO_GUIDE.md              5-minute hackathon demo
```

## Install and load in Chrome

You do not need Node.js just to use the extension.

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Turn on **Developer mode** (switch at the top right).
4. Click **Load unpacked**.
5. Choose the project folder: the one that contains `manifest.json`.
6. Click the puzzle-piece icon in the toolbar and pin **Prevenza: Scam Guard**.

After changing code, press the reload arrow on the extension's card. If the card shows **Errors**, click it to read the message.

## How to use each part

- **Popup:** click the shield icon. Use the switch to turn protection on or off. The page rating is based on the site name only. **Dashboard** opens the checkers. **Emergency Help** opens the help page.
- **Check a website:** on the dashboard, choose "Check a website", paste the link and press **Check link**.
- **Check a message:** choose "Check a suspicious message", paste the text, optionally pick the language, press **Analyze message**. **Clear** empties the box.
- **Check a UPI payment:** choose "Check a UPI payment request", fill in what you have (all fields are optional, but at least one is needed) and press **Analyze payment**. Never type a PIN or OTP; there is nowhere to put one.
- **Scan a screenshot:** choose "Scan a screenshot", pick a PNG or JPEG (up to 8 MB), choose the language in the picture, press **Read and check screenshot**. You can correct the text it read and press **Check this text again**. **Clear all** removes everything.
- **Elder Mode and language:** open **Settings**, then *Assistant and accessibility*.
- **Emergency Help:** choose what happened. The steps appear below. You can open the official portal or copy the helpline number. Nothing is sent.
- **Statistics:** the dashboard overview shows counts only. Reset them in Settings.

## Privacy and security design

- **One permission:** `storage`. No host permissions, no optional permissions.
- **No network:** the extension pages' Content Security Policy has `connect-src 'none'`, so even a bug could not send data. The only outside address in the code is the official reporting portal, which opens only when the user presses its link. Browser tests confirm the extension pages make no network requests.
- **What is stored** (`chrome.storage.local`, never synced): your settings, and counters (pages watched, checks done per risk category, and the times of the last activity and last check). **Never stored:** links, messages, UPI IDs, names, amounts, screenshots or the text read from them.
- **What the extension reads by itself:** only the site name and protocol of the open tab. It never reads form fields, passwords, OTPs, cookies, page text, keystrokes, SMS, WhatsApp or payment apps. Everything else is what you paste or choose yourself.
- **Screenshots:** read on your device. The image bytes are released after reading. The OCR worker is shut down after each read, and browser caching is off.
- **Safe page code:** text is inserted only as text (no `innerHTML`, no `eval`, no inline scripts), and every message to the background is checked for sender and exact fields. `test/security.test.js` fails the build if any of these rules is broken.
- **One CSP exception:** `'wasm-unsafe-eval'`, needed to run the WebAssembly OCR engine. It allows compiling WebAssembly only.
- **Honest wording:** no result is ever called "safe". The warning level is not a probability. A payment screenshot is never treated as proof. Emergency Help does not claim it can freeze accounts or recover money.

## Testing

```
npm install                               # development tools only
npm test                                  # 396 unit, security and privacy tests
npx playwright-core install chromium      # once: downloads a test browser
npm run test:e2e                          # 432 checks in a real Chromium (a window opens for about 2 minutes)
npm run audit:detection                   # prints the detection spot-check table
```

Results from the final run (Step 11): 396/396 unit tests passed, 432/432 browser checks passed. Branded Chrome ignores the command-line flag that loads unpacked extensions, so the automated tests use the open-source Chromium build. Manual loading in Chrome works as described above.

**Detection spot-check** (`scripts/detection-check.js`): 57 invented examples (25 links, 21 messages, 11 UPI requests). 52 behaved as expected, 4 were recorded without a verdict, and there was 1 false negative (a "like videos and earn" job scam was rated Low) and no false positives. This is **not an accuracy measurement**: the examples are similar to the ones the rules were written from, and there is no held-out data set.

## Known limitations

- Detection is rule-based and offline. It catches common patterns, not every scam. New wording, other languages and brand-new scam websites with ordinary names can be missed (for example the job/task scam above).
- Website checks use a small built-in list of about 25 brands and their real domains, plus a short list of endings. Domain age and reputation are not checked (that would need the network).
- The open-tab rating in the popup uses the site name only, not the page content.
- A UPI ID that cannot be read is reported as a problem, and the rest of the details are still checked. Prevenza cannot see your UPI app, check who owns an ID, or stop a payment.
- OCR is slower on older devices (measured at about 0.4 to 1.7 seconds per image on the development machine). Rotated, cropped or very stylised text reads badly. Poor readings with no warning signs are reported as Inconclusive.
- Hindi and Tamil translations were written by the developer and need native-speaker review. Not everything is translated.
- The extension does not show warnings on websites by itself (planned). The "Warnings shown" counter therefore stays at 0.

## Future scope

- Warning pop-up before a risky page opens.
- A larger, reviewed rule set and a held-out test set to measure accuracy honestly.
- Optional online checks (domain age, community reports), off by default, with explicit consent and the minimum data.
- Full Hindi and Tamil interface reviewed by native speakers, and more Indian languages.
- An Android companion for SMS and UPI apps, within platform privacy rules.
