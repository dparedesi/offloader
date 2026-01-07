/**
 * Service Worker for Offloader extension.
 *
 * Key improvements over original:
 * - Uses chrome.alarms API for reliable scheduling (survives service worker sleep)
 * - Strict TypeScript for type safety
 * - Automatic data retention policy
 * - Better error handling and logging
 */

import { telemetry } from './telemetry.js';
import {
  ALARM_NAME,
  DEFAULT_CONFIG,
  type DiscardedTabInfo,
  type DiscardInterval,
  type DiscardReason,
  type ExtensionConfig,
  type ExtensionMessage,
  type MessageResponse,
  RETENTION_ALARM_NAME,
  type StorageData,
  isValidDataRetentionDays,
  isValidDiscardInterval,
  isValidIdleThreshold,
} from './types.js';

// ============================================================================
// State
// ============================================================================

let config: ExtensionConfig = { ...DEFAULT_CONFIG };
let activeTabId: number | null = null;
let activeTabStartTime: number | null = null;
let telemetryFailed = false;
let sessionId: string | null = null; // Unique ID per browser session to detect tab ID reuse

// ============================================================================
// Session State Persistence (survives service worker restarts)
// ============================================================================

async function saveActiveTabState(): Promise<void> {
  try {
    await chrome.storage.session.set({
      activeTabId,
      activeTabStartTime,
      sessionId,
    });
  } catch {
    // storage.session may not be available in all contexts
  }
}

async function loadActiveTabState(): Promise<void> {
  try {
    const result = await chrome.storage.session.get(['activeTabId', 'activeTabStartTime', 'sessionId']);
    activeTabId = (result['activeTabId'] as number | null) ?? null;
    activeTabStartTime = (result['activeTabStartTime'] as number | null) ?? null;
    sessionId = (result['sessionId'] as string | null) ?? null;

    // Generate new session ID if none exists (new browser session)
    if (sessionId === null) {
      sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await chrome.storage.session.set({ sessionId });
    }
  } catch {
    // storage.session may not be available, generate session ID anyway
    if (sessionId === null) {
      sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }
}

// ============================================================================
// Initialization
// ============================================================================

async function initialize(): Promise<void> {
  // Load session state first (active tab tracking)
  await loadActiveTabState();

  // Initialize telemetry
  try {
    await telemetry.init();
    telemetryFailed = false;
  } catch (error) {
    console.error('Failed to initialize telemetry:', error);
    telemetryFailed = true;
    // Telemetry failure is logged but not fatal - core discard functionality still works
  }

  // Load configuration from storage
  await loadConfig();

  // Set up alarms if enabled
  if (config.autoDiscardEnabled) {
    await startAutoDiscard();
  }

  // Set up data retention alarm (runs daily)
  await setupRetentionAlarm();
}

async function loadConfig(): Promise<void> {
  const result = await chrome.storage.local.get([
    'autoDiscardEnabled',
    'targetSites',
    'discardInterval',
    'idleTabThreshold',
    'dataRetentionDays',
  ] satisfies (keyof StorageData)[]);

  config = {
    autoDiscardEnabled:
      (result['autoDiscardEnabled'] as boolean | undefined) ?? DEFAULT_CONFIG.autoDiscardEnabled,
    targetSites:
      (result['targetSites'] as ExtensionConfig['targetSites'] | undefined) ??
      DEFAULT_CONFIG.targetSites,
    discardInterval: isValidDiscardInterval(result['discardInterval'] as number)
      ? (result['discardInterval'] as DiscardInterval)
      : DEFAULT_CONFIG.discardInterval,
    idleTabThreshold: isValidIdleThreshold(result['idleTabThreshold'] as number)
      ? (result['idleTabThreshold'] as number)
      : DEFAULT_CONFIG.idleTabThreshold,
    dataRetentionDays: isValidDataRetentionDays(result['dataRetentionDays'] as number)
      ? (result['dataRetentionDays'] as number)
      : DEFAULT_CONFIG.dataRetentionDays,
  };
}

// ============================================================================
// Alarm Management (Reliable Scheduling)
// ============================================================================

async function startAutoDiscard(): Promise<void> {
  // Clear any existing alarm
  await chrome.alarms.clear(ALARM_NAME);

  // Create new alarm with the configured interval
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 0.1, // Run almost immediately first time
    periodInMinutes: config.discardInterval,
  });
}

async function stopAutoDiscard(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME);
}

async function setupRetentionAlarm(): Promise<void> {
  // Run data retention check once per day
  const existingAlarm = (await chrome.alarms.get(RETENTION_ALARM_NAME)) as
    | chrome.alarms.Alarm
    | undefined;
  if (!existingAlarm) {
    await chrome.alarms.create(RETENTION_ALARM_NAME, {
      delayInMinutes: 60, // First run in 1 hour
      periodInMinutes: 24 * 60, // Then daily
    });
  }
}

// Alarm listener
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void discardTargetTabs();
  } else if (alarm.name === RETENTION_ALARM_NAME) {
    void runDataRetention();
  }
});

async function runDataRetention(): Promise<void> {
  try {
    const result = await telemetry.purgeOldData(config.dataRetentionDays);
    if (result.eventsDeleted > 0 || result.discardsDeleted > 0) {
      console.warn(
        `Data retention: purged ${result.eventsDeleted} events, ${result.discardsDeleted} discard records`
      );
    }
  } catch (error) {
    console.error('Data retention failed:', error);
  }
}

// ============================================================================
// Tab Event Listeners
// ============================================================================

chrome.tabs.onCreated.addListener((tab) => {
  void handleTabCreated(tab);
});

async function handleTabCreated(tab: chrome.tabs.Tab): Promise<void> {
  if (!telemetry.isReady()) return;

  try {
    await telemetry.logTabEvent(tab.id ?? 0, 'created', {
      ...(tab.url !== undefined && { url: tab.url }),
      ...(tab.title !== undefined && { title: tab.title }),
      windowId: tab.windowId,
      index: tab.index,
      openerTabId: tab.openerTabId ?? null,
    });

    if (tab.url !== undefined && tab.url.length > 0) {
      try {
        const domain = new URL(tab.url).hostname;
        await telemetry.updateTabMetadata(tab.id ?? 0, {
          url: tab.url,
          domain,
          ...(tab.title !== undefined && { title: tab.title }),
          windowId: tab.windowId,
          openerTabId: tab.openerTabId ?? null,
          createdAt: Date.now(),
          ...(sessionId !== null && { sessionId }), // Track session to detect tab ID reuse
        });
      } catch {
        // Invalid URL, skip
      }
    }
  } catch (error) {
    console.error('Telemetry error:', error);
  }
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  void handleTabActivated(activeInfo);
});

async function handleTabActivated(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
  // Always track active tab state (even if telemetry fails)
  const previousTabId = activeTabId;
  const previousStartTime = activeTabStartTime;

  // Track new active tab
  activeTabId = activeInfo.tabId;
  activeTabStartTime = Date.now();
  void saveActiveTabState();

  if (!telemetry.isReady()) return;

  try {
    // Log previous tab's active time
    if (previousTabId !== null && previousStartTime !== null) {
      const activeTime = Date.now() - previousStartTime;

      await telemetry.logTabEvent(previousTabId, 'deactivated', { activeTime });

      const metadata = await telemetry.getTabMetadata(previousTabId);
      if (metadata !== undefined) {
        await telemetry.updateTabMetadata(previousTabId, {
          totalActiveTime: metadata.totalActiveTime + activeTime,
          lastActive: Date.now(),
        });
      }
    }

    await telemetry.logTabEvent(activeInfo.tabId, 'activated');

    // Update activation count
    const metadata = await telemetry.getTabMetadata(activeInfo.tabId);
    if (metadata !== undefined) {
      await telemetry.updateTabMetadata(activeInfo.tabId, {
        activationCount: metadata.activationCount + 1,
        lastActive: Date.now(),
      });
    }
  } catch (error) {
    console.error('Error in tab activation tracking:', error);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void handleTabUpdated(tabId, changeInfo, tab);
});

async function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): Promise<void> {
  if (!telemetry.isReady()) return;

  try {
    if (changeInfo.url !== undefined) {
      await telemetry.logTabEvent(tabId, 'updated', {
        url: changeInfo.url,
        ...(tab.title !== undefined && { title: tab.title }),
      });

      try {
        const domain = new URL(changeInfo.url).hostname;
        await telemetry.updateTabMetadata(tabId, {
          url: changeInfo.url,
          domain,
          ...(tab.title !== undefined && { title: tab.title }),
        });
      } catch {
        // Invalid URL
      }
    }

    // Track when discarded tabs are reloaded
    if (changeInfo.status === 'loading' && tab.url !== undefined) {
      const metadata = await telemetry.getTabMetadata(tabId);
      if (metadata?.wasDiscarded === true && metadata.discardedAt !== undefined) {
        await telemetry.logTabEvent(tabId, 'reloaded', {
          url: tab.url,
          timeSinceDiscard: Date.now() - (metadata.discardedAt ?? 0),
        });

        await telemetry.updateTabMetadata(tabId, {
          wasDiscarded: false,
          discardedAt: null,
        });
      }
    }
  } catch (error) {
    console.error('Error in tab update tracking:', error);
  }
}

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  void handleTabRemoved(tabId, removeInfo);
});

async function handleTabRemoved(
  tabId: number,
  removeInfo: chrome.tabs.TabRemoveInfo
): Promise<void> {
  if (!telemetry.isReady()) return;

  try {
    await telemetry.logTabEvent(tabId, 'removed', {
      windowClosing: removeInfo.isWindowClosing,
    });
  } catch (error) {
    console.error('Telemetry error:', error);
  }
}

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ): boolean => {
    void handleMessage(message, sendResponse);
    return true; // Keep channel open for async response
  }
);

async function handleMessage(
  message: ExtensionMessage,
  sendResponse: (response: MessageResponse) => void
): Promise<void> {
  try {
    switch (message.action) {
      case 'toggleAutoDiscard':
        if (message.enabled) {
          config.autoDiscardEnabled = true;
          await startAutoDiscard();
        } else {
          config.autoDiscardEnabled = false;
          await stopAutoDiscard();
        }
        sendResponse({ success: true });
        break;

      case 'updateTargetSites':
        config.targetSites = message.targetSites;
        sendResponse({ success: true });
        break;

      case 'updateInterval':
        if (isValidDiscardInterval(message.interval)) {
          config.discardInterval = message.interval;
          if (config.autoDiscardEnabled) {
            await startAutoDiscard(); // Restart with new interval
          }
        }
        sendResponse({ success: true });
        break;

      case 'updateIdleThreshold':
        if (isValidIdleThreshold(message.threshold)) {
          config.idleTabThreshold = message.threshold;
        }
        sendResponse({ success: true });
        break;

      case 'discardAll': {
        const count = await discardAllTabs();
        sendResponse({ success: true, count });
        break;
      }

      case 'exportTelemetry': {
        const data = await telemetry.exportAllData();
        sendResponse({ success: true, data });
        break;
      }

      case 'clearTelemetry':
        await telemetry.clearAllData();
        sendResponse({ success: true });
        break;

      case 'getTelemetryStats': {
        const stats = await telemetry.getStats();
        sendResponse({ success: true, stats });
        break;
      }
    }
  } catch (error) {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// ============================================================================
// Lifecycle Events
// ============================================================================

chrome.runtime.onInstalled.addListener(() => {
  void initialize();
});

chrome.runtime.onStartup.addListener(() => {
  void initialize();
});

// Also initialize on script load (for service worker restart)
void initialize();

// ============================================================================
// Tab Discarding Logic
// ============================================================================

async function discardAllTabs(): Promise<number> {
  const tabs = await chrome.tabs.query({});
  let discardedCount = 0;

  for (const tab of tabs) {
    if (shouldSkipTab(tab)) continue;

    // After shouldSkipTab, we know tab.id is defined
    const tabId = tab.id!;

    try {
      await chrome.tabs.discard(tabId);
      discardedCount++;

      if (telemetry.isReady()) {
        void telemetry.logTabEvent(tabId, 'discarded', {
          ...(tab.url !== undefined && { url: tab.url }),
          ...(tab.title !== undefined && { title: tab.title }),
          manual: true,
        });

        void telemetry.updateTabMetadata(tabId, {
          wasDiscarded: true,
          discardedAt: Date.now(),
        });
      }
    } catch (error) {
      console.error(`Failed to discard tab ${tabId}:`, error);
    }
  }

  return discardedCount;
}

async function discardTargetTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    const discardedTabs: DiscardedTabInfo[] = [];

    // Warn if idle detection is enabled but telemetry failed
    if (config.idleTabThreshold > 0 && telemetryFailed) {
      console.warn(
        'Idle tab detection is enabled but telemetry failed to initialize. ' +
          'Idle tabs will not be discarded until telemetry is available.'
      );
    }

    // Build patterns from enabled target sites
    const enabledPatterns = Object.entries(config.targetSites)
      .filter(([_, enabled]) => enabled)
      .map(([site]) => site.toLowerCase());

    const now = Date.now();
    const idleThresholdMs = config.idleTabThreshold * 60 * 60 * 1000;

    for (const tab of tabs) {
      if (shouldSkipTab(tab)) continue;
      if (tab.url === undefined) continue;

      // After shouldSkipTab, we know tab.id is defined
      const tabId = tab.id!;
      const tabUrl = tab.url;

      let shouldDiscard = false;
      let reason: DiscardReason = 'site-match';

      // Check 1: Site-specific matching
      try {
        const hostname = new URL(tabUrl).hostname.toLowerCase();
        const matchesSite = enabledPatterns.some((pattern) => hostname.includes(pattern));

        if (matchesSite) {
          shouldDiscard = true;
          reason = 'site-match';
        }
      } catch {
        continue; // Invalid URL
      }

      // Check 2: Idle tab threshold (requires telemetry for lastActive tracking)
      if (!shouldDiscard && config.idleTabThreshold > 0) {
        if (telemetry.isReady()) {
          const metadata = await telemetry.getTabMetadata(tabId);
          if (metadata?.lastActive !== undefined) {
            const idleTime = now - metadata.lastActive;
            if (idleTime > idleThresholdMs) {
              shouldDiscard = true;
              reason = 'idle';
            }
          }
        } else if (telemetryFailed) {
          // Log once per discard cycle that idle detection is unavailable
          // (telemetryFailed flag prevents repeated warnings)
        }
      }

      if (shouldDiscard) {
        try {
          await chrome.tabs.discard(tabId);

          const domain = new URL(tabUrl).hostname;
          discardedTabs.push({
            url: tabUrl,
            domain,
            title: tab.title ?? 'Untitled',
            timeSinceLastActive: null,
            reason,
          });

          if (telemetry.isReady()) {
            void telemetry.logTabEvent(tabId, 'discarded', {
              url: tabUrl,
              ...(tab.title !== undefined && { title: tab.title }),
              reason,
            });

            void telemetry.updateTabMetadata(tabId, {
              wasDiscarded: true,
              discardedAt: Date.now(),
            });
          }
        } catch (error) {
          console.error(`Failed to discard tab ${tabId}:`, error);
        }
      }
    }

    // Log batch discard event
    if (discardedTabs.length > 0 && telemetry.isReady()) {
      void telemetry.logDiscardEvent(discardedTabs, tabs.length);
    }

    // Store last run info
    await chrome.storage.local.set({
      lastRun: Date.now(),
      lastDiscardedCount: discardedTabs.length,
    } satisfies Partial<StorageData>);
  } catch (error) {
    console.error('Error discarding tabs:', error);
  }
}

function shouldSkipTab(tab: chrome.tabs.Tab): boolean {
  // Skip if already discarded or is the active tab
  if (tab.discarded === true || tab.active === true) return true;

  // Skip if no URL or no tab ID
  if (tab.url === undefined || tab.id === undefined) return true;

  // Skip Chrome internal pages and extension pages
  const skipPrefixes = ['chrome://', 'chrome-extension://', 'chrome-untrusted://'];
  return skipPrefixes.some((prefix) => tab.url!.startsWith(prefix));
}

// Export for testing
export { initialize, discardTargetTabs, discardAllTabs, shouldSkipTab };
