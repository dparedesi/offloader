/**
 * Telemetry system for tracking tab behavior.
 * All data is stored locally in IndexedDB and never transmitted.
 *
 * Features:
 * - Tab lifecycle event logging
 * - Tab metadata tracking (active time, activation count)
 * - Discard event aggregation
 * - Automatic data retention (purge old events)
 * - Full data export for user transparency
 */

import type {
  DiscardedTabInfo,
  DiscardEvent,
  ExportedData,
  TabEvent,
  TabEventType,
  TabMetadata,
  TelemetryStats,
} from './types.js';

const DB_NAME = 'TabTelemetryDB';
const DB_VERSION = 2; // Bumped for schema changes

type ObjectStoreName = 'tabEvents' | 'tabMetadata' | 'discardEvents';

class TabTelemetry {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the IndexedDB connection.
   * Safe to call multiple times - will reuse existing connection.
   */
  async init(): Promise<void> {
    if (this.db !== null) {
      return;
    }

    if (this.initPromise !== null) {
      return this.initPromise;
    }

    this.initPromise = this.openDatabase();
    return this.initPromise;
  }

  private async openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (): void => {
        this.initPromise = null;
        reject(new Error(`Failed to open database: ${request.error?.message ?? 'Unknown error'}`));
      };

      request.onsuccess = (): void => {
        this.db = request.result;

        // Handle connection loss
        this.db.onclose = (): void => {
          this.db = null;
          this.initPromise = null;
        };

        resolve();
      };

      request.onupgradeneeded = (event: IDBVersionChangeEvent): void => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createObjectStores(db);
      };
    });
  }

  private createObjectStores(db: IDBDatabase): void {
    // Store for individual tab events
    if (!db.objectStoreNames.contains('tabEvents')) {
      const tabEvents = db.createObjectStore('tabEvents', {
        keyPath: 'id',
        autoIncrement: true,
      });
      tabEvents.createIndex('tabId', 'tabId', { unique: false });
      tabEvents.createIndex('timestamp', 'timestamp', { unique: false });
      tabEvents.createIndex('eventType', 'eventType', { unique: false });
    }

    // Store for per-tab aggregate metadata
    if (!db.objectStoreNames.contains('tabMetadata')) {
      const tabMetadata = db.createObjectStore('tabMetadata', { keyPath: 'tabId' });
      tabMetadata.createIndex('url', 'url', { unique: false });
      tabMetadata.createIndex('domain', 'domain', { unique: false });
      tabMetadata.createIndex('lastActive', 'lastActive', { unique: false });
    }

    // Store for batch discard events
    if (!db.objectStoreNames.contains('discardEvents')) {
      const discardEvents = db.createObjectStore('discardEvents', {
        keyPath: 'id',
        autoIncrement: true,
      });
      discardEvents.createIndex('timestamp', 'timestamp', { unique: false });
    }
  }

  /**
   * Check if the database is ready for operations.
   */
  isReady(): boolean {
    return this.db !== null;
  }

  /**
   * Log a tab lifecycle event.
   */
  async logTabEvent(
    tabId: number,
    eventType: TabEventType,
    data: Partial<Omit<TabEvent, 'id' | 'tabId' | 'eventType' | 'timestamp'>> = {}
  ): Promise<number | undefined> {
    if (this.db === null) {
      console.warn('Telemetry DB not initialized, skipping event');
      return undefined;
    }

    const event: Omit<TabEvent, 'id'> = {
      tabId,
      eventType,
      timestamp: Date.now(),
      ...data,
    };

    return this.addToStore('tabEvents', event);
  }

  /**
   * Update or create tab metadata.
   * Merges with existing data if present.
   */
  async updateTabMetadata(
    tabId: number,
    metadata: Partial<Omit<TabMetadata, 'tabId'>>
  ): Promise<void> {
    if (this.db === null) {
      console.warn('Telemetry DB not initialized, skipping metadata update');
      return;
    }

    try {
      const transaction = this.db.transaction(['tabMetadata'], 'readwrite');
      const store = transaction.objectStore('tabMetadata');

      const existing = await this.promisifyRequest<TabMetadata | undefined>(store.get(tabId));

      const updated: TabMetadata = {
        tabId,
        activationCount: 0,
        totalActiveTime: 0,
        wasDiscarded: false,
        ...existing,
        ...metadata,
        lastUpdated: Date.now(),
      };

      await this.promisifyRequest(store.put(updated));
    } catch (error) {
      console.error('Error updating tab metadata:', error);
    }
  }

  /**
   * Get metadata for a specific tab.
   */
  async getTabMetadata(tabId: number): Promise<TabMetadata | undefined> {
    if (this.db === null) {
      return undefined;
    }

    try {
      const transaction = this.db.transaction(['tabMetadata'], 'readonly');
      const store = transaction.objectStore('tabMetadata');
      return await this.promisifyRequest<TabMetadata | undefined>(store.get(tabId));
    } catch (error) {
      console.error('Error getting tab metadata:', error);
      return undefined;
    }
  }

  /**
   * Log a batch discard event.
   */
  async logDiscardEvent(discardedTabs: DiscardedTabInfo[], totalTabs: number): Promise<void> {
    if (this.db === null) {
      console.warn('Telemetry DB not initialized, skipping discard event');
      return;
    }

    const event: Omit<DiscardEvent, 'id'> = {
      timestamp: Date.now(),
      discardedCount: discardedTabs.length,
      totalTabs,
      tabs: discardedTabs,
    };

    await this.addToStore('discardEvents', event);
  }

  /**
   * Export all telemetry data for user download.
   */
  async exportAllData(): Promise<ExportedData> {
    await this.init();

    if (this.db === null) {
      throw new Error('Database not available');
    }

    const data: ExportedData = {
      exportDate: new Date().toISOString(),
      tabEvents: [],
      tabMetadata: [],
      discardEvents: [],
    };

    data.tabEvents = await this.getAllFromStore<TabEvent>('tabEvents');
    data.tabMetadata = await this.getAllFromStore<TabMetadata>('tabMetadata');
    data.discardEvents = await this.getAllFromStore<DiscardEvent>('discardEvents');

    return data;
  }

  /**
   * Clear all telemetry data.
   */
  async clearAllData(): Promise<void> {
    await this.init();

    if (this.db === null) {
      throw new Error('Database not available');
    }

    const stores: ObjectStoreName[] = ['tabEvents', 'tabMetadata', 'discardEvents'];

    for (const storeName of stores) {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      await this.promisifyRequest(store.clear());
    }
  }

  /**
   * Get aggregate statistics.
   */
  async getStats(): Promise<TelemetryStats> {
    await this.init();

    if (this.db === null) {
      return { totalEvents: 0, totalTabs: 0, totalDiscards: 0 };
    }

    const stats: TelemetryStats = {
      totalEvents: 0,
      totalTabs: 0,
      totalDiscards: 0,
    };

    stats.totalEvents = await this.countStore('tabEvents');
    stats.totalTabs = await this.countStore('tabMetadata');
    stats.totalDiscards = await this.countStore('discardEvents');

    return stats;
  }

  /**
   * Purge events older than the specified number of days.
   * This is the data retention policy implementation.
   */
  async purgeOldData(retentionDays: number): Promise<{ eventsDeleted: number; discardsDeleted: number }> {
    await this.init();

    if (this.db === null) {
      return { eventsDeleted: 0, discardsDeleted: 0 };
    }

    const cutoffTimestamp = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let eventsDeleted = 0;
    let discardsDeleted = 0;

    // Purge old tab events
    eventsDeleted = await this.deleteOlderThan('tabEvents', cutoffTimestamp);

    // Purge old discard events
    discardsDeleted = await this.deleteOlderThan('discardEvents', cutoffTimestamp);

    // Note: We don't purge tabMetadata as it's keyed by tabId, not timestamp
    // Old metadata will naturally be replaced when tabs are reused

    return { eventsDeleted, discardsDeleted };
  }

  /**
   * Delete records older than the specified timestamp.
   */
  private async deleteOlderThan(storeName: ObjectStoreName, cutoffTimestamp: number): Promise<number> {
    if (this.db === null) {
      return 0;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(cutoffTimestamp);
      const request = index.openCursor(range);

      let deleted = 0;

      request.onsuccess = (event): void => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor !== null) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          resolve(deleted);
        }
      };

      request.onerror = (): void => {
        reject(new Error(`Failed to delete old records from ${storeName}`));
      };
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private async addToStore<T>(storeName: ObjectStoreName, data: T): Promise<number | undefined> {
    if (this.db === null) {
      return undefined;
    }

    try {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const result = await this.promisifyRequest<IDBValidKey>(store.add(data));
      return typeof result === 'number' ? result : undefined;
    } catch (error) {
      console.error(`Error adding to ${storeName}:`, error);
      return undefined;
    }
  }

  private async getAllFromStore<T>(storeName: ObjectStoreName): Promise<T[]> {
    if (this.db === null) {
      return [];
    }

    const transaction = this.db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    return await this.promisifyRequest<T[]>(store.getAll());
  }

  private async countStore(storeName: ObjectStoreName): Promise<number> {
    if (this.db === null) {
      return 0;
    }

    const transaction = this.db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    return await this.promisifyRequest<number>(store.count());
  }

  private promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = (): void => resolve(request.result);
      request.onerror = (): void => reject(request.error);
    });
  }
}

// Export singleton instance
export const telemetry = new TabTelemetry();
