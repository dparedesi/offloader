# Privacy Policy for Offloader

**Last updated:** January 7, 2026

## Overview

Offloader is a browser extension that automatically discards memory-heavy tabs. Your privacy is important to us.

## Data Collection

**We do not collect, transmit, or share any personal data.**

All data stays on your device:
- **User preferences** (target sites, idle threshold, auto-discard setting) are stored locally using Chrome's `chrome.storage.local` API
- **Telemetry data** (tab events, discard history) is stored locally in IndexedDB for your own analytics viewing

## Data Sharing

We do not:
- Send any data to external servers
- Use analytics or tracking services
- Share data with third parties
- Access the content of your tabs

## Permissions Used

| Permission | Purpose |
|------------|---------|
| `tabs` | Query tab URLs to match against your configured sites and discard tabs |
| `storage` | Save your preferences locally |
| `alarms` | Schedule periodic checks for tabs to discard |

## Data Retention

Telemetry data is automatically purged after the retention period you configure (default: 30 days). You can export or clear your data at any time from the extension dashboard.

## Open Source

This extension is open source. You can review the code at:
https://github.com/dparedesi/offloader

## Contact

For privacy concerns, please open an issue on GitHub:
https://github.com/dparedesi/offloader/issues

## Changes

Any changes to this privacy policy will be posted in this document with an updated date.
