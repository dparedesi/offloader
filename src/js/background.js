// Import telemetry
importScripts('telemetry.js');

let autoDiscardTimer = null;
let discardInterval = 10; // minutes
let idleTabThreshold = 24; // hours
let targetSites = {
  sharepoint: true,
  slack: true,
  asana: true,
  quicksight: true
};

// Track active tab times
let activeTabId = null;
let activeTabStartTime = null;

// Initialize telemetry
telemetry.init().then(() => {
  console.log('Telemetry initialized');
});

// Initialize auto-discard on service worker start
(async function initAutoDiscard() {
  const result = await chrome.storage.local.get(['autoDiscardEnabled', 'targetSites', 'discardInterval', 'idleTabThreshold']);
  const isEnabled = result.autoDiscardEnabled !== false; // Default to true
  targetSites = result.targetSites || targetSites;
  discardInterval = result.discardInterval || 10;
  idleTabThreshold = result.idleTabThreshold || 24; // Default 24 hours
  
  console.log('Extension initialized:', { isEnabled, targetSites, discardInterval, idleTabThreshold });
  
  if (isEnabled) {
    startAutoDiscard();
  }
})();

// Listen for tab creation
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!telemetry.db) return;
  
  try {
    await telemetry.logTabEvent(tab.id, 'created', {
      url: tab.url,
      title: tab.title,
      windowId: tab.windowId,
      index: tab.index,
      openerTabId: tab.openerTabId || null
    });
    
    if (tab.url) {
      try {
        const domain = new URL(tab.url).hostname;
        await telemetry.updateTabMetadata(tab.id, {
          url: tab.url,
          domain,
          title: tab.title,
          windowId: tab.windowId,
          openerTabId: tab.openerTabId || null,
          createdAt: Date.now(),
          activationCount: 0,
          totalActiveTime: 0
        });
      } catch (e) {
        // Invalid URL
      }
    }
  } catch (e) {
    console.error('Telemetry error:', e);
  }
});

// Listen for tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!telemetry.db) return;
  
  try {
    // Log previous tab's active time
    if (activeTabId !== null && activeTabStartTime !== null) {
      const activeTime = Date.now() - activeTabStartTime;
      await telemetry.logTabEvent(activeTabId, 'deactivated', {
        activeTime
      });
      
      // Update total active time
      const transaction = telemetry.db.transaction(['tabMetadata'], 'readwrite');
      const store = transaction.objectStore('tabMetadata');
      const getRequest = store.get(activeTabId);
      
      getRequest.onsuccess = () => {
        const metadata = getRequest.result;
        if (metadata) {
          metadata.totalActiveTime = (metadata.totalActiveTime || 0) + activeTime;
          metadata.lastActive = Date.now();
          store.put(metadata);
        }
      };
    }
    
    // Log new tab activation
    activeTabId = activeInfo.tabId;
    activeTabStartTime = Date.now();
    
    await telemetry.logTabEvent(activeInfo.tabId, 'activated');
    
    // Update activation count
    const transaction = telemetry.db.transaction(['tabMetadata'], 'readwrite');
    const store = transaction.objectStore('tabMetadata');
    const getRequest = store.get(activeInfo.tabId);
    
    getRequest.onsuccess = () => {
      const metadata = getRequest.result;
      if (metadata) {
        metadata.activationCount = (metadata.activationCount || 0) + 1;
        metadata.lastActive = Date.now();
        store.put(metadata);
      }
    };
  } catch (e) {
    console.error('Error in tab activation tracking:', e);
  }
});

// Listen for tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!telemetry.db) return;
  
  try {
    if (changeInfo.url) {
      await telemetry.logTabEvent(tabId, 'updated', {
        url: changeInfo.url,
        title: tab.title
      });
      
      try {
        const domain = new URL(changeInfo.url).hostname;
        await telemetry.updateTabMetadata(tabId, {
          url: changeInfo.url,
          domain,
          title: tab.title
        });
      } catch (e) {
        // Invalid URL
      }
    }
    
    // Track when discarded tabs are reloaded
    if (changeInfo.status === 'loading' && tab.url) {
      const transaction = telemetry.db.transaction(['tabMetadata'], 'readonly');
      const store = transaction.objectStore('tabMetadata');
      const getRequest = store.get(tabId);
      
      getRequest.onsuccess = () => {
        const metadata = getRequest.result;
        if (metadata && metadata.wasDiscarded) {
          telemetry.logTabEvent(tabId, 'reloaded', {
            url: tab.url,
            timeSinceDiscard: Date.now() - metadata.discardedAt
          });
          
          // Clear discard flag
          metadata.wasDiscarded = false;
          metadata.discardedAt = null;
          const transaction2 = telemetry.db.transaction(['tabMetadata'], 'readwrite');
          transaction2.objectStore('tabMetadata').put(metadata);
        }
      };
    }
  } catch (e) {
    console.error('Error in tab update tracking:', e);
  }
});

// Listen for tab removal
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (!telemetry.db) return;
  
  try {
    await telemetry.logTabEvent(tabId, 'removed', {
      windowClosing: removeInfo.windowClosing
    });
  } catch (e) {
    console.error('Telemetry error:', e);
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggleAutoDiscard') {
    if (message.enabled) {
      startAutoDiscard();
    } else {
      stopAutoDiscard();
    }
  } else if (message.action === 'updateTargetSites') {
    targetSites = message.targetSites;
  } else if (message.action === 'updateInterval') {
    discardInterval = message.interval;
    // Restart timer with new interval if currently running
    if (autoDiscardTimer) {
      startAutoDiscard();
    }
  } else if (message.action === 'updateIdleThreshold') {
    idleTabThreshold = message.threshold;
  } else if (message.action === 'discardAll') {
    discardAllTabs().then(count => {
      sendResponse({ success: true, count });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep channel open for async response
  } else if (message.action === 'exportTelemetry') {
    telemetry.exportAllData().then(data => {
      sendResponse({ success: true, data });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep channel open for async response
  } else if (message.action === 'clearTelemetry') {
    telemetry.clearAllData().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (message.action === 'getTelemetryStats') {
    telemetry.getStats().then(stats => {
      sendResponse({ success: true, stats });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});

// Initialize on extension load
chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get(['autoDiscardEnabled', 'targetSites', 'discardInterval', 'idleTabThreshold']);
  const isEnabled = result.autoDiscardEnabled !== false; // Default to true
  targetSites = result.targetSites || targetSites;
  discardInterval = result.discardInterval || 10;
  idleTabThreshold = result.idleTabThreshold || 24;
  
  if (isEnabled) {
    startAutoDiscard();
  }
});

// Also check on startup
chrome.runtime.onStartup.addListener(async () => {
  const result = await chrome.storage.local.get(['autoDiscardEnabled', 'targetSites', 'discardInterval', 'idleTabThreshold']);
  const isEnabled = result.autoDiscardEnabled !== false;
  targetSites = result.targetSites || targetSites;
  discardInterval = result.discardInterval || 10;
  idleTabThreshold = result.idleTabThreshold || 24;
  
  if (isEnabled) {
    startAutoDiscard();
  }
});

function startAutoDiscard() {
  console.log(`Auto-discard enabled (every ${discardInterval} minutes)`);
  
  // Clear any existing timer
  if (autoDiscardTimer) {
    clearInterval(autoDiscardTimer);
  }
  
  // Set up new timer
  const intervalMs = discardInterval * 60 * 1000;
  autoDiscardTimer = setInterval(() => {
    console.log('Auto-discard timer triggered');
    discardTargetTabs();
  }, intervalMs);
  
  // Run once immediately
  discardTargetTabs();
}

function stopAutoDiscard() {
  console.log('Auto-discard disabled');
  
  if (autoDiscardTimer) {
    clearInterval(autoDiscardTimer);
    autoDiscardTimer = null;
  }
}

async function discardAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    let discardedCount = 0;
    
    for (const tab of tabs) {
      // Skip if:
      // - Already discarded
      // - Active tab
      // - Extension page (chrome-extension://)
      // - Chrome internal pages (chrome://, chrome-untrusted://)
      if (tab.discarded || tab.active) continue;
      if (!tab.url) continue;
      if (tab.url.startsWith('chrome-extension://')) continue;
      if (tab.url.startsWith('chrome://')) continue;
      if (tab.url.startsWith('chrome-untrusted://')) continue;
      
      try {
        await chrome.tabs.discard(tab.id);
        discardedCount++;
        console.log(`Discarded: ${tab.title}`);
        
        // Log to telemetry
        if (telemetry.db) {
          telemetry.logTabEvent(tab.id, 'discarded', {
            url: tab.url,
            title: tab.title,
            manual: true
          }).catch(e => console.error('Telemetry error:', e));
          
          telemetry.updateTabMetadata(tab.id, {
            wasDiscarded: true,
            discardedAt: Date.now()
          }).catch(e => console.error('Telemetry error:', e));
        }
      } catch (error) {
        console.error(`Failed to discard tab ${tab.id}:`, error);
      }
    }
    
    console.log(`Discard All: Discarded ${discardedCount} tabs`);
    return discardedCount;
  } catch (error) {
    console.error('Error in discard all:', error);
    throw error;
  }
}

async function discardTargetTabs() {
  try {
    // Get all tabs
    const tabs = await chrome.tabs.query({});
    
    let discardedCount = 0;
    const discardedTabs = [];
    const urlPatterns = [];
    
    // Build list of patterns to check based on enabled sites
    Object.entries(targetSites).forEach(([site, enabled]) => {
      if (enabled) {
        urlPatterns.push({ pattern: site.toLowerCase(), domain: true });
      }
    });
    
    const now = Date.now();
    const idleThresholdMs = idleTabThreshold * 60 * 60 * 1000; // Convert hours to ms
    
    for (const tab of tabs) {
      if (!tab.url) continue;
      
      let shouldDiscard = false;
      let reason = '';
      
      // Check 1: Site-specific matching
      try {
        const url = new URL(tab.url);
        const hostname = url.hostname.toLowerCase();
        
        // Check if any pattern matches the hostname
        const matchesSite = urlPatterns.some(({ pattern }) => {
          return hostname.includes(pattern);
        });
        
        if (matchesSite) {
          shouldDiscard = true;
          reason = 'site-match';
        }
      } catch (e) {
        // Invalid URL, skip
        continue;
      }
      
      // Check 2: Idle tab threshold (if not already marked for discard)
      if (!shouldDiscard && idleTabThreshold > 0 && telemetry.db) {
        try {
          const transaction = telemetry.db.transaction(['tabMetadata'], 'readonly');
          const store = transaction.objectStore('tabMetadata');
          const getRequest = store.get(tab.id);
          
          await new Promise((resolve) => {
            getRequest.onsuccess = () => {
              const metadata = getRequest.result;
              if (metadata && metadata.lastActive) {
                const idleTime = now - metadata.lastActive;
                if (idleTime > idleThresholdMs) {
                  shouldDiscard = true;
                  reason = 'idle';
                }
              }
              resolve();
            };
            getRequest.onerror = () => resolve();
          });
        } catch (e) {
          // Ignore telemetry errors
        }
      }
      
      if (shouldDiscard) {
        // Don't discard if it's already discarded, active, or pinned
        if (!tab.discarded && !tab.active) {
          try {
            await chrome.tabs.discard(tab.id);
            discardedCount++;
            
            discardedTabs.push({
              url: tab.url,
              title: tab.title,
              timeSinceLastActive: null,
              reason: reason
            });
            
            console.log(`Discarded tab (${reason}): ${tab.title} (${tab.url})`);
            
            // Log to telemetry (non-blocking, fire and forget)
            if (telemetry.db) {
              telemetry.logTabEvent(tab.id, 'discarded', {
                url: tab.url,
                title: tab.title,
                reason: reason
              }).catch(e => console.error('Telemetry error:', e));
              
              telemetry.updateTabMetadata(tab.id, {
                wasDiscarded: true,
                discardedAt: Date.now()
              }).catch(e => console.error('Telemetry error:', e));
            }
          } catch (error) {
            console.error(`Failed to discard tab ${tab.id}:`, error);
          }
        }
      }
    }
    
    console.log(`Chrome Tab Killer: Discarded ${discardedCount} tabs`);
    
    // Log discard event to telemetry (non-blocking)
    if (discardedTabs.length > 0 && telemetry.db) {
      telemetry.logDiscardEvent(discardedTabs, tabs.length)
        .catch(e => console.error('Telemetry error:', e));
    }
    
    // Store the result
    chrome.storage.local.set({ 
      lastRun: Date.now(),
      lastDiscardedCount: discardedCount 
    });
    
  } catch (error) {
    console.error('Error discarding tabs:', error);
  }
}

// Run once on extension load (for testing)
console.log('Chrome Tab Killer extension loaded');
