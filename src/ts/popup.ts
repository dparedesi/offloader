/**
 * Popup UI controller for Offloader extension.
 *
 * Key improvements:
 * - Uses DOM APIs instead of innerHTML (XSS prevention)
 * - Strict TypeScript for type safety
 * - Better error handling
 */

import {
  DEFAULT_CONFIG,
  type DiscardInterval,
  type ExportedData,
  type MessageResponse,
  type StorageData,
  type TargetSites,
  type TelemetryStats,
  isValidDiscardInterval,
} from './types.js';

// ============================================================================
// DOM Element References
// ============================================================================

interface PopupElements {
  toggle: HTMLInputElement;
  status: HTMLElement;
  intervalSelect: HTMLSelectElement;
  discardAllBtn: HTMLButtonElement;
  dashboardBtn: HTMLButtonElement;
  exportBtn: HTMLButtonElement;
  telemetryStats: HTMLElement;
  targetSitesContainer: HTMLElement;
}

function getElements(): PopupElements {
  return {
    toggle: document.getElementById('autoToggle') as HTMLInputElement,
    status: document.getElementById('status') as HTMLElement,
    intervalSelect: document.getElementById('intervalSelect') as HTMLSelectElement,
    discardAllBtn: document.getElementById('discardAllBtn') as HTMLButtonElement,
    dashboardBtn: document.getElementById('dashboardBtn') as HTMLButtonElement,
    exportBtn: document.getElementById('exportBtn') as HTMLButtonElement,
    telemetryStats: document.getElementById('telemetryStats') as HTMLElement,
    targetSitesContainer: document.getElementById('targetSitesContainer') as HTMLElement,
  };
}

// ============================================================================
// State
// ============================================================================

let targetSites: TargetSites = { ...DEFAULT_CONFIG.targetSites };

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  void initPopup();
});

async function initPopup(): Promise<void> {
  const elements = getElements();

  // Load current state from storage
  const result = await chrome.storage.local.get([
    'autoDiscardEnabled',
    'targetSites',
    'discardInterval',
    'lastRun',
    'lastDiscardedCount',
  ] satisfies (keyof StorageData)[]);

  const isEnabled = result['autoDiscardEnabled'] !== false;
  targetSites = (result['targetSites'] as TargetSites | undefined) ?? { ...DEFAULT_CONFIG.targetSites };
  const interval: DiscardInterval = isValidDiscardInterval(result['discardInterval'] as number)
    ? (result['discardInterval'] as DiscardInterval)
    : DEFAULT_CONFIG.discardInterval;

  // Set initial UI state
  elements.toggle.checked = isEnabled;
  elements.intervalSelect.value = String(interval);
  updateStatus(
    elements.status,
    isEnabled,
    interval,
    result['lastRun'] as number | undefined,
    result['lastDiscardedCount'] as number | undefined
  );

  // Render target sites using DOM APIs (not innerHTML)
  renderTargetSites(elements.targetSitesContainer);

  // Load telemetry stats
  void loadTelemetryStats(elements.telemetryStats);

  // Set up event listeners
  setupEventListeners(elements, interval);
}

// ============================================================================
// Rendering (DOM APIs - XSS Safe)
// ============================================================================

function renderTargetSites(container: HTMLElement): void {
  // Clear existing content safely
  container.replaceChildren();

  const sortedSites = Object.keys(targetSites).sort();

  // Show message if no sites configured
  if (sortedSites.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.fontSize = '12px';
    emptyMsg.style.color = '#5f6368';
    emptyMsg.style.padding = '5px 0';
    emptyMsg.textContent = 'No sites configured. Add sites via Dashboard.';
    container.appendChild(emptyMsg);
    return;
  }

  for (const site of sortedSites) {
    const isEnabled = targetSites[site] ?? false;
    const displayName = site.charAt(0).toUpperCase() + site.slice(1);

    // Create toggle container
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'toggle-container';
    toggleContainer.style.padding = '5px 0';

    // Create label text
    const labelSpan = document.createElement('span');
    labelSpan.className = 'toggle-label';
    labelSpan.style.fontSize = '13px';
    labelSpan.textContent = displayName; // Safe: textContent escapes HTML

    // Create switch label
    const switchLabel = document.createElement('label');
    switchLabel.className = 'switch';

    // Create checkbox input
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'site-toggle';
    checkbox.dataset['site'] = site;
    checkbox.checked = isEnabled;

    // Create slider span
    const slider = document.createElement('span');
    slider.className = 'slider';

    // Assemble switch
    switchLabel.appendChild(checkbox);
    switchLabel.appendChild(slider);

    // Assemble toggle container
    toggleContainer.appendChild(labelSpan);
    toggleContainer.appendChild(switchLabel);

    container.appendChild(toggleContainer);

    // Add event listener
    checkbox.addEventListener('change', (e) => {
      void handleSiteToggle(e, site);
    });
  }
}

async function handleSiteToggle(event: Event, site: string): Promise<void> {
  const checkbox = event.target as HTMLInputElement;
  targetSites[site] = checkbox.checked;

  await chrome.storage.local.set({ targetSites });

  void chrome.runtime.sendMessage({
    action: 'updateTargetSites',
    targetSites,
  });
}

function updateStatus(
  statusElement: HTMLElement,
  enabled: boolean,
  interval: DiscardInterval,
  lastRun?: number,
  lastCount?: number
): void {
  if (enabled) {
    let statusText = `Auto-discard is ON (every ${interval} min)`;
    if (lastRun !== undefined && lastCount !== undefined) {
      const minutesAgo = Math.floor((Date.now() - lastRun) / 60000);
      statusText += `\nLast run: ${minutesAgo}m ago (${lastCount} tabs)`;
    }
    statusElement.textContent = statusText;
    statusElement.className = 'status status-on';
  } else {
    statusElement.textContent = 'Auto-discard is OFF';
    statusElement.className = 'status status-off';
  }
}

function loadTelemetryStats(statsElement: HTMLElement): void {
  chrome.runtime.sendMessage(
    { action: 'getTelemetryStats' },
    (response: MessageResponse<void> & { stats?: TelemetryStats }) => {
      if (response.success && response.stats !== undefined) {
        const { totalEvents, totalTabs, totalDiscards } = response.stats;
        statsElement.textContent = `${totalEvents} events • ${totalTabs} tabs • ${totalDiscards} discards`;
      } else {
        statsElement.textContent = 'Stats unavailable';
      }
    }
  );
}

// ============================================================================
// Event Handlers
// ============================================================================

function setupEventListeners(elements: PopupElements, initialInterval: DiscardInterval): void {
  let currentInterval = initialInterval;

  // Dashboard button
  elements.dashboardBtn.addEventListener('click', () => {
    void chrome.tabs.create({ url: 'html/dashboard.html' });
  });

  // Discard all button
  elements.discardAllBtn.addEventListener('click', () => {
    void handleDiscardAll(elements.discardAllBtn);
  });

  // Main toggle
  elements.toggle.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    void handleToggleChange(elements.status, enabled, currentInterval);
  });

  // Interval selector
  elements.intervalSelect.addEventListener('change', (e) => {
    const newInterval = parseInt((e.target as HTMLSelectElement).value, 10);
    if (isValidDiscardInterval(newInterval)) {
      currentInterval = newInterval;
      void handleIntervalChange(elements, currentInterval);
    }
  });

  // Export button
  elements.exportBtn.addEventListener('click', () => {
    void handleExport(elements.exportBtn);
  });
}

function handleDiscardAll(button: HTMLButtonElement): void {
  const confirmed = confirm('Discard all tabs except active and extensions?');
  if (!confirmed) return;

  button.textContent = 'Discarding...';
  button.disabled = true;

  chrome.runtime.sendMessage(
    { action: 'discardAll' },
    (response: MessageResponse<void> & { count?: number }) => {
      if (response.success && response.count !== undefined) {
        alert(`Discarded ${response.count} tabs`);
      }
      button.textContent = 'Discard All Tabs Now';
      button.disabled = false;
    }
  );
}

async function handleToggleChange(
  statusElement: HTMLElement,
  enabled: boolean,
  interval: DiscardInterval
): Promise<void> {
  await chrome.storage.local.set({ autoDiscardEnabled: enabled });

  void chrome.runtime.sendMessage({
    action: 'toggleAutoDiscard',
    enabled,
  });

  updateStatus(statusElement, enabled, interval);
}

async function handleIntervalChange(
  elements: PopupElements,
  newInterval: DiscardInterval
): Promise<void> {
  await chrome.storage.local.set({ discardInterval: newInterval });

  void chrome.runtime.sendMessage({
    action: 'updateInterval',
    interval: newInterval,
  });

  updateStatus(elements.status, elements.toggle.checked, newInterval);
}

function handleExport(button: HTMLButtonElement): void {
  button.textContent = 'Exporting...';
  button.disabled = true;

  chrome.runtime.sendMessage(
    { action: 'exportTelemetry' },
    (response: MessageResponse<ExportedData>) => {
      if (response.success && response.data !== undefined) {
        downloadJson(response.data);
      }
      button.textContent = 'Export Data (JSON)';
      button.disabled = false;
    }
  );
}

function downloadJson(data: ExportedData): void {
  const dataStr = JSON.stringify(data, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `tab-telemetry-${new Date().toISOString().split('T')[0]}.json`;
  link.click();

  URL.revokeObjectURL(url);
}
