/**
 * Dashboard page controller for Chrome Tab Killer extension.
 *
 * Key improvements:
 * - Uses DOM APIs instead of innerHTML (XSS prevention)
 * - Strict TypeScript for type safety
 * - Input validation for all user inputs
 * - Better error handling
 */

import { telemetry } from './telemetry.js';
import {
  DEFAULT_CONFIG,
  type DiscardEvent,
  type ExportedData,
  type StorageData,
  type TabMetadata,
  type TargetSites,
  isValidDataRetentionDays,
  isValidDomain,
  isValidIdleThreshold,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

interface DashboardStats {
  totalEvents: number;
  totalTabs: number;
  totalDiscards: number;
  tabsDiscarded: number;
  topDomains: Record<string, number>;
  mostActive: TabMetadata[];
  mostDiscarded: Record<string, number>;
}

// ============================================================================
// State
// ============================================================================

let dashboardData: ExportedData | null = null;
let targetSites: TargetSites = { ...DEFAULT_CONFIG.targetSites };
let idleTabThreshold = DEFAULT_CONFIG.idleTabThreshold;
let dataRetentionDays = DEFAULT_CONFIG.dataRetentionDays;

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  void loadDashboard();
  setupEventListeners();
});

async function loadDashboard(): Promise<void> {
  const loading = document.getElementById('loading');
  const dashboard = document.getElementById('dashboard');

  if (loading === null || dashboard === null) return;

  loading.style.display = 'block';
  dashboard.style.display = 'none';

  try {
    await telemetry.init();

    // Load settings from storage
    const result = await chrome.storage.local.get([
      'targetSites',
      'idleTabThreshold',
      'dataRetentionDays',
    ] satisfies (keyof StorageData)[]);

    targetSites = (result['targetSites'] as TargetSites | undefined) ?? { ...DEFAULT_CONFIG.targetSites };
    idleTabThreshold = (result['idleTabThreshold'] as number | undefined) ?? DEFAULT_CONFIG.idleTabThreshold;
    dataRetentionDays = (result['dataRetentionDays'] as number | undefined) ?? DEFAULT_CONFIG.dataRetentionDays;

    // Set idle threshold input
    const idleInput = document.getElementById('idleThresholdInput') as HTMLInputElement | null;
    if (idleInput !== null) {
      idleInput.value = String(idleTabThreshold);
    }

    // Set data retention input
    const retentionInput = document.getElementById('retentionDaysInput') as HTMLInputElement | null;
    if (retentionInput !== null) {
      retentionInput.value = String(dataRetentionDays);
    }

    // Get all telemetry data
    const data = await telemetry.exportAllData();
    dashboardData = data;

    // Calculate and display stats
    const stats = calculateStats(data);
    updateStats(stats);
    updateTopDomains(stats.topDomains);
    updateMostActive(stats.mostActive);
    updateMostDiscarded(stats.mostDiscarded);
    updateRecentDiscards(data.discardEvents);
    updateTargetSitesList();

    loading.style.display = 'none';
    dashboard.style.display = 'block';
  } catch (error) {
    console.error('Error loading dashboard:', error);
    loading.textContent = 'Error loading data. Please try again.';
  }
}

// ============================================================================
// Statistics Calculation
// ============================================================================

function calculateStats(data: ExportedData): DashboardStats {
  const stats: DashboardStats = {
    totalEvents: data.tabEvents.length,
    totalTabs: data.tabMetadata.length,
    totalDiscards: data.discardEvents.length,
    tabsDiscarded: 0,
    topDomains: {},
    mostActive: [],
    mostDiscarded: {},
  };

  // Count total tabs discarded and by domain
  for (const event of data.discardEvents) {
    stats.tabsDiscarded += event.discardedCount;

    for (const tab of event.tabs) {
      const domain = tab.domain;
      stats.mostDiscarded[domain] = (stats.mostDiscarded[domain] ?? 0) + 1;
    }
  }

  // Count tabs by domain
  for (const tab of data.tabMetadata) {
    if (tab.domain !== undefined) {
      stats.topDomains[tab.domain] = (stats.topDomains[tab.domain] ?? 0) + 1;
    }
  }

  // Get most active tabs
  stats.mostActive = data.tabMetadata
    .filter((tab) => tab.activationCount > 0)
    .sort((a, b) => b.activationCount - a.activationCount)
    .slice(0, 10);

  return stats;
}

// ============================================================================
// UI Updates (DOM APIs - XSS Safe)
// ============================================================================

function updateStats(stats: DashboardStats): void {
  setText('totalEvents', stats.totalEvents.toLocaleString());
  setText('totalTabs', stats.totalTabs.toLocaleString());
  setText('totalDiscards', stats.totalDiscards.toLocaleString());
  setText('tabsDiscarded', stats.tabsDiscarded.toLocaleString());
}

function updateTopDomains(topDomains: Record<string, number>): void {
  const container = document.getElementById('topDomains');
  if (container === null) return;

  container.replaceChildren();

  const sorted = Object.entries(topDomains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (sorted.length === 0) {
    container.appendChild(createEmptyMessage('No data yet'));
    return;
  }

  const max = sorted[0]?.[1] ?? 1;

  for (const [domain, count] of sorted) {
    const item = createListItem();

    // Label with bar
    const label = document.createElement('div');
    label.className = 'list-label';
    label.textContent = domain; // Safe: textContent

    const bar = createBar(count / max);
    label.appendChild(bar);

    // Value
    const value = document.createElement('div');
    value.className = 'list-value';
    value.textContent = `${count} tabs`;

    item.appendChild(label);
    item.appendChild(value);
    container.appendChild(item);
  }
}

function updateMostActive(mostActive: TabMetadata[]): void {
  const container = document.getElementById('mostActive');
  if (container === null) return;

  container.replaceChildren();

  if (mostActive.length === 0) {
    container.appendChild(createEmptyMessage('No data yet'));
    return;
  }

  const max = mostActive[0]?.activationCount ?? 1;

  for (const tab of mostActive) {
    const domain = tab.domain ?? 'Unknown';
    const title = tab.title ?? 'Untitled';
    const activeTime = formatTime(tab.totalActiveTime);

    const item = createListItem();

    // Label with domain, title, bar, and active time
    const label = document.createElement('div');
    label.className = 'list-label';

    const domainStrong = document.createElement('strong');
    domainStrong.textContent = domain;
    label.appendChild(domainStrong);
    label.appendChild(document.createTextNode(` - ${truncate(title, 50)}`));

    const bar = createBar(tab.activationCount / max);
    label.appendChild(bar);

    const detail = document.createElement('div');
    detail.className = 'stat-detail';
    detail.textContent = `${activeTime} active time`;
    label.appendChild(detail);

    // Value
    const value = document.createElement('div');
    value.className = 'list-value';
    value.textContent = `${tab.activationCount} views`;

    item.appendChild(label);
    item.appendChild(value);
    container.appendChild(item);
  }
}

function updateMostDiscarded(mostDiscarded: Record<string, number>): void {
  const container = document.getElementById('mostDiscarded');
  if (container === null) return;

  container.replaceChildren();

  const sorted = Object.entries(mostDiscarded)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (sorted.length === 0) {
    container.appendChild(createEmptyMessage('No discards yet'));
    return;
  }

  const max = sorted[0]?.[1] ?? 1;

  for (const [domain, count] of sorted) {
    const item = createListItem();

    const label = document.createElement('div');
    label.className = 'list-label';
    label.textContent = domain;

    const bar = createBar(count / max);
    label.appendChild(bar);

    const value = document.createElement('div');
    value.className = 'list-value';
    value.textContent = `${count} times`;

    item.appendChild(label);
    item.appendChild(value);
    container.appendChild(item);
  }
}

function updateRecentDiscards(discardEvents: DiscardEvent[]): void {
  const container = document.getElementById('recentDiscards');
  if (container === null) return;

  container.replaceChildren();

  const recent = discardEvents.slice(-10).reverse();

  if (recent.length === 0) {
    container.appendChild(createEmptyMessage('No discards yet'));
    return;
  }

  for (const event of recent) {
    const date = new Date(event.timestamp);
    const timeAgo = getTimeAgo(event.timestamp);

    const item = createListItem();

    const label = document.createElement('div');
    label.className = 'list-label';
    label.textContent = date.toLocaleString();

    const detail = document.createElement('div');
    detail.className = 'stat-detail';
    detail.textContent = timeAgo;
    label.appendChild(detail);

    const value = document.createElement('div');
    value.className = 'list-value';
    value.textContent = `${event.discardedCount} tabs`;

    item.appendChild(label);
    item.appendChild(value);
    container.appendChild(item);
  }
}

function updateTargetSitesList(): void {
  const container = document.getElementById('targetSitesList');
  if (container === null) return;

  container.replaceChildren();

  const allSites = Object.entries(targetSites).sort(([a], [b]) => a.localeCompare(b));

  if (allSites.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = '#5f6368';
    empty.style.fontSize = '14px';
    empty.textContent = 'No target sites configured';
    container.appendChild(empty);
    return;
  }

  for (const [site, enabled] of allSites) {
    const siteItem = document.createElement('div');
    siteItem.className = 'site-item';
    if (!enabled) {
      siteItem.style.opacity = '0.6';
    }

    const siteInfo = document.createElement('div');
    siteInfo.style.display = 'flex';
    siteInfo.style.alignItems = 'center';
    siteInfo.style.gap = '8px';

    // Toggle checkbox
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = enabled;
    toggle.title = enabled ? 'Disable site' : 'Enable site';
    toggle.addEventListener('change', () => {
      void handleToggleSite(site, toggle.checked);
    });
    siteInfo.appendChild(toggle);

    const siteName = document.createElement('span');
    siteName.className = 'site-name';
    siteName.textContent = site;
    if (!enabled) {
      siteName.style.textDecoration = 'line-through';
      siteName.style.color = '#5f6368';
    }
    siteInfo.appendChild(siteName);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      void handleRemoveSite(site);
    });

    siteItem.appendChild(siteInfo);
    siteItem.appendChild(removeBtn);
    container.appendChild(siteItem);
  }
}

// ============================================================================
// DOM Helpers
// ============================================================================

function setText(id: string, text: string): void {
  const element = document.getElementById(id);
  if (element !== null) {
    element.textContent = text;
  }
}

function createListItem(): HTMLDivElement {
  const item = document.createElement('div');
  item.className = 'list-item';
  return item;
}

function createEmptyMessage(message: string): HTMLDivElement {
  const item = document.createElement('div');
  item.className = 'list-item';

  const label = document.createElement('div');
  label.className = 'list-label';
  label.textContent = message;

  item.appendChild(label);
  return item;
}

function createBar(percentage: number): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = 'bar';

  const fill = document.createElement('div');
  fill.className = 'bar-fill';
  fill.style.width = `${percentage * 100}%`;

  bar.appendChild(fill);
  return bar;
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.substring(0, length) + '...';
}

// ============================================================================
// Event Handlers
// ============================================================================

function setupEventListeners(): void {
  // Refresh button
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn?.addEventListener('click', () => {
    void loadDashboard();
  });

  // Export button
  const exportBtn = document.getElementById('exportBtn');
  exportBtn?.addEventListener('click', handleExport);

  // Add site button
  const addSiteBtn = document.getElementById('addSiteBtn');
  addSiteBtn?.addEventListener('click', () => {
    void handleAddSite();
  });

  // Add site on Enter key
  const newSiteInput = document.getElementById('newSiteInput') as HTMLInputElement | null;
  newSiteInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      void handleAddSite();
    }
  });

  // Save idle threshold
  const saveIdleBtn = document.getElementById('saveIdleBtn');
  saveIdleBtn?.addEventListener('click', () => {
    void handleSaveIdleThreshold();
  });

  // Save data retention
  const saveRetentionBtn = document.getElementById('saveRetentionBtn');
  saveRetentionBtn?.addEventListener('click', () => {
    void handleSaveDataRetention();
  });
}

function handleExport(): void {
  if (dashboardData === null) return;

  const dataStr = JSON.stringify(dashboardData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `tab-telemetry-${new Date().toISOString().split('T')[0]}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

async function handleAddSite(): Promise<void> {
  const input = document.getElementById('newSiteInput') as HTMLInputElement | null;
  if (input === null) return;

  const site = input.value.trim().toLowerCase();

  // Input validation
  if (site.length === 0) {
    alert('Please enter a domain');
    return;
  }

  if (!isValidDomain(site)) {
    alert('Please enter a valid domain (e.g., "example.com" or "slack")');
    return;
  }

  // Check if site already exists (enabled or disabled)
  if (site in targetSites) {
    if (targetSites[site] === true) {
      alert('This site is already in the list and enabled');
    } else {
      // Site exists but is disabled - re-enable it
      targetSites[site] = true;
      await chrome.storage.local.set({ targetSites });
      void chrome.runtime.sendMessage({
        action: 'updateTargetSites',
        targetSites,
      });
      input.value = '';
      updateTargetSitesList();
      alert(`"${site}" has been re-enabled`);
    }
    return;
  }

  // Add new site
  targetSites[site] = true;
  await chrome.storage.local.set({ targetSites });

  // Notify background script
  void chrome.runtime.sendMessage({
    action: 'updateTargetSites',
    targetSites,
  });

  input.value = '';
  updateTargetSitesList();
}

async function handleRemoveSite(site: string): Promise<void> {
  const confirmed = confirm(`Remove "${site}" from target sites?`);
  if (!confirmed) return;

  delete targetSites[site];
  await chrome.storage.local.set({ targetSites });

  void chrome.runtime.sendMessage({
    action: 'updateTargetSites',
    targetSites,
  });

  updateTargetSitesList();
}

async function handleToggleSite(site: string, enabled: boolean): Promise<void> {
  targetSites[site] = enabled;
  await chrome.storage.local.set({ targetSites });

  void chrome.runtime.sendMessage({
    action: 'updateTargetSites',
    targetSites,
  });

  updateTargetSitesList();
}

async function handleSaveIdleThreshold(): Promise<void> {
  const input = document.getElementById('idleThresholdInput') as HTMLInputElement | null;
  if (input === null) return;

  const threshold = parseInt(input.value, 10);

  // Input validation
  if (!isValidIdleThreshold(threshold)) {
    alert('Please enter a valid number between 0 and 720 hours (30 days)');
    return;
  }

  idleTabThreshold = threshold;
  await chrome.storage.local.set({ idleTabThreshold: threshold });

  void chrome.runtime.sendMessage({
    action: 'updateIdleThreshold',
    threshold,
  });

  alert(`Idle threshold updated to ${threshold} hours`);
}

async function handleSaveDataRetention(): Promise<void> {
  const input = document.getElementById('retentionDaysInput') as HTMLInputElement | null;
  if (input === null) return;

  const days = parseInt(input.value, 10);

  // Input validation
  if (!isValidDataRetentionDays(days)) {
    alert('Please enter a valid number between 1 and 365 days');
    return;
  }

  dataRetentionDays = days;
  await chrome.storage.local.set({ dataRetentionDays: days });

  alert(`Data retention updated to ${days} days`);
}

// ============================================================================
// Exports for Testing
// ============================================================================

// State getters for testing
function getDashboardData(): ExportedData | null {
  return dashboardData;
}

function getTargetSites(): TargetSites {
  return targetSites;
}

export {
  // Types
  type DashboardStats,
  // Pure functions (can be tested without DOM)
  calculateStats,
  formatTime,
  getTimeAgo,
  truncate,
  // Functions that need DOM
  loadDashboard,
  setupEventListeners,
  handleExport,
  handleAddSite,
  handleRemoveSite,
  handleToggleSite,
  handleSaveIdleThreshold,
  handleSaveDataRetention,
  // State getters for testing
  getDashboardData,
  getTargetSites,
};
