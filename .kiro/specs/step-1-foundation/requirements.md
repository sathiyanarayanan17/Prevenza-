# Requirements: Step 1, Extension Foundation

## Introduction
Build the Manifest V3 foundation of Prevenza: Scam Guard. No scam detection in this step.

## Requirements

### 1. Extension structure
- The extension SHALL load in Chrome through "Load unpacked" with no errors.
- It SHALL include a background service worker, a content script, a popup, a settings page and a dashboard page.

### 2. Minimum permissions
- WHEN the manifest is read THEN the only permission SHALL be `storage`, with no host permissions.
- The content script SHALL run only on http and https pages, in the top frame.

### 3. Messaging
- WHEN a popup, settings page or dashboard sends a message THEN the worker SHALL validate the sender and the payload and reply `{ ok, ... }`.
- WHEN a content script sends a message THEN it SHALL be allowed to send only `ping` and `content-ready`.
- WHEN settings change THEN the worker SHALL notify every content script.

### 4. Storage
- Settings and statistics SHALL be kept in `chrome.storage.local`, validated on every read and write.
- Statistics SHALL contain counters and timestamps only.

### 5. Interface
- The interface SHALL use the Prevenza branding, a dark navy and blue theme, and the Prevy assistant.
- Risk status SHALL be shown with a label and a shape, not colour alone.
- The pages SHALL be responsive and SHALL support an elder mode with larger text.

### 6. Privacy
- The content script SHALL read only the site name and protocol.
- The extension SHALL NOT read passwords, payment details or typed text, and SHALL NOT make network requests.

### 7. Verification
- Unit tests SHALL cover the manifest, syntax, storage, messaging and security rules.
- A real-browser test SHALL load the extension and check messaging, storage, privacy and the three pages.
