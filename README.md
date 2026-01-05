# Chrome Tab Killer

Automatically discards heavy tabs to free RAM while keeping them visible in your tab bar. Built for personal use to manage memory-hungry sites like SharePoint, Slack, and Asana.

![Chrome Tab Killer Banner](banner.png)

## Why This Exists

Chrome's built-in memory saver is too generic. This extension targets specific sites that consistently consume excessive RAM, discarding them on a schedule while protecting tabs you're actively using.

## Features

- **Targeted auto-discard**: Configure which sites to discard (add your own via Dashboard)
- **Reliable scheduling**: Uses Chrome's Alarms API to survive service worker sleep
- **Configurable intervals**: Run every 5, 10, 15, or 30 minutes
- **Idle tab detection**: Automatically discard tabs not viewed for N hours
- **Manual override**: One-click to discard all tabs immediately
- **Active tab protection**: Never discards the tab you're currently viewing
- **Behavior analytics**: Track tab usage patterns to optimize discard rules
- **Data retention**: Automatic cleanup of old telemetry data (configurable)
- **Type-safe**: Written in strict TypeScript

## Installation

### For Development

```bash
# Install dependencies
npm install

# Build the extension
npm run build

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

### Load in Chrome

1. Navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `dist/` directory
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

### Custom Target Sites

In the Dashboard, you can:
- Add custom domains (e.g., `jira.atlassian.com` or partial matches like `jira`)
- Remove built-in or custom sites
- Configure idle threshold (auto-discard tabs not viewed for X hours)

## How It Works

Uses Chrome's native `tabs.discard()` API to unload tabs from memory. Discarded tabs remain visible in the tab bar but show a blank page until clicked.

**Key behaviors:**
- Uses `chrome.alarms` API for reliable scheduling (survives service worker sleep)
- Skips active tabs (prevents closing what you're viewing)
- Skips already-discarded tabs (no redundant work)
- Skips extension and chrome:// pages (prevents breaking Chrome)
- Logs all activity to IndexedDB for pattern analysis
- Automatically purges old telemetry data (30 days default)

## Telemetry

Tracks tab behavior locally in IndexedDB:
- Tab creation, activation, updates, removal
- Active time per tab
- Discard events with timestamps and reasons
- Opener relationships (which tab spawned which)

**Privacy**: All data stays local. No network requests. No external transmission.

**Data Retention**: Old events are automatically purged after 180 days (configurable in Dashboard).

## Project Structure

```
chrome-tab-killer/
├── manifest.json           # Extension configuration
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
├── vitest.config.ts       # Test configuration
├── .eslintrc.json         # ESLint rules
├── .prettierrc            # Prettier configuration
├── icons/                 # Extension icons (16, 48, 128px + SVG source)
├── scripts/               # Optional automation scripts
│   └── trigger-discard.sh # AppleScript for cron (macOS)
├── src/
│   ├── html/
│   │   ├── popup.html     # Extension popup UI
│   │   └── dashboard.html # Analytics dashboard
│   ├── ts/
│   │   ├── types.ts       # Type definitions and validation
│   │   ├── telemetry.ts   # IndexedDB wrapper
│   │   ├── background.ts  # Service worker (main logic)
│   │   ├── popup.ts       # Popup controls
│   │   ├── dashboard.ts   # Analytics visualization
│   │   └── *.test.ts      # Unit tests
│   └── test/
│       └── setup.ts       # Test setup and Chrome API mocks
└── dist/                  # Build output (git-ignored)
```

## Technical Details

- **Language**: TypeScript (strict mode)
- **Manifest**: v3 (latest Chrome extension standard)
- **Permissions**: `tabs`, `storage`, `alarms`
- **Storage**: IndexedDB for telemetry, chrome.storage.local for settings
- **Architecture**: Service worker with alarm-based scheduling
- **Testing**: Vitest with fake-indexeddb
- **Security**: DOM APIs only (no innerHTML), input validation

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript and copy assets to `dist/` |
| `npm run build:watch` | Watch mode for development |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run format` | Format with Prettier |
| `npm run typecheck` | Type check without emitting |
| `npm test` | Run tests |
| `npm run test:watch` | Watch mode for tests |
| `npm run test:coverage` | Run tests with coverage |

## Optional: Cron Automation

For scheduled execution independent of the extension timer:

```bash
# Add to crontab (macOS)
30 14 * * * /path/to/chrome-tab-killer/scripts/trigger-discard.sh
```

The script uses AppleScript to simulate the keyboard shortcut. Requires Chrome to be running.

## Known Limitations

- Cannot access memory usage per tab (Chrome API doesn't expose this)
- Cannot track tabs opened before extension installation
- Telemetry only tracks tabs while extension is active

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| TypeScript | Type safety, better refactoring, catch bugs at compile time |
| `chrome.alarms` | Reliable scheduling that survives service worker sleep |
| IndexedDB | Unlimited storage for long-term telemetry |
| DOM APIs | XSS prevention (no innerHTML with user data) |
| Vitest + fake-indexeddb | Fast, modern testing with IndexedDB support |
| No build-time bundling | Simple Chrome extension loading, source maps for debugging |

## Changelog

### v1.1.0

- **Breaking**: Requires build step (`npm run build`)
- Added: TypeScript with strict mode
- Added: Chrome Alarms API for reliable scheduling
- Added: Data retention policy (auto-purge old events)
- Added: Input validation for all user inputs
- Added: Unit tests with Vitest
- Fixed: Service worker sleeping issue (using alarms instead of setInterval)
- Fixed: Potential XSS via innerHTML (now uses DOM APIs)
- Improved: Type-safe message passing between components

### v1.0.0

- Initial release

## License

Personal use. Not intended for public distribution or Chrome Web Store publication.
