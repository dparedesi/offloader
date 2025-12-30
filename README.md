# Chrome Tab Killer

Automatically discards heavy tabs to free RAM while keeping them visible in your tab bar. Built for personal use to manage memory-hungry sites like SharePoint, Slack, and Asana.

## Why This Exists

Chrome's built-in memory saver is too generic. This extension targets specific sites that consistently consume excessive RAM, discarding them on a schedule while protecting tabs you're actively using.

## Features

- **Targeted auto-discard**: Configure which sites to discard (SharePoint, Slack, Asana, QuickSight)
- **Configurable intervals**: Run every 5, 10, 15, or 30 minutes
- **Manual override**: One-click to discard all tabs immediately
- **Active tab protection**: Never discards the tab you're currently viewing
- **Behavior analytics**: Track tab usage patterns to optimize discard rules
- **Zero dependencies**: Vanilla JavaScript, no frameworks

## Installation

1. Navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this directory
4. Pin the extension to your toolbar

## Usage

### Quick Start

Click the extension icon → toggle "Auto-discard" on → select interval → choose target sites.

### Manual Discard

"Discard All Tabs Now" button discards everything except:
- Active tab (prevents disruption during screen sharing)
- Extension pages
- Chrome internal pages

### Analytics

"View Dashboard" opens a full-page analytics view showing:
- Top domains by tab count
- Most active tabs (by view count and time)
- Most discarded sites
- Recent discard events with timestamps

Export data as JSON for custom analysis.

## How It Works

Uses Chrome's native `tabs.discard()` API to unload tabs from memory. Discarded tabs remain visible in the tab bar but show a blank page until clicked. This is the same mechanism Chrome uses for its built-in memory saver.

**Key behaviors:**
- Skips active tabs (prevents closing what you're viewing)
- Skips already-discarded tabs (no redundant work)
- Skips extension and chrome:// pages (prevents breaking Chrome)
- Logs all activity to IndexedDB for pattern analysis

## Telemetry

Tracks tab behavior locally in IndexedDB:
- Tab creation, activation, updates, removal
- Active time per tab
- Discard events with timestamps
- Opener relationships (which tab spawned which)
- Window and position data

**Privacy**: All data stays local. No network requests. No external transmission.

**Purpose**: After a month of data collection, you can identify patterns like:
- "I open 50 Asana tabs/week but only revisit 5" → discard more aggressively
- "SharePoint tabs opened before 10am are never touched" → immediate discard
- "I always reload Slack within 5 minutes" → exclude from auto-discard

## Project Structure

```
chrome-tab-killer/
├── manifest.json           # Extension configuration
├── README.md              # This file
├── .gitignore             # Git ignore rules
├── icons/                 # Extension icons (16, 48, 128px + SVG source)
├── scripts/               # Optional automation scripts
│   └── trigger-discard.sh # AppleScript for cron (macOS)
└── src/
    ├── html/
    │   ├── popup.html     # Extension popup UI
    │   └── dashboard.html # Analytics dashboard
    └── js/
        ├── background.js  # Service worker (main logic)
        ├── telemetry.js   # IndexedDB wrapper
        ├── popup.js       # Popup controls
        └── dashboard.js   # Analytics visualization
```

## Technical Details

- **Manifest**: v3 (latest Chrome extension standard)
- **Permissions**: `tabs` (read/discard), `storage` (settings)
- **Storage**: IndexedDB for telemetry (unlimited), chrome.storage.local for settings
- **Architecture**: Service worker background script, no persistent background page
- **Dependencies**: None (vanilla JS)

## Optional: Cron Automation

For scheduled execution independent of the extension timer:

```bash
# Add to crontab (macOS)
30 14 * * * /path/to/chrome-tab-killer/scripts/trigger-discard.sh
```

The script uses AppleScript to simulate the keyboard shortcut. Requires Chrome to be running.

## Development Notes

Built with simplicity in mind. No build process, no transpilation, no bundlers. Just load the directory as an unpacked extension.

**Key design decisions:**
- Vanilla JS over frameworks (reduces complexity, no build step)
- IndexedDB over chrome.storage (unlimited storage for long-term telemetry)
- Service worker over background page (Manifest v3 requirement)
- Separate dashboard page over in-popup analytics (better UX for data visualization)

## Known Limitations

- Cannot access memory usage per tab (Chrome API doesn't expose this)
- Cannot track tabs opened before extension installation
- Service worker may sleep between discard intervals (Chrome behavior, not a bug)
- Telemetry only tracks tabs while extension is active

## License

Personal use. Not intended for public distribution or Chrome Web Store publication.
