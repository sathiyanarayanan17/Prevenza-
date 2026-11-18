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
web/                       the website (landing page, checkers, Emergency Help) and its bridge to the extension code
mobile/                    the Android app (Capacitor): config, native share code, overlay script. mobile/www is generated
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
e2e/web.js                 real-browser checks for the website and the app files (npm run test:e2e:web)
scripts/                   icon and OCR asset generators, detection spot-check, serve-web.js (dev server), build-mobile.js
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

## Website

The same checkers run as a plain website in `web/` (HTML, CSS and JavaScript, no build step). It uses the extension's own code: `src/shared/` and the message router in `src/background/handler.js`. `web/js/web-bridge.js` takes the place of the extension's messaging file and runs that router inside the page, so the website and the extension give the same results.

```
npm run web        # serves the repository on http://127.0.0.1:5173/ and opens /web/
```

Open the address in a browser. Use `http://`, not a `file://` address: browsers block the offline OCR worker on `file://` pages. Set `PORT=8080` to use another port. The server is for development: it listens on 127.0.0.1 only, refuses paths outside the repository and sends no-store, no-sniff and no-frame headers.

| Page | What it is |
|---|---|
| `web/index.html` | Landing page: the problem, how it works, the four checkers, an example result, privacy, honest limits, how to get Prevenza, and the Emergency band (helpline 1930). |
| `web/app/check.html` | The four checkers, language and Elder Mode choices, counts with a reset, and the risk scale. |
| `web/app/emergency.html` | Emergency Help (the extension's own page script). |

Keep the pages inside `web/app/`: they load the OCR files from `../../vendor/tesseract/`.

**Website privacy notes**
- Each page has a `<meta>` Content Security Policy with `connect-src 'none'`: the page cannot open network connections. There are no inline scripts or styles, no `innerHTML` and no `eval`. `'wasm-unsafe-eval'` appears only on the checker page, for the WebAssembly OCR engine.
- The page's own text reaches nothing outside the page. The only external address in the site is the link to this GitHub repository (`web/index.html`). Emergency Help shows the official portal address and opens it only when you press its link.
- **localStorage:** the site saves your language and Elder Mode choices and the counters (checks done by result level, time of the last check) in this browser's `localStorage`, under keys that start with `prevenza-web:`. The same storage code as the extension decides what may be saved. Links, messages, UPI details, names, amounts and screenshot text are never saved. The counts can be reset on the checker page, and clearing site data removes everything. If the browser blocks `localStorage` (some private windows), choices last until the page is closed.
- No cookies, accounts, analytics or adverts.

## Android app

`mobile/` wraps the website's checker page in an Android app with [Capacitor](https://capacitorjs.com) 8.6.2 (pinned). It is the only part of the project with a build step. The app contains the same files as the website, copied at build time by `scripts/build-mobile.js` into `mobile/www/` (ignored by git), so there is still one copy of the detection code.

What is copied, with the same relative paths: `web/`, `src/shared/`, `src/background/handler.js`, `src/dashboard/*-check.js`, `src/dashboard/ocr-runner.js`, `src/dashboard/dashboard.css`, `src/emergency/`, `vendor/tesseract/` and `assets/icons/`. The start page is `web/app/check.html`.

- **Share to Prevenza:** from another app, share text or an image (PNG or JPEG) to Prevenza. A shared link goes into the link checker, other text into the message checker and an image into the screenshot checker. It is only filled in. You press the check button yourself. The shared item is held in memory until the page takes it, and is never written to disk.
- **Permissions:** none. Capacitor adds the INTERNET permission by default. It is removed here, because the app only shows files bundled inside it. There is no SMS, contacts, storage, camera or microphone access, and backups are switched off.
- **Build:** you need Node.js, the Android SDK (Android Studio) and a JDK.

```
cd mobile
npm install
npm run sync       # copies the files into mobile/www and into the Android project
npm run open       # opens the project in Android Studio; press Run on a device or emulator
npm run apk        # or build a debug APK from the command line (needs ANDROID_HOME)
```

Status: the build script, the share script and the manifest are covered by unit tests, and the app's files are tested in Chromium with a pretend Capacitor (`npm run test:e2e:web`). The Gradle build, the install on a device or emulator, and the native share code have **not** been run yet. Treat the Android app as in development.
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
npm test                                  # 428 unit, security and privacy tests (extension, website and Android files)
npx playwright-core install chromium      # once: downloads a test browser
npm run test:e2e                          # 432 checks in a real Chromium (a window opens for about 2 minutes)
npm run test:e2e:web                      # 77 checks of the website and the app files (headless, about 1 minute)
npm run audit:detection                   # prints the detection spot-check table
```

Results from the latest run: 428 of 428 unit tests passed (396 extension tests plus 32 for the website and the Android files), 432/432 extension browser checks passed and 77/77 website browser checks passed. Branded Chrome ignores the command-line flag that loads unpacked extensions, so the automated tests use the open-source Chromium build. Manual loading in Chrome works as described above.

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
- Finish and test the Android app on a device (see the Android section), then consider reading SMS and UPI apps only within platform privacy rules.
