// Telemetry system for tracking tab behavior
// This data is stored locally and never transmitted

class TabTelemetry {
  constructor() {
    this.dbName = 'TabTelemetryDB';
    this.dbVersion = 1;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Store for tab events
        if (!db.objectStoreNames.contains('tabEvents')) {
          const tabEvents = db.createObjectStore('tabEvents', { keyPath: 'id', autoIncrement: true });
          tabEvents.createIndex('tabId', 'tabId', { unique: false });
          tabEvents.createIndex('timestamp', 'timestamp', { unique: false });
          tabEvents.createIndex('eventType', 'eventType', { unique: false });
        }
        
        // Store for tab metadata
        if (!db.objectStoreNames.contains('tabMetadata')) {
          const tabMetadata = db.createObjectStore('tabMetadata', { keyPath: 'tabId' });
          tabMetadata.createIndex('url', 'url', { unique: false });
          tabMetadata.createIndex('domain', 'domain', { unique: false });
        }
        
        // Store for discard events
        if (!db.objectStoreNames.contains('discardEvents')) {
          const discardEvents = db.createObjectStore('discardEvents', { keyPath: 'id', autoIncrement: true });
          discardEvents.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async logTabEvent(tabId, eventType, data = {}) {
    if (!this.db) {
      console.warn('Telemetry DB not initialized, skipping event');
      return;
    }
    
    try {
      const transaction = this.db.transaction(['tabEvents'], 'readwrite');
      const store = transaction.objectStore('tabEvents');
      
      const event = {
        tabId,
        eventType, // 'created', 'activated', 'updated', 'removed', 'discarded', 'reloaded'
        timestamp: Date.now(),
        ...data
      };
      
      return new Promise((resolve, reject) => {
        const request = store.add(event);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error('Error logging tab event:', e);
    }
  }

  async updateTabMetadata(tabId, metadata) {
    if (!this.db) {
      console.warn('Telemetry DB not initialized, skipping metadata update');
      return;
    }
    
    try {
      const transaction = this.db.transaction(['tabMetadata'], 'readwrite');
      const store = transaction.objectStore('tabMetadata');
      
      // Get existing metadata
      const getRequest = store.get(tabId);
      
      return new Promise((resolve, reject) => {
        getRequest.onsuccess = () => {
          const existing = getRequest.result || { tabId };
          const updated = {
            ...existing,
            ...metadata,
            lastUpdated: Date.now()
          };
          
          const putRequest = store.put(updated);
          putRequest.onsuccess = () => resolve(putRequest.result);
          putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
      });
    } catch (e) {
      console.error('Error updating tab metadata:', e);
    }
  }

  async logDiscardEvent(discardedTabs, totalTabs) {
    if (!this.db) {
      console.warn('Telemetry DB not initialized, skipping discard event');
      return;
    }
    
    try {
      const transaction = this.db.transaction(['discardEvents'], 'readwrite');
      const store = transaction.objectStore('discardEvents');
      
      const event = {
        timestamp: Date.now(),
        discardedCount: discardedTabs.length,
        totalTabs,
        tabs: discardedTabs.map(tab => ({
          url: tab.url,
          domain: new URL(tab.url).hostname,
          title: tab.title,
          timeSinceLastActive: tab.timeSinceLastActive || null
        }))
      };
      
      return new Promise((resolve, reject) => {
        const request = store.add(event);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error('Error logging discard event:', e);
    }
  }

  async exportAllData() {
    if (!this.db) {
      await this.init();
    }
    
    const data = {
      exportDate: new Date().toISOString(),
      tabEvents: [],
      tabMetadata: [],
      discardEvents: []
    };
    
    // Export tab events
    await new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['tabEvents'], 'readonly');
      const store = transaction.objectStore('tabEvents');
      const request = store.getAll();
      
      request.onsuccess = () => {
        data.tabEvents = request.result;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    
    // Export tab metadata
    await new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['tabMetadata'], 'readonly');
      const store = transaction.objectStore('tabMetadata');
      const request = store.getAll();
      
      request.onsuccess = () => {
        data.tabMetadata = request.result;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    
    // Export discard events
    await new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['discardEvents'], 'readonly');
      const store = transaction.objectStore('discardEvents');
      const request = store.getAll();
      
      request.onsuccess = () => {
        data.discardEvents = request.result;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    
    return data;
  }

  async clearAllData() {
    if (!this.db) {
      await this.init();
    }
    
    const stores = ['tabEvents', 'tabMetadata', 'discardEvents'];
    
    for (const storeName of stores) {
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }

  async getStats() {
    if (!this.db) {
      await this.init();
    }
    
    const stats = {
      totalEvents: 0,
      totalTabs: 0,
      totalDiscards: 0
    };
    
    // Count events
    await new Promise((resolve) => {
      const transaction = this.db.transaction(['tabEvents'], 'readonly');
      const store = transaction.objectStore('tabEvents');
      const request = store.count();
      request.onsuccess = () => {
        stats.totalEvents = request.result;
        resolve();
      };
    });
    
    // Count tabs
    await new Promise((resolve) => {
      const transaction = this.db.transaction(['tabMetadata'], 'readonly');
      const store = transaction.objectStore('tabMetadata');
      const request = store.count();
      request.onsuccess = () => {
        stats.totalTabs = request.result;
        resolve();
      };
    });
    
    // Count discards
    await new Promise((resolve) => {
      const transaction = this.db.transaction(['discardEvents'], 'readonly');
      const store = transaction.objectStore('discardEvents');
      const request = store.count();
      request.onsuccess = () => {
        stats.totalDiscards = request.result;
        resolve();
      };
    });
    
    return stats;
  }
}

// Export singleton instance
const telemetry = new TabTelemetry();
