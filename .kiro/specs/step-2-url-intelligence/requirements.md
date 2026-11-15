# Requirements: Step 2, Offline URL Intelligence

## Introduction
Add an offline analyzer that gives a web address a preliminary risk of LOW, MEDIUM or HIGH and explains every reason in plain language. No new permissions, no network, nothing stored.

## Requirements

### 1. Privacy boundary
- WHEN the open page is analysed THEN only the site name and protocol SHALL be used. The content script SHALL NOT be changed and SHALL NOT load the analyzer.
- WHEN the user types or pastes a full address into the link checker THEN the full address MAY be analysed, in memory only.
- The analyzer SHALL NOT store any address, host name or result, SHALL NOT make network requests, and SHALL NOT add permissions to `manifest.json`.
- Results SHALL contain the host name and reasons, never the path, query, username or password.

### 2. Detection
The analyzer SHALL detect: invalid and malformed input, unsupported schemes, lookalike and misspelled famous names, famous names placed in front of other sites, punycode and mixed-alphabet names, IP-address hosts (including disguised forms), suspicious or confusing sub-domain structure, link shorteners from a configurable list, the `@` and backslash tricks, and a few URL-structure signs (redirect parameters, heavy encoding, unusual ports).

### 3. Proportion
- Plain `http` alone SHALL NOT be a warning. HTTPS SHALL NOT reduce the score or be described as safe.
- A single weak sign (a risky ending, a login-style word, a long chain of sub-sites) SHALL NOT reach MEDIUM.
- Genuine sites on the built-in list, with or without `www` or a login sub-site, SHALL be LOW.
- Honest names in other languages SHALL be LOW with a gentle note.

### 4. Explanations
- Every indicator SHALL have a plain-language label and reason, free of technical jargon.
- LOW SHALL be worded as "no strong warning signs", never as "safe".

### 5. Configuration
- Weights, thresholds, brand names, official domains, shorteners, risky endings and keywords SHALL live in `src/shared/url-rules.js`, separate from the logic in `url-intel.js`.

### 6. Integration
- Analysis SHALL run through the background router with strict payload shapes and sender checks.
- WHEN protection is off THEN nothing SHALL be analysed. WHEN a site is quiet THEN automatic analysis SHALL be skipped for it and its sub-sites.
- The popup SHALL show "Not scanned yet" until a real result exists. The dashboard SHALL offer a "Check a link" tool.

### 7. Safety of input handling
- Malformed, oversized and hostile input SHALL return a friendly error and never throw, and SHALL be handled in under 20 ms.

## Known limitations
- Brand and official-domain lists are small and hand-written. A real site missing from the list may be flagged MEDIUM if its name contains a listed brand.
- Domain age and reputation are not checked (they need the network).
- A brand-new scam site with a clean-looking name will score LOW.
- The ending list is small, not the full Public Suffix List.
