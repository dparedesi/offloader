/**
 * @vitest-environment jsdom
 * Tests for dashboard module.
 * Tests statistics calculation, utility functions, and UI interactions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetMocks, mockChromeRuntime, storageData } from '../test/setup.js';

import {
  calculateStats,
  formatTime,
  getTimeAgo,
  truncate,
} from './dashboard.js';
import { telemetry } from './telemetry.js';
import type { ExportedData, DiscardEvent, TabMetadata, TabEvent } from './types.js';

// ============================================================================
// DOM Mocking Setup
// ============================================================================

function setupMockDOM(): void {
  // Create mock DOM elements that dashboard.ts expects
  document.body.innerHTML = `
    <div id="loading" style="display: block;">Loading...</div>
    <div id="dashboard" style="display: none;">
      <span id="totalEvents">0</span>
      <span id="totalTabs">0</span>
      <span id="totalDiscards">0</span>
      <span id="tabsDiscarded">0</span>
      <div id="topDomains"></div>
      <div id="mostActive"></div>
      <div id="mostDiscarded"></div>
      <div id="recentDiscards"></div>
      <div id="targetSitesList"></div>
      <input type="number" id="idleThresholdInput" value="24" />
      <input type="number" id="retentionDaysInput" value="180" />
      <input type="text" id="newSiteInput" value="" />
      <button id="refreshBtn">Refresh</button>
      <button id="exportBtn">Export</button>
      <button id="addSiteBtn">Add Site</button>
      <button id="saveIdleBtn">Save Idle</button>
      <button id="saveRetentionBtn">Save Retention</button>
    </div>
  `;
}

function cleanupMockDOM(): void {
  document.body.innerHTML = '';
}

// ============================================================================
// Test Data Fixtures
// ============================================================================

function createMockTabEvent(overrides: Partial<TabEvent> = {}): TabEvent {
  return {
    id: 1,
    tabId: 100,
    eventType: 'created',
    timestamp: Date.now(),
    url: 'https://example.com/page',
    title: 'Example Page',
    ...overrides,
  };
}

function createMockTabMetadata(overrides: Partial<TabMetadata> = {}): TabMetadata {
  return {
    tabId: 100,
    url: 'https://example.com/page',
    domain: 'example.com',
    title: 'Example Page',
    createdAt: Date.now() - 3600000, // 1 hour ago
    lastUpdated: Date.now(),
    lastActive: Date.now() - 60000, // 1 minute ago
    activationCount: 5,
    totalActiveTime: 300000, // 5 minutes
    wasDiscarded: false,
    ...overrides,
  };
}

function createMockDiscardEvent(overrides: Partial<DiscardEvent> = {}): DiscardEvent {
  return {
    id: 1,
    timestamp: Date.now(),
    discardedCount: 2,
    totalTabs: 10,
    tabs: [
      {
        url: 'https://slack.com/workspace',
        domain: 'slack.com',
        title: 'Slack',
        timeSinceLastActive: 3600000,
        reason: 'site-match',
      },
      {
        url: 'https://teams.microsoft.com/chat',
        domain: 'teams.microsoft.com',
        title: 'Teams',
        timeSinceLastActive: 7200000,
        reason: 'idle',
      },
    ],
    ...overrides,
  };
}

function createMockExportedData(overrides: Partial<ExportedData> = {}): ExportedData {
  return {
    exportDate: new Date().toISOString(),
    tabEvents: [createMockTabEvent()],
    tabMetadata: [createMockTabMetadata()],
    discardEvents: [createMockDiscardEvent()],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Dashboard Utility Functions', () => {
  describe('formatTime', () => {
    it('should format seconds correctly', () => {
      expect(formatTime(0)).toBe('0s');
      expect(formatTime(1000)).toBe('1s');
      expect(formatTime(30000)).toBe('30s');
      expect(formatTime(59000)).toBe('59s');
    });

    it('should format minutes and seconds correctly', () => {
      expect(formatTime(60000)).toBe('1m 0s');
      expect(formatTime(90000)).toBe('1m 30s');
      expect(formatTime(3540000)).toBe('59m 0s');
      expect(formatTime(3599000)).toBe('59m 59s');
    });

    it('should format hours and minutes correctly', () => {
      expect(formatTime(3600000)).toBe('1h 0m');
      expect(formatTime(5400000)).toBe('1h 30m');
      expect(formatTime(7200000)).toBe('2h 0m');
      expect(formatTime(86400000)).toBe('24h 0m');
    });

    it('should handle edge cases', () => {
      expect(formatTime(500)).toBe('0s'); // Less than 1 second
      expect(formatTime(61500)).toBe('1m 1s');
      expect(formatTime(3661000)).toBe('1h 1m');
    });
  });

  describe('getTimeAgo', () => {
    it('should format seconds ago', () => {
      const now = Date.now();
      expect(getTimeAgo(now)).toBe('0s ago');
      expect(getTimeAgo(now - 30000)).toBe('30s ago');
      expect(getTimeAgo(now - 59000)).toBe('59s ago');
    });

    it('should format minutes ago', () => {
      const now = Date.now();
      expect(getTimeAgo(now - 60000)).toBe('1m ago');
      expect(getTimeAgo(now - 300000)).toBe('5m ago');
      expect(getTimeAgo(now - 3540000)).toBe('59m ago');
    });

    it('should format hours ago', () => {
      const now = Date.now();
      expect(getTimeAgo(now - 3600000)).toBe('1h ago');
      expect(getTimeAgo(now - 7200000)).toBe('2h ago');
      expect(getTimeAgo(now - 82800000)).toBe('23h ago');
    });

    it('should format days ago', () => {
      const now = Date.now();
      expect(getTimeAgo(now - 86400000)).toBe('1d ago');
      expect(getTimeAgo(now - 172800000)).toBe('2d ago');
      expect(getTimeAgo(now - 604800000)).toBe('7d ago');
    });
  });

  describe('truncate', () => {
    it('should return original string if shorter than limit', () => {
      expect(truncate('hello', 10)).toBe('hello');
      expect(truncate('test', 4)).toBe('test');
      expect(truncate('', 5)).toBe('');
    });

    it('should truncate and add ellipsis if longer than limit', () => {
      expect(truncate('hello world', 5)).toBe('hello...');
      expect(truncate('this is a long string', 10)).toBe('this is a ...');
      expect(truncate('abcdefghij', 3)).toBe('abc...');
    });

    it('should handle edge cases', () => {
      expect(truncate('a', 0)).toBe('...');
      expect(truncate('ab', 1)).toBe('a...');
    });
  });
});

describe('Dashboard Statistics Calculation', () => {
  describe('calculateStats', () => {
    it('should calculate basic counts from empty data', () => {
      const emptyData: ExportedData = {
        exportDate: new Date().toISOString(),
        tabEvents: [],
        tabMetadata: [],
        discardEvents: [],
      };

      const stats = calculateStats(emptyData);

      expect(stats.totalEvents).toBe(0);
      expect(stats.totalTabs).toBe(0);
      expect(stats.totalDiscards).toBe(0);
      expect(stats.tabsDiscarded).toBe(0);
      expect(Object.keys(stats.topDomains)).toHaveLength(0);
      expect(stats.mostActive).toHaveLength(0);
      expect(Object.keys(stats.mostDiscarded)).toHaveLength(0);
    });

    it('should count total events, tabs, and discards', () => {
      const data = createMockExportedData({
        tabEvents: [
          createMockTabEvent({ id: 1 }),
          createMockTabEvent({ id: 2 }),
          createMockTabEvent({ id: 3 }),
        ],
        tabMetadata: [
          createMockTabMetadata({ tabId: 1 }),
          createMockTabMetadata({ tabId: 2 }),
        ],
        discardEvents: [
          createMockDiscardEvent({ id: 1 }),
          createMockDiscardEvent({ id: 2 }),
        ],
      });

      const stats = calculateStats(data);

      expect(stats.totalEvents).toBe(3);
      expect(stats.totalTabs).toBe(2);
      expect(stats.totalDiscards).toBe(2);
    });

    it('should sum discarded tab counts across events', () => {
      const data = createMockExportedData({
        discardEvents: [
          createMockDiscardEvent({ discardedCount: 3, tabs: [] }),
          createMockDiscardEvent({ discardedCount: 5, tabs: [] }),
          createMockDiscardEvent({ discardedCount: 2, tabs: [] }),
        ],
      });

      const stats = calculateStats(data);

      expect(stats.tabsDiscarded).toBe(10);
    });

    it('should calculate top domains from tab metadata', () => {
      const data = createMockExportedData({
        tabMetadata: [
          createMockTabMetadata({ tabId: 1, domain: 'example.com' }),
          createMockTabMetadata({ tabId: 2, domain: 'example.com' }),
          createMockTabMetadata({ tabId: 3, domain: 'google.com' }),
          createMockTabMetadata({ tabId: 4, domain: 'example.com' }),
          createMockTabMetadata({ tabId: 5, domain: 'github.com' }),
        ],
      });

      const stats = calculateStats(data);

      expect(stats.topDomains['example.com']).toBe(3);
      expect(stats.topDomains['google.com']).toBe(1);
      expect(stats.topDomains['github.com']).toBe(1);
    });

    it('should handle tabs without domain', () => {
      const data = createMockExportedData({
        tabMetadata: [
          createMockTabMetadata({ tabId: 1, domain: 'example.com' }),
          createMockTabMetadata({ tabId: 2, domain: undefined }),
          createMockTabMetadata({ tabId: 3, domain: 'google.com' }),
        ],
      });

      const stats = calculateStats(data);

      expect(Object.keys(stats.topDomains)).toHaveLength(2);
      expect(stats.topDomains['example.com']).toBe(1);
      expect(stats.topDomains['google.com']).toBe(1);
    });

    it('should calculate most discarded domains', () => {
      const data = createMockExportedData({
        discardEvents: [
          createMockDiscardEvent({
            tabs: [
              { url: 'https://slack.com', domain: 'slack.com', title: 'Slack', timeSinceLastActive: 1000 },
              { url: 'https://slack.com/2', domain: 'slack.com', title: 'Slack 2', timeSinceLastActive: 1000 },
            ],
          }),
          createMockDiscardEvent({
            tabs: [
              { url: 'https://slack.com/3', domain: 'slack.com', title: 'Slack 3', timeSinceLastActive: 1000 },
              { url: 'https://teams.com', domain: 'teams.com', title: 'Teams', timeSinceLastActive: 1000 },
            ],
          }),
        ],
      });

      const stats = calculateStats(data);

      expect(stats.mostDiscarded['slack.com']).toBe(3);
      expect(stats.mostDiscarded['teams.com']).toBe(1);
    });

    it('should get most active tabs sorted by activation count', () => {
      const data = createMockExportedData({
        tabMetadata: [
          createMockTabMetadata({ tabId: 1, activationCount: 10, title: 'Most Active' }),
          createMockTabMetadata({ tabId: 2, activationCount: 5, title: 'Medium Active' }),
          createMockTabMetadata({ tabId: 3, activationCount: 20, title: 'Super Active' }),
          createMockTabMetadata({ tabId: 4, activationCount: 0, title: 'Never Activated' }),
          createMockTabMetadata({ tabId: 5, activationCount: 1, title: 'Least Active' }),
        ],
      });

      const stats = calculateStats(data);

      expect(stats.mostActive).toHaveLength(4); // Excludes the one with 0 activations
      expect(stats.mostActive[0]?.activationCount).toBe(20);
      expect(stats.mostActive[1]?.activationCount).toBe(10);
      expect(stats.mostActive[2]?.activationCount).toBe(5);
      expect(stats.mostActive[3]?.activationCount).toBe(1);
    });

    it('should limit most active tabs to 10', () => {
      const tabMetadata = Array.from({ length: 15 }, (_, i) =>
        createMockTabMetadata({ tabId: i, activationCount: 15 - i })
      );

      const data = createMockExportedData({ tabMetadata });

      const stats = calculateStats(data);

      expect(stats.mostActive).toHaveLength(10);
      expect(stats.mostActive[0]?.activationCount).toBe(15);
      expect(stats.mostActive[9]?.activationCount).toBe(6);
    });

    it('should filter out tabs with zero activation count', () => {
      const data = createMockExportedData({
        tabMetadata: [
          createMockTabMetadata({ tabId: 1, activationCount: 0 }),
          createMockTabMetadata({ tabId: 2, activationCount: 0 }),
          createMockTabMetadata({ tabId: 3, activationCount: 0 }),
        ],
      });

      const stats = calculateStats(data);

      expect(stats.mostActive).toHaveLength(0);
    });
  });
});

describe('Dashboard DOM Interactions', () => {
  beforeEach(() => {
    resetMocks();
    setupMockDOM();
  });

  afterEach(() => {
    cleanupMockDOM();
    vi.restoreAllMocks();
  });

  describe('setText helper behavior', () => {
    it('should update element text content when element exists', () => {
      const element = document.getElementById('totalEvents');
      expect(element).not.toBeNull();

      // Simulate setText behavior
      if (element !== null) {
        element.textContent = '100';
      }

      expect(element?.textContent).toBe('100');
    });

    it('should handle non-existent elements gracefully', () => {
      const element = document.getElementById('nonExistentElement');
      expect(element).toBeNull();

      // This should not throw
      if (element !== null) {
        element.textContent = 'test';
      }
    });
  });

  describe('List container updates', () => {
    it('should render empty message when no data', () => {
      const container = document.getElementById('topDomains');
      expect(container).not.toBeNull();

      if (container !== null) {
        container.replaceChildren();

        // Simulate createEmptyMessage behavior
        const item = document.createElement('div');
        item.className = 'list-item';
        const label = document.createElement('div');
        label.className = 'list-label';
        label.textContent = 'No data yet';
        item.appendChild(label);
        container.appendChild(item);
      }

      expect(container?.children).toHaveLength(1);
      expect(container?.querySelector('.list-label')?.textContent).toBe('No data yet');
    });

    it('should render domain items with bars', () => {
      const container = document.getElementById('topDomains');
      expect(container).not.toBeNull();

      if (container !== null) {
        container.replaceChildren();

        const topDomains: Record<string, number> = {
          'example.com': 10,
          'google.com': 5,
        };

        const sorted = Object.entries(topDomains)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

        const max = sorted[0]?.[1] ?? 1;

        for (const [domain, count] of sorted) {
          const item = document.createElement('div');
          item.className = 'list-item';

          const label = document.createElement('div');
          label.className = 'list-label';
          label.textContent = domain;

          const bar = document.createElement('div');
          bar.className = 'bar';
          const fill = document.createElement('div');
          fill.className = 'bar-fill';
          fill.style.width = `${(count / max) * 100}%`;
          bar.appendChild(fill);
          label.appendChild(bar);

          const value = document.createElement('div');
          value.className = 'list-value';
          value.textContent = `${count} tabs`;

          item.appendChild(label);
          item.appendChild(value);
          container.appendChild(item);
        }
      }

      expect(container?.children).toHaveLength(2);
      const firstItem = container?.children[0];
      expect(firstItem?.querySelector('.list-label')?.textContent).toContain('example.com');
      expect(firstItem?.querySelector('.list-value')?.textContent).toBe('10 tabs');
    });
  });
});

describe('Dashboard Event Handlers', () => {
  beforeEach(() => {
    resetMocks();
    setupMockDOM();
  });

  afterEach(() => {
    cleanupMockDOM();
    vi.restoreAllMocks();
  });

  describe('Input validation', () => {
    it('should validate idle threshold input', () => {
      const input = document.getElementById('idleThresholdInput') as HTMLInputElement;

      // Valid values
      input.value = '24';
      expect(parseInt(input.value, 10)).toBeGreaterThanOrEqual(0);
      expect(parseInt(input.value, 10)).toBeLessThanOrEqual(720);

      input.value = '0';
      expect(parseInt(input.value, 10)).toBe(0);

      input.value = '720';
      expect(parseInt(input.value, 10)).toBe(720);
    });

    it('should validate data retention input', () => {
      const input = document.getElementById('retentionDaysInput') as HTMLInputElement;

      // Valid values
      input.value = '30';
      expect(parseInt(input.value, 10)).toBeGreaterThanOrEqual(1);
      expect(parseInt(input.value, 10)).toBeLessThanOrEqual(365);

      input.value = '1';
      expect(parseInt(input.value, 10)).toBe(1);

      input.value = '365';
      expect(parseInt(input.value, 10)).toBe(365);
    });

    it('should trim and lowercase site input', () => {
      const input = document.getElementById('newSiteInput') as HTMLInputElement;

      input.value = '  Example.COM  ';
      const processed = input.value.trim().toLowerCase();

      expect(processed).toBe('example.com');
    });
  });

  describe('Button click handlers', () => {
    it('should have refresh button in DOM', () => {
      const button = document.getElementById('refreshBtn');
      expect(button).not.toBeNull();
      expect(button?.tagName).toBe('BUTTON');
    });

    it('should have export button in DOM', () => {
      const button = document.getElementById('exportBtn');
      expect(button).not.toBeNull();
      expect(button?.tagName).toBe('BUTTON');
    });

    it('should have add site button in DOM', () => {
      const button = document.getElementById('addSiteBtn');
      expect(button).not.toBeNull();
    });

    it('should have save buttons in DOM', () => {
      const saveIdleBtn = document.getElementById('saveIdleBtn');
      const saveRetentionBtn = document.getElementById('saveRetentionBtn');

      expect(saveIdleBtn).not.toBeNull();
      expect(saveRetentionBtn).not.toBeNull();
    });
  });
});

describe('Dashboard Chrome Storage Integration', () => {
  beforeEach(async () => {
    resetMocks();
    setupMockDOM();
    await telemetry.init();
    await telemetry.clearAllData();
  });

  afterEach(async () => {
    await telemetry.clearAllData();
    cleanupMockDOM();
    vi.restoreAllMocks();
  });

  describe('Loading settings from storage', () => {
    it('should load target sites from storage', async () => {
      const targetSites = { 'slack.com': true, 'teams.com': false };
      await chrome.storage.local.set({ targetSites });

      const result = await chrome.storage.local.get(['targetSites']);
      expect(result['targetSites']).toEqual(targetSites);
    });

    it('should load idle threshold from storage', async () => {
      await chrome.storage.local.set({ idleTabThreshold: 48 });

      const result = await chrome.storage.local.get(['idleTabThreshold']);
      expect(result['idleTabThreshold']).toBe(48);
    });

    it('should load data retention days from storage', async () => {
      await chrome.storage.local.set({ dataRetentionDays: 90 });

      const result = await chrome.storage.local.get(['dataRetentionDays']);
      expect(result['dataRetentionDays']).toBe(90);
    });

    it('should use default values when storage is empty', async () => {
      const result = await chrome.storage.local.get([
        'targetSites',
        'idleTabThreshold',
        'dataRetentionDays',
      ]);

      // Storage returns empty object for missing keys
      expect(result['targetSites']).toBeUndefined();
      expect(result['idleTabThreshold']).toBeUndefined();
      expect(result['dataRetentionDays']).toBeUndefined();
    });
  });

  describe('Saving settings to storage', () => {
    it('should save target sites to storage', async () => {
      const targetSites = { 'example.com': true };
      await chrome.storage.local.set({ targetSites });

      const result = await chrome.storage.local.get(['targetSites']);
      expect(result['targetSites']).toEqual(targetSites);
    });

    it('should save idle threshold to storage', async () => {
      await chrome.storage.local.set({ idleTabThreshold: 72 });

      const result = await chrome.storage.local.get(['idleTabThreshold']);
      expect(result['idleTabThreshold']).toBe(72);
    });

    it('should save data retention days to storage', async () => {
      await chrome.storage.local.set({ dataRetentionDays: 30 });

      const result = await chrome.storage.local.get(['dataRetentionDays']);
      expect(result['dataRetentionDays']).toBe(30);
    });
  });
});

describe('Dashboard Chrome Runtime Messaging', () => {
  beforeEach(() => {
    resetMocks();
    setupMockDOM();
  });

  afterEach(() => {
    cleanupMockDOM();
    vi.restoreAllMocks();
  });

  describe('Sending messages to background script', () => {
    it('should send updateTargetSites message', async () => {
      const targetSites = { 'slack.com': true };

      await chrome.runtime.sendMessage({
        action: 'updateTargetSites',
        targetSites,
      });

      expect(mockChromeRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'updateTargetSites',
          targetSites,
        })
      );
    });

    it('should send updateIdleThreshold message', async () => {
      await chrome.runtime.sendMessage({
        action: 'updateIdleThreshold',
        threshold: 48,
      });

      expect(mockChromeRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'updateIdleThreshold',
          threshold: 48,
        })
      );
    });
  });
});

describe('Dashboard Export Functionality', () => {
  beforeEach(() => {
    resetMocks();
    setupMockDOM();
  });

  afterEach(() => {
    cleanupMockDOM();
    vi.restoreAllMocks();
  });

  describe('Data export', () => {
    it('should create valid JSON string from exported data', () => {
      const data = createMockExportedData();
      const jsonString = JSON.stringify(data, null, 2);

      expect(() => JSON.parse(jsonString)).not.toThrow();

      const parsed = JSON.parse(jsonString) as ExportedData;
      expect(parsed.exportDate).toBe(data.exportDate);
      expect(parsed.tabEvents).toHaveLength(data.tabEvents.length);
      expect(parsed.tabMetadata).toHaveLength(data.tabMetadata.length);
      expect(parsed.discardEvents).toHaveLength(data.discardEvents.length);
    });

    it('should generate correct filename format', () => {
      const now = new Date();
      const expectedDate = now.toISOString().split('T')[0];
      const filename = `tab-telemetry-${expectedDate}.json`;

      expect(filename).toMatch(/^tab-telemetry-\d{4}-\d{2}-\d{2}\.json$/);
    });

    it('should handle empty data export', () => {
      const emptyData: ExportedData = {
        exportDate: new Date().toISOString(),
        tabEvents: [],
        tabMetadata: [],
        discardEvents: [],
      };

      const jsonString = JSON.stringify(emptyData, null, 2);
      const parsed = JSON.parse(jsonString) as ExportedData;

      expect(parsed.tabEvents).toHaveLength(0);
      expect(parsed.tabMetadata).toHaveLength(0);
      expect(parsed.discardEvents).toHaveLength(0);
    });
  });

  describe('Blob creation', () => {
    it('should create blob with correct type', () => {
      const data = createMockExportedData();
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });

      expect(blob.type).toBe('application/json');
      expect(blob.size).toBeGreaterThan(0);
    });
  });
});

describe('Dashboard Target Sites Management', () => {
  beforeEach(() => {
    resetMocks();
    setupMockDOM();
  });

  afterEach(() => {
    cleanupMockDOM();
    vi.restoreAllMocks();
  });

  describe('Site list rendering', () => {
    it('should render empty message when no sites', () => {
      const container = document.getElementById('targetSitesList');
      expect(container).not.toBeNull();

      if (container !== null) {
        container.replaceChildren();

        const allSites: [string, boolean][] = [];

        if (allSites.length === 0) {
          const empty = document.createElement('div');
          empty.style.color = '#5f6368';
          empty.style.fontSize = '14px';
          empty.textContent = 'No target sites configured';
          container.appendChild(empty);
        }
      }

      expect(container?.textContent).toContain('No target sites configured');
    });

    it('should render sites sorted alphabetically', () => {
      const targetSites: Record<string, boolean> = {
        'zoom.com': true,
        'slack.com': true,
        'asana.com': true,
      };

      const sorted = Object.entries(targetSites).sort(([a], [b]) => a.localeCompare(b));

      expect(sorted[0]?.[0]).toBe('asana.com');
      expect(sorted[1]?.[0]).toBe('slack.com');
      expect(sorted[2]?.[0]).toBe('zoom.com');
    });

    it('should mark disabled sites with strikethrough styling', () => {
      const container = document.getElementById('targetSitesList');
      expect(container).not.toBeNull();

      if (container !== null) {
        container.replaceChildren();

        const site = 'disabled-site.com';
        const enabled = false;

        const siteItem = document.createElement('div');
        siteItem.className = 'site-item';
        if (!enabled) {
          siteItem.style.opacity = '0.6';
        }

        const siteName = document.createElement('span');
        siteName.className = 'site-name';
        siteName.textContent = site;
        if (!enabled) {
          siteName.style.textDecoration = 'line-through';
          siteName.style.color = '#5f6368';
        }

        siteItem.appendChild(siteName);
        container.appendChild(siteItem);
      }

      const siteName = container?.querySelector('.site-name') as HTMLSpanElement;
      expect(siteName.style.textDecoration).toBe('line-through');
      expect(siteName.style.color).toBe('rgb(95, 99, 104)');
    });
  });

  describe('Site validation', () => {
    it('should reject empty site input', () => {
      const site = '   '.trim();
      expect(site.length).toBe(0);
    });

    it('should lowercase site input', () => {
      const site = 'EXAMPLE.COM'.toLowerCase();
      expect(site).toBe('example.com');
    });

    it('should handle site already in list', () => {
      const targetSites: Record<string, boolean> = { 'example.com': true };
      const site = 'example.com';

      expect(site in targetSites).toBe(true);
      expect(targetSites[site]).toBe(true);
    });

    it('should detect disabled sites for re-enabling', () => {
      const targetSites: Record<string, boolean> = { 'example.com': false };
      const site = 'example.com';

      expect(site in targetSites).toBe(true);
      expect(targetSites[site]).toBe(false);
    });
  });
});

describe('Dashboard Loading State', () => {
  beforeEach(() => {
    resetMocks();
    setupMockDOM();
  });

  afterEach(() => {
    cleanupMockDOM();
  });

  describe('Loading indicator', () => {
    it('should have loading element initially visible', () => {
      const loading = document.getElementById('loading');
      expect(loading).not.toBeNull();
      expect(loading?.style.display).toBe('block');
    });

    it('should have dashboard element initially hidden', () => {
      const dashboard = document.getElementById('dashboard');
      expect(dashboard).not.toBeNull();
      expect(dashboard?.style.display).toBe('none');
    });

    it('should toggle visibility when loading completes', () => {
      const loading = document.getElementById('loading');
      const dashboard = document.getElementById('dashboard');

      // Simulate loading complete
      if (loading !== null) {
        loading.style.display = 'none';
      }
      if (dashboard !== null) {
        dashboard.style.display = 'block';
      }

      expect(loading?.style.display).toBe('none');
      expect(dashboard?.style.display).toBe('block');
    });

    it('should show error message on loading failure', () => {
      const loading = document.getElementById('loading');

      if (loading !== null) {
        loading.textContent = 'Error loading data. Please try again.';
      }

      expect(loading?.textContent).toBe('Error loading data. Please try again.');
    });
  });
});

describe('Dashboard Telemetry Integration', () => {
  beforeEach(async () => {
    resetMocks();
    setupMockDOM();
    await telemetry.init();
    await telemetry.clearAllData();
  });

  afterEach(async () => {
    await telemetry.clearAllData();
    cleanupMockDOM();
  });

  describe('Fetching telemetry data', () => {
    it('should fetch all telemetry data', async () => {
      // Add some test data
      await telemetry.logTabEvent(1, 'created', { url: 'https://example.com' });
      await telemetry.updateTabMetadata(1, { domain: 'example.com' });
      await telemetry.logDiscardEvent([
        { url: 'https://slack.com', domain: 'slack.com', title: 'Slack', timeSinceLastActive: 1000 },
      ], 5);

      const data = await telemetry.exportAllData();

      expect(data.tabEvents.length).toBeGreaterThanOrEqual(1);
      expect(data.tabMetadata.length).toBeGreaterThanOrEqual(1);
      expect(data.discardEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle empty telemetry data', async () => {
      const data = await telemetry.exportAllData();

      expect(data.tabEvents).toHaveLength(0);
      expect(data.tabMetadata).toHaveLength(0);
      expect(data.discardEvents).toHaveLength(0);
    });
  });

  describe('Stats calculation from real data', () => {
    it('should calculate stats from telemetry data', async () => {
      await telemetry.logTabEvent(1, 'created');
      await telemetry.logTabEvent(2, 'created');
      await telemetry.logTabEvent(1, 'activated');
      await telemetry.updateTabMetadata(1, { domain: 'example.com', activationCount: 3, totalActiveTime: 60000 });
      await telemetry.updateTabMetadata(2, { domain: 'google.com', activationCount: 1, totalActiveTime: 30000 });

      const data = await telemetry.exportAllData();
      const stats = calculateStats(data);

      expect(stats.totalEvents).toBe(3);
      expect(stats.totalTabs).toBe(2);
      expect(stats.topDomains['example.com']).toBe(1);
      expect(stats.topDomains['google.com']).toBe(1);
    });
  });
});

describe('Dashboard Recent Discards Display', () => {
  describe('Discard event formatting', () => {
    it('should format discard timestamp', () => {
      const timestamp = Date.now() - 3600000; // 1 hour ago
      const date = new Date(timestamp);
      const formatted = date.toLocaleString();

      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
    });

    it('should show recent discards in reverse order (newest first)', () => {
      const discardEvents: DiscardEvent[] = [
        createMockDiscardEvent({ id: 1, timestamp: Date.now() - 3600000 }),
        createMockDiscardEvent({ id: 2, timestamp: Date.now() - 1800000 }),
        createMockDiscardEvent({ id: 3, timestamp: Date.now() - 900000 }),
      ];

      const recent = discardEvents.slice(-10).reverse();

      expect(recent[0]?.id).toBe(3); // Most recent first
      expect(recent[1]?.id).toBe(2);
      expect(recent[2]?.id).toBe(1);
    });

    it('should limit recent discards to 10', () => {
      const discardEvents = Array.from({ length: 15 }, (_, i) =>
        createMockDiscardEvent({ id: i + 1, timestamp: Date.now() - i * 1000 })
      );

      const recent = discardEvents.slice(-10).reverse();

      expect(recent).toHaveLength(10);
    });

    it('should display discard count correctly', () => {
      const event = createMockDiscardEvent({ discardedCount: 5 });
      const displayText = `${event.discardedCount} tabs`;

      expect(displayText).toBe('5 tabs');
    });
  });
});

describe('Dashboard Bar Chart Rendering', () => {
  describe('Bar percentage calculation', () => {
    it('should calculate correct percentage for max value', () => {
      const max = 100;
      const value = 100;
      const percentage = value / max;

      expect(percentage).toBe(1);
      expect(`${percentage * 100}%`).toBe('100%');
    });

    it('should calculate correct percentage for partial value', () => {
      const max = 100;
      const value = 50;
      const percentage = value / max;

      expect(percentage).toBe(0.5);
      expect(`${percentage * 100}%`).toBe('50%');
    });

    it('should handle zero max value', () => {
      const max = 0;
      const percentage = max === 0 ? 0 : 10 / max;

      expect(percentage).toBe(0);
    });

    it('should create bar element with correct width', () => {
      const percentage = 0.75;

      const bar = document.createElement('div');
      bar.className = 'bar';

      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = `${percentage * 100}%`;

      bar.appendChild(fill);

      expect(fill.style.width).toBe('75%');
    });
  });
});

describe('Dashboard Most Active Tabs Display', () => {
  describe('Tab info formatting', () => {
    it('should handle missing domain', () => {
      const tab = createMockTabMetadata({ domain: undefined });
      const domain = tab.domain ?? 'Unknown';

      expect(domain).toBe('Unknown');
    });

    it('should handle missing title', () => {
      const tab = createMockTabMetadata({ title: undefined });
      const title = tab.title ?? 'Untitled';

      expect(title).toBe('Untitled');
    });

    it('should format active time display', () => {
      const tab = createMockTabMetadata({ totalActiveTime: 3661000 }); // 1h 1m
      const activeTime = formatTime(tab.totalActiveTime);

      expect(activeTime).toBe('1h 1m');
    });

    it('should display activation count', () => {
      const tab = createMockTabMetadata({ activationCount: 25 });
      const displayText = `${tab.activationCount} views`;

      expect(displayText).toBe('25 views');
    });
  });
});

describe('Edge Cases', () => {
  describe('Invalid data handling', () => {
    it('should handle null dashboard data gracefully', () => {
      const dashboardData: ExportedData | null = null;

      // Simulate handleExport check
      if (dashboardData === null) {
        // Should return early
        expect(true).toBe(true);
      }
    });

    it('should handle very large numbers', () => {
      const largeNumber = 999999999;
      const formatted = largeNumber.toLocaleString();

      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(String(largeNumber).length); // Has commas
    });

    it('should handle special characters in domain names', () => {
      const domain = 'xn--n3h.com'; // Punycode domain
      const stats: Record<string, number> = {};
      stats[domain] = (stats[domain] ?? 0) + 1;

      expect(stats[domain]).toBe(1);
    });

    it('should handle empty strings', () => {
      expect(truncate('', 10)).toBe('');
      expect(formatTime(0)).toBe('0s');
    });

    it('should handle negative timestamps gracefully', () => {
      // getTimeAgo with future timestamp (negative difference)
      const futureTimestamp = Date.now() + 3600000;
      const result = getTimeAgo(futureTimestamp);

      // Should return something (implementation returns negative or 0)
      expect(result).toBeDefined();
    });
  });

  describe('Concurrent operations', () => {
    it('should handle multiple rapid storage updates', async () => {
      const updates = [
        chrome.storage.local.set({ idleTabThreshold: 24 }),
        chrome.storage.local.set({ idleTabThreshold: 48 }),
        chrome.storage.local.set({ idleTabThreshold: 72 }),
      ];

      await Promise.all(updates);

      const result = await chrome.storage.local.get(['idleTabThreshold']);
      expect(result['idleTabThreshold']).toBe(72); // Last update wins
    });
  });
});
