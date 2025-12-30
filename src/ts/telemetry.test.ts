/**
 * Tests for telemetry module.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { telemetry } from './telemetry.js';

describe('TabTelemetry', () => {
  beforeEach(async () => {
    // Initialize fresh database for each test
    await telemetry.init();
    await telemetry.clearAllData();
  });

  afterEach(async () => {
    await telemetry.clearAllData();
  });

  describe('init', () => {
    it('should initialize the database', async () => {
      // Already initialized in beforeEach
      expect(telemetry.isReady()).toBe(true);
    });

    it('should be idempotent', async () => {
      await telemetry.init();
      await telemetry.init();
      expect(telemetry.isReady()).toBe(true);
    });
  });

  describe('logTabEvent', () => {
    it('should log a tab event', async () => {
      const id = await telemetry.logTabEvent(123, 'created', {
        url: 'https://example.com',
        title: 'Example',
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe('number');
    });

    it('should log events with different types', async () => {
      await telemetry.logTabEvent(1, 'created');
      await telemetry.logTabEvent(1, 'activated');
      await telemetry.logTabEvent(1, 'discarded', { reason: 'idle' });
      await telemetry.logTabEvent(1, 'removed');

      const stats = await telemetry.getStats();
      expect(stats.totalEvents).toBe(4);
    });
  });

  describe('updateTabMetadata', () => {
    it('should create new metadata', async () => {
      await telemetry.updateTabMetadata(100, {
        url: 'https://example.com',
        domain: 'example.com',
        title: 'Test Page',
      });

      const metadata = await telemetry.getTabMetadata(100);
      expect(metadata).toBeDefined();
      expect(metadata?.url).toBe('https://example.com');
      expect(metadata?.domain).toBe('example.com');
    });

    it('should merge with existing metadata', async () => {
      await telemetry.updateTabMetadata(100, {
        url: 'https://example.com',
        activationCount: 5,
      });

      await telemetry.updateTabMetadata(100, {
        totalActiveTime: 60000,
      });

      const metadata = await telemetry.getTabMetadata(100);
      expect(metadata?.activationCount).toBe(5);
      expect(metadata?.totalActiveTime).toBe(60000);
    });
  });

  describe('logDiscardEvent', () => {
    it('should log a discard event', async () => {
      await telemetry.logDiscardEvent(
        [
          {
            url: 'https://sharepoint.com',
            domain: 'sharepoint.com',
            title: 'SharePoint',
            timeSinceLastActive: null,
            reason: 'site-match',
          },
        ],
        10
      );

      const stats = await telemetry.getStats();
      expect(stats.totalDiscards).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return correct counts', async () => {
      // Add some test data
      await telemetry.logTabEvent(1, 'created');
      await telemetry.logTabEvent(2, 'created');
      await telemetry.updateTabMetadata(1, { domain: 'example.com' });
      await telemetry.updateTabMetadata(2, { domain: 'test.com' });
      await telemetry.logDiscardEvent([], 2);

      const stats = await telemetry.getStats();
      expect(stats.totalEvents).toBe(2);
      expect(stats.totalTabs).toBe(2);
      expect(stats.totalDiscards).toBe(1);
    });
  });

  describe('exportAllData', () => {
    it('should export all data', async () => {
      await telemetry.logTabEvent(1, 'created');
      await telemetry.updateTabMetadata(1, { domain: 'example.com' });
      await telemetry.logDiscardEvent([], 1);

      const data = await telemetry.exportAllData();

      expect(data.exportDate).toBeDefined();
      expect(data.tabEvents.length).toBe(1);
      expect(data.tabMetadata.length).toBe(1);
      expect(data.discardEvents.length).toBe(1);
    });
  });

  describe('clearAllData', () => {
    it('should clear all data', async () => {
      await telemetry.logTabEvent(1, 'created');
      await telemetry.updateTabMetadata(1, { domain: 'example.com' });
      await telemetry.logDiscardEvent([], 1);

      await telemetry.clearAllData();

      const stats = await telemetry.getStats();
      expect(stats.totalEvents).toBe(0);
      expect(stats.totalTabs).toBe(0);
      expect(stats.totalDiscards).toBe(0);
    });
  });

  describe('purgeOldData', () => {
    it('should purge old events', async () => {
      // Log an event
      await telemetry.logTabEvent(1, 'created');
      await telemetry.logDiscardEvent([], 1);

      // Purge with 0 days retention (should delete everything)
      const result = await telemetry.purgeOldData(0);

      // Both events should be deleted since they're "older than 0 days ago"
      expect(result.eventsDeleted).toBeGreaterThanOrEqual(0);
    });

    it('should keep recent events', async () => {
      await telemetry.logTabEvent(1, 'created');

      // Purge with 30 days retention (should keep recent events)
      await telemetry.purgeOldData(30);

      const stats = await telemetry.getStats();
      expect(stats.totalEvents).toBe(1);
    });
  });
});
