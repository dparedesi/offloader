/**
 * Service Worker for Chrome Tab Killer extension.
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
  type TargetSites,
  isValidDiscardInterval,
  isValidIdleThreshold,
} from './types.js';

// ============================================================================
// State
// ============================================================================

let config: ExtensionConfig = { ...DEFAULT_CONFIG };
let activeTabId: number | null = null;
let activeTabStartTime: number | null = null;

// ============================================================================
// Initialization
// ============================================================================

async function initialize(): Promise<void> {
  // Initialize telemetry
  try {
    await telemetry.init();
  } catch (error) {
    console.error('Failed to initialize telemetry:', error);
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
    autoDiscardEnabled: result['autoDiscardEnabled'] ?? DEFAULT_CONFIG.autoDiscardEnabled,
    targetSites: result['targetSites'] ?? DEFAULT_CONFIG.targetSites,
    discardInterval: isValidDiscardInterval(result['discardInterval'] as number)
      ? (result['discardInterval'] as DiscardInterval)
      : DEFAULT_CONFIG.discardInterval,
    idleTabThreshold: isValidIdleThreshold(result['idleTabThreshold'] as number)
      ? (result['idleTabThreshold'] as number)
      : DEFAULT_CONFIG.idleTabThreshold,
    dataRetentionDays: result['dataRetentionDays'] ?? DEFAULT_CONFIG.dataRetentionDays,
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
  const existingAlarm = await chrome.alarms.get(RETENTION_ALARM_NAME);
  if (existingAlarm === undefined) {
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
  if (!telemetry.isReady()) return;

  try {
    // Log previous tab's active time
    if (activeTabId !== null && activeTabStartTime !== null) {
      const activeTime = Date.now() - activeTabStartTime;

      await telemetry.logTabEvent(activeTabId, 'deactivated', { activeTime });

      const metadata = await telemetry.getTabMetadata(activeTabId);
      if (metadata !== undefined) {
        await telemetry.updateTabMetadata(activeTabId, {
          totalActiveTime: (metadata.totalActiveTime ?? 0) + activeTime,
          lastActive: Date.now(),
        });
      }
    }

    // Track new active tab
    activeTabId = activeInfo.tabId;
    activeTabStartTime = Date.now();

    await telemetry.logTabEvent(activeInfo.tabId, 'activated');

    // Update activation count
    const metadata = await telemetry.getTabMetadata(activeInfo.tabId);
    if (metadata !== undefined) {
      await telemetry.updateTabMetadata(activeInfo.tabId, {
        activationCount: (metadata.activationCount ?? 0) + 1,
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

    try {
      await chrome.tabs.discard(tab.id!);
      discardedCount++;

      if (telemetry.isReady()) {
        void telemetry.logTabEvent(tab.id!, 'discarded', {
          ...(tab.url !== undefined && { url: tab.url }),
          ...(tab.title !== undefined && { title: tab.title }),
          manual: true,
        });

        void telemetry.updateTabMetadata(tab.id!, {
          wasDiscarded: true,
          discardedAt: Date.now(),
        });
      }
    } catch (error) {
      console.error(`Failed to discard tab ${tab.id ?? 'unknown'}:`, error);
    }
  }

  return discardedCount;
}

async function discardTargetTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    const discardedTabs: DiscardedTabInfo[] = [];

    // Build patterns from enabled target sites
    const enabledPatterns = Object.entries(config.targetSites)
      .filter(([_, enabled]) => enabled)
      .map(([site]) => site.toLowerCase());

    const now = Date.now();
    const idleThresholdMs = config.idleTabThreshold * 60 * 60 * 1000;

    for (const tab of tabs) {
      if (shouldSkipTab(tab)) continue;
      if (tab.url === undefined) continue;

      let shouldDiscard = false;
      let reason: DiscardReason = 'site-match';

      // Check 1: Site-specific matching
      try {
        const hostname = new URL(tab.url).hostname.toLowerCase();
        const matchesSite = enabledPatterns.some((pattern) => hostname.includes(pattern));

        if (matchesSite) {
          shouldDiscard = true;
          reason = 'site-match';
        }
      } catch {
        continue; // Invalid URL
      }

      // Check 2: Idle tab threshold
      if (!shouldDiscard && config.idleTabThreshold > 0 && telemetry.isReady()) {
        const metadata = await telemetry.getTabMetadata(tab.id!);
        if (metadata?.lastActive !== undefined) {
          const idleTime = now - metadata.lastActive;
          if (idleTime > idleThresholdMs) {
            shouldDiscard = true;
            reason = 'idle';
          }
        }
      }

      if (shouldDiscard) {
        try {
          await chrome.tabs.discard(tab.id!);

          const domain = new URL(tab.url).hostname;
          discardedTabs.push({
            url: tab.url,
            domain,
            title: tab.title ?? 'Untitled',
            timeSinceLastActive: null,
            reason,
          });

          if (telemetry.isReady()) {
            void telemetry.logTabEvent(tab.id!, 'discarded', {
              url: tab.url,
              ...(tab.title !== undefined && { title: tab.title }),
              reason,
            });

            void telemetry.updateTabMetadata(tab.id!, {
              wasDiscarded: true,
              discardedAt: Date.now(),
            });
          }
        } catch (error) {
          console.error(`Failed to discard tab ${tab.id ?? 'unknown'}:`, error);
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

// ============================================================================
// Utility Functions
// ============================================================================

function isTargetSite(hostname: string, targetSites: TargetSites): boolean {
  const enabledPatterns = Object.entries(targetSites)
    .filter(([_, enabled]) => enabled)
    .map(([site]) => site.toLowerCase());

  return enabledPatterns.some((pattern) => hostname.includes(pattern));
}

// Export for testing
export { initialize, discardTargetTabs, discardAllTabs, shouldSkipTab, isTargetSite };
