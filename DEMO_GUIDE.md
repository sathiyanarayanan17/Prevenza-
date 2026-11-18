# Prevenza: Scam Guard, hackathon demo guide

Use **test data only**. Never type real passwords, OTPs, UPI PINs, account numbers, real payment details or anyone's private messages during the demo. The examples below are invented.

## 1. Introduction

Prevenza is a Chrome extension that helps people pause and check before they pay a scammer. Its assistant, Prevy (called "Holdy" in the original brief), explains each result in plain words. Everything runs on the device.

## 2. Problem

Scams in India arrive as normal-looking SMS, WhatsApp messages, links, UPI requests and fake "payment successful" screenshots. They create panic, so people act before they think: fake KYC, digital arrest, parcel fees, lottery prizes, fake customer care, "safe account" transfers.

## 3. Target users

- Older people and their families.
- First-time UPI and online banking users.
- Small shopkeepers who receive payment screenshots.
- Anyone who wants a second opinion before acting.

## 4. How Prevy works

1. The user pastes a link, a message or payment details, or chooses a screenshot.
2. The checker finds **evidence** (for example "asks for your OTP", or "a bank name on a site that is not the bank's").
3. The **central risk engine** turns all evidence into one warning level from 0 to 100 and a category: LOW, MEDIUM, HIGH or CRITICAL. If it cannot decide, the result is INCONCLUSIVE.
4. Prevy shows a card that matches the category: what it noticed, the signs found, and what to do next. For LOW it stays quiet with a small note and never says "safe". In Elder Mode it uses simpler words and numbered steps.

## 5. Technology

Manifest V3 Chrome extension, plain JavaScript, HTML and CSS, no framework, no build step. Offline OCR with bundled Tesseract.js 7.0.0 (WebAssembly) for English, Hindi and Tamil. Tests use Node's test runner, fast-check and Playwright with Chromium.

## 6. Privacy-first architecture

- The only permission is `storage`, and there is no network: the CSP has `connect-src 'none'`.
- Only settings and counters are stored. Links, messages, UPI details and screenshots are never stored.
- On websites, the extension reads only the site name. It never reads passwords, OTPs, forms, SMS, WhatsApp or payment apps.
- Screenshots are read on the device, and the OCR worker is shut down afterwards.

## 7. Implemented features

Popup and settings, website checker, message checker (English, Hindi, Tamil, Hinglish), UPI payment checker, screenshot checker with offline OCR, central risk engine, Prevy cards, Elder Mode with the "Ask someone you trust" guide, Emergency Help with Indian reporting guidance, unified dashboard with privacy-safe counts.

## 8. Known limitations (say these honestly if asked)

- Rule-based, offline detection: it catches common patterns, not every scam. The "like videos and earn money" job scam that the spot-check used to miss is now caught, but new wording will still be missed.
- Small built-in brand list for website checks. Domain age and reputation are not checked.
- OCR struggles with rotated or very stylised text.
- Hindi and Tamil text needs native-speaker review. Detailed reasons and the emergency steps are in English.
- The warning before a website uses only the site name, so scam sites with ordinary names are not warned about.
- The spot-check numbers are not an accuracy measurement.

## 9. Testing summary

Latest run: 465/465 unit, security and privacy tests passed, 464/464 real-browser checks passed (Chromium with the extension loaded) and 88/88 website browser checks passed (`npm run test:e2e:web`).
- **Covered:** every checker end to end, Elder Mode, languages, Emergency Help, keyboard use, phone and desktop layouts, protection off, browser restart, no network requests, and nothing private stored.
- **Measured on the development machine:** each check answered in under 10 ms (median, largest inputs). The dashboard was ready in 57 to 211 ms. One screenshot took about 0.4 to 1.7 seconds to read.

## 10. Future improvements

Warning before a risky page opens. A larger reviewed rule set with a held-out test set. Optional consented online checks. A fully reviewed Hindi and Tamil interface. Finishing and testing the Android app (the project and the "Share to Prevenza" feature exist, but have not yet been run on a device).

---

## Before the demo (2 minutes of setup)

1. Load the extension: `chrome://extensions/`, turn on **Developer mode**, **Load unpacked**, choose the folder with `manifest.json`. Pin the shield icon.
2. Open **Settings** and press **Restore default settings** twice (the second press confirms): protection on, Elder Mode off, English. Press **Reset statistics** twice so the counts start at 0.
3. Have the screenshot ready: open the dashboard, press **F12**, and paste the snippet in the box below into the Console. It downloads `demo-scam.png` (made in your browser; nothing is sent). Or make your own screenshot of the text in Demo 3 in any image editor.
4. Keep this guide open in another window to copy the test data.

```js
const c = document.createElement("canvas"); c.width = 1000; c.height = 260; const g = c.getContext("2d");
g.fillStyle = "#fff"; g.fillRect(0, 0, 1000, 260); g.fillStyle = "#111"; g.font = "32px Arial";
["URGENT: Your bank KYC has expired.", "Share the OTP sent to your phone now", "or your account will be blocked today."].forEach((t, i) => g.fillText(t, 30, 60 + i * 64));
const a = document.createElement("a"); a.download = "demo-scam.png"; a.href = c.toDataURL("image/png"); a.click();
```

## The 5-minute demo

| Time | Demo | What to do | What the audience should see |
|---|---|---|---|
| 0:00 to 0:30 | Intro | One sentence on the problem and Prevy. | |
| 0:30 to 1:00 | **1. Popup and protection** | Open any normal website (for example `https://www.wikipedia.org`). Click the shield. Turn protection off and on. Open **Settings** briefly. | The site name with a "Low risk" pill and the words "no strong warning signs" (not "safe"). The switch works. "Everything stays on your device." |
| 1:00 to 1:40 | **2. Suspicious URL** | Dashboard, then **Check a website**. Paste `https://sbi.co.in.verify-account.xyz/login`. Press **Check link**. Then try `https://www.sbi.co.in/`. | The first is **Critical risk**, with the reason that the bank's name sits in front of another website, and Prevy's "stop and check first" card. The real site is Low. |
| 1:40 to 2:30 | **3. Scam message** | **Check a suspicious message**. Paste: `This is CBI officer. You are under digital arrest. Do not tell anyone. Transfer Rs 50000 to the safe account now and share the OTP.` Press **Analyze message**. | **Critical risk**. The suspicious phrases are marked in the text, the reasons (digital arrest, safe account, OTP) are listed, and Prevy's card shows the steps. Optional: paste `Hi Amma, I will reach home by 7 pm.` and show it stays Low and quiet. |
| 2:30 to 3:10 | **4. UPI request** | **Check a UPI payment request**. UPI ID `refund.helpdesk@ybl`, name `Customer Care Refund`, amount `4999`, reason `Pay this amount to receive your refund.` Press **Analyze payment**, then **Clear**. | **High risk**: "you never need to pay to receive money". The page says Prevenza cannot stop a payment. Clear empties everything. |
| 3:10 to 3:50 | **5. Screenshot (offline OCR)** | **Scan a screenshot**. Choose `demo-scam.png`, keep "English", press **Read and check screenshot**. | The progress bar, then the text read from the image (editable) and a High or Critical result. Point out that nothing was uploaded. Press **Clear all**. |
| 3:50 to 4:30 | **6. Prevy and Elder Mode** | Settings: turn on **Elder mode**. Go back to the dashboard and run the message from Demo 3 again. | Larger text and buttons, one column, Emergency Help first in the menu. Prevy's panel: *What we found*, *Why this can be dangerous*, *What to do now* (numbered), and **Ask someone you trust**. Turn Elder Mode off again. |
| 4:30 to 5:00 | **7. Emergency Help** | Press **Emergency Help**. Choose "I shared my OTP or UPI PIN". Scroll to the reporting section. Press **Copy helpline number**. | Calm steps (contact your bank immediately). The National Cyber Crime Reporting Portal `https://cybercrime.gov.in/` and helpline **1930**. Copying only copies; nothing is called or sent. **Do not submit anything on the real portal during the demo.** |

Finish on the dashboard overview: the counts (checks done, high or critical) went up, and the note says nothing you checked was saved.

## If something goes wrong

- **No result appears:** check that protection is on in the popup.
- **The screenshot reads badly:** use the clearer `demo-scam.png`, or correct the text and press **Check this text again**.
- **The result differs from this guide:** say so. Do not claim a result the screen does not show. The rules may rate an example differently from the one shown here.
- **An error shows on the extension card:** reload the extension in `chrome://extensions/`.

## Optional: what is new in Step 12 (3 minutes)

1. **Warning before a risky website.** Do not visit real scam sites. Show the screenshot `e2e/shots/29-page-warning.png` (made by the automated test with a pretend scam site), point out **Continue anyway**, and show the setting *Warn me before a risky website*.
2. **QR code in a screenshot.** Choose a picture with a UPI QR code in **Scan a screenshot** (make one with any QR generator from `upi://pay?pa=refund.helpdesk@ybl&am=4999&tn=Pay%20to%20receive%20refund`). Press **Check this QR payment**, then **Analyze payment**: High or Critical risk.
3. **Job scam.** Paste `Earn Rs 3000 daily by liking YouTube videos. Pay Rs 500 registration fee to start today.` High risk.
4. **More languages.** Paste `మీ ఖాతా ఈరోజు బ్లాక్ అవుతుంది. వెంటనే మీ OTP చెప్పండి` (Telugu): High risk, with a note that these checks need native-speaker review. A Gujarati message shows Inconclusive, never Low.
5. **Prepare your complaint** in Emergency Help: the checklist and template. Point out there are no boxes to type into.

Say honestly: there is still no accuracy figure. `npm run eval:holdout` is ready, but needs a real held-out set.

## Optional: the website (2 minutes)

The same checkers run as a website, with no extension needed. This is a good backup if Chrome will not load the extension.

1. In the project folder run `npm run web` and open `http://127.0.0.1:5173/web/` (use `http`, not a file address: the offline screenshot reader does not work from a file).
2. Show the landing page: the headline, the labelled **Example** result, **Privacy** and **Honest limits**. The example is the real engine's result for its text, not a mock-up.
3. Press **Check something now** and repeat Demos 2 to 5 from the table above. Elder Mode and the language are on the same page, under *Assistant and accessibility*.
4. Say what is stored: only the language, Elder Mode and counts, in this browser's `localStorage`. Nothing you check is saved. Pressing **Reset statistics** twice clears the counts.
5. The Android app is in development. Do not demo it as finished: the project and the "Share to Prevenza" feature are built and tested in a browser, but have not been run on a phone yet.
