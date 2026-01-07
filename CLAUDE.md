# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Tab Killer is a Chrome extension (Manifest v3) that automatically discards memory-heavy browser tabs based on configurable site patterns and idle time. Written in TypeScript with strict type checking.

## Commands

```bash
npm run build          # Compile TypeScript and copy assets to dist/
npm run build:watch    # Watch mode for development
npm test               # Run Vitest tests
npm run test:watch     # Watch mode for tests
npm run test:coverage  # Tests with coverage report
npm run lint           # ESLint on TypeScript files
npm run lint:fix       # Auto-fix ESLint issues
npm run typecheck      # Type check without emitting
```

## Architecture

### Component Communication Flow

```
┌─────────────┐     messages      ┌──────────────────┐
│   Popup     │◄─────────────────►│  Service Worker  │
│ (popup.ts)  │                   │  (background.ts) │
└─────────────┘                   └────────┬─────────┘
                                           │
┌──────────────┐     messages              │ chrome.storage.local
│  Dashboard   │◄──────────────────────────┤ chrome.alarms
│(dashboard.ts)│                           │ chrome.tabs
└──────────────┘                           │
                                           ▼
                                  ┌──────────────────┐
                                  │    Telemetry     │
                                  │  (telemetry.ts)  │
                                  │    IndexedDB     │
                                  └──────────────────┘
```

- **background.ts**: Service worker containing core extension logic. Uses `chrome.alarms` for scheduling (survives service worker sleep). Manages tab lifecycle events and discard logic.
- **telemetry.ts**: IndexedDB wrapper with three stores (`tabEvents`, `tabMetadata`, `discardEvents`). Handles analytics and data retention.
- **types.ts**: Shared type definitions, validation helpers, and constants used across all components.
- **popup.ts / dashboard.ts**: UI components that communicate with the service worker via `chrome.runtime.sendMessage`.

### Key Design Patterns

- Configuration stored in `chrome.storage.local`, telemetry in IndexedDB
- Inter-component messaging uses typed message objects defined in `types.ts`
- All user input validation centralized in `types.ts` (`validateUrl`, `validateInterval`, etc.)

## Testing

Tests use Vitest with Chrome API mocks defined in `src/test/setup.ts`. The setup provides:
- Mocked `chrome.storage.local`, `chrome.alarms`, `chrome.tabs`, `chrome.runtime`
- `fake-indexeddb` for IndexedDB simulation
- Helper `triggerAlarm(name)` to simulate alarm events
- `resetMocks()` to clear state between tests

Run a single test file:
```bash
npx vitest src/ts/types.test.ts
```

## TypeScript Configuration

Uses very strict settings including `noUncheckedIndexedAccess`. Array/object access returns `T | undefined`, so always handle the undefined case when accessing by index or key.

## Versioning & Releases

Version is tracked in two files that **must be kept in sync**:
- `manifest.json` - Chrome reads this (source of truth)
- `package.json` - npm tooling

### Release Process

When creating a new release:

1. **Update version** in both `manifest.json` and `package.json`
2. **Ensure all checks pass**: `npm run build && npm test && npm run lint`
3. **Commit** the version bump: `git commit -am "Bump version to X.Y.Z"`
4. **Create GitHub release** with quality release notes:
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes "RELEASE_NOTES_HERE"
   ```

### Release Notes Guidelines

Write release notes that are useful to users, not a git log dump:
- Group changes by category: **Added**, **Changed**, **Fixed**, **Removed**
- Focus on user-visible changes and benefits
- Mention breaking changes prominently
- Keep it concise but informative

### Semantic Versioning

- **MAJOR** (X.0.0): Breaking changes, major rewrites
- **MINOR** (0.X.0): New features, non-breaking enhancements
- **PATCH** (0.0.X): Bug fixes, minor improvements
