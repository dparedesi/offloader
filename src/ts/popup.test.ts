/**
 * @vitest-environment jsdom
 * Tests for popup UI controller.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mockChromeRuntime,
  mockChromeStorage,
  mockChromeTabs,
  resetMocks,
  storageData,
} from '../test/setup.js';

// Mock browser APIs not available in jsdom
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
}
if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = vi.fn();
}
globalThis.alert = vi.fn();
globalThis.confirm = vi.fn(() => true);

// ============================================================================
// DOM Setup Helpers
// ============================================================================

/**
 * Creates a minimal DOM structure needed by popup.ts
 */
function createPopupDOM(): void {
  document.body.innerHTML = `
    <input type="checkbox" id="autoToggle" />
    <div id="status" class="status"></div>
    <select id="intervalSelect">
      <option value="5">5 min</option>
      <option value="10">10 min</option>
      <option value="15">15 min</option>
      <option value="30">30 min</option>
    </select>
    <button id="discardAllBtn">Discard All Tabs Now</button>
    <button id="dashboardBtn">Dashboard</button>
    <button id="exportBtn">Export Data (JSON)</button>
    <div id="telemetryStats"></div>
    <div id="targetSitesContainer"></div>
  `;
}

/**
 * Clears DOM
 */
function clearDOM(): void {
  document.body.innerHTML = '';
}

/**
 * Helper to get DOM elements (mirrors getElements from popup.ts)
 */
function getElements() {
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

/**
 * Helper to trigger DOMContentLoaded
 */
function triggerDOMContentLoaded(): void {
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

/**
 * Wait for async operations to complete
 */
async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================================
// Tests
// ============================================================================

describe('Popup UI', () => {
  beforeEach(() => {
    resetMocks();
    createPopupDOM();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    clearDOM();
    vi.useRealTimers();
  });

  describe('DOM element references', () => {
    it('should find all required DOM elements', () => {
      const elements = getElements();
      expect(elements.toggle).toBeInstanceOf(HTMLInputElement);
      expect(elements.status).toBeInstanceOf(HTMLElement);
      expect(elements.intervalSelect).toBeInstanceOf(HTMLSelectElement);
      expect(elements.discardAllBtn).toBeInstanceOf(HTMLButtonElement);
      expect(elements.dashboardBtn).toBeInstanceOf(HTMLButtonElement);
      expect(elements.exportBtn).toBeInstanceOf(HTMLButtonElement);
      expect(elements.telemetryStats).toBeInstanceOf(HTMLElement);
      expect(elements.targetSitesContainer).toBeInstanceOf(HTMLElement);
    });
  });

  describe('initPopup', () => {
    it('should load state from storage and set initial UI', async () => {
      // Setup storage with test data
      storageData['autoDiscardEnabled'] = true;
      storageData['targetSites'] = { 'example.com': true, 'test.com': false };
      storageData['discardInterval'] = 15;
      storageData['lastRun'] = Date.now() - 300000; // 5 minutes ago
      storageData['lastDiscardedCount'] = 3;

      // Mock telemetry stats response
      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            const msg = message as { action: string };
            if (msg.action === 'getTelemetryStats') {
              setTimeout(() => {
                callback({
                  success: true,
                  stats: { totalEvents: 100, totalTabs: 50, totalDiscards: 25 },
                });
              }, 0);
            } else {
              setTimeout(() => callback({ success: true }), 0);
            }
          }
          return Promise.resolve({ success: true });
        }
      );

      // Import and trigger initialization
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();

      // Check toggle state
      expect(elements.toggle.checked).toBe(true);

      // Check interval selection
      expect(elements.intervalSelect.value).toBe('15');

      // Check target sites rendered
      expect(elements.targetSitesContainer.children.length).toBe(2);

      // Check telemetry stats loaded
      expect(mockChromeRuntime.sendMessage).toHaveBeenCalledWith(
        { action: 'getTelemetryStats' },
        expect.any(Function)
      );
    });

    it('should use default config when storage is empty', async () => {
      // Empty storage - use defaults
      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      // Re-import to trigger fresh initialization
      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();

      // Default: enabled is true (when undefined !== false)
      expect(elements.toggle.checked).toBe(true);

      // Default interval is 10
      expect(elements.intervalSelect.value).toBe('10');
    });

    it('should handle invalid discardInterval gracefully', async () => {
      storageData['discardInterval'] = 999; // Invalid

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      // Should fall back to default (10)
      expect(elements.intervalSelect.value).toBe('10');
    });
  });

  describe('renderTargetSites', () => {
    it('should show empty message when no sites configured', async () => {
      storageData['targetSites'] = {};

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      expect(elements.targetSitesContainer.textContent).toContain('No sites configured');
    });

    it('should render sites in sorted order', async () => {
      storageData['targetSites'] = {
        'zebra.com': true,
        'alpha.com': false,
        'middle.com': true,
      };

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      const labels = elements.targetSitesContainer.querySelectorAll('.toggle-label');

      // Sites should be sorted alphabetically
      expect(labels[0]?.textContent).toBe('Alpha.com');
      expect(labels[1]?.textContent).toBe('Middle.com');
      expect(labels[2]?.textContent).toBe('Zebra.com');
    });

    it('should capitalize first letter of site names', async () => {
      storageData['targetSites'] = { 'example.com': true };

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      const label = elements.targetSitesContainer.querySelector('.toggle-label');
      expect(label?.textContent).toBe('Example.com');
    });

    it('should set checkbox states correctly', async () => {
      storageData['targetSites'] = {
        'enabled.com': true,
        'disabled.com': false,
      };

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      const checkboxes = elements.targetSitesContainer.querySelectorAll<HTMLInputElement>('.site-toggle');

      // First is disabled.com (sorted alphabetically), checked = false
      expect(checkboxes[0]?.dataset['site']).toBe('disabled.com');
      expect(checkboxes[0]?.checked).toBe(false);

      // Second is enabled.com, checked = true
      expect(checkboxes[1]?.dataset['site']).toBe('enabled.com');
      expect(checkboxes[1]?.checked).toBe(true);
    });
  });

  describe('handleSiteToggle', () => {
    it('should update storage and send message when site toggled', async () => {
      storageData['targetSites'] = { 'example.com': false };

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      const checkbox = elements.targetSitesContainer.querySelector<HTMLInputElement>('.site-toggle');
      expect(checkbox).not.toBeNull();

      // Toggle the checkbox
      checkbox!.checked = true;
      checkbox!.dispatchEvent(new Event('change'));
      await flushPromises();
      await vi.runAllTimersAsync();

      // Verify storage was updated
      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        targetSites: expect.objectContaining({ 'example.com': true }),
      });

      // Verify message was sent
      expect(mockChromeRuntime.sendMessage).toHaveBeenCalledWith({
        action: 'updateTargetSites',
        targetSites: expect.objectContaining({ 'example.com': true }),
      });
    });
  });

  describe('updateStatus', () => {
    it('should show ON status with interval', async () => {
      storageData['autoDiscardEnabled'] = true;
      storageData['discardInterval'] = 15;

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      expect(elements.status.textContent).toContain('Auto-discard is ON');
      expect(elements.status.textContent).toContain('every 15 min');
      expect(elements.status.className).toContain('status-on');
    });

    it('should show OFF status', async () => {
      storageData['autoDiscardEnabled'] = false;

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      expect(elements.status.textContent).toBe('Auto-discard is OFF');
      expect(elements.status.className).toContain('status-off');
    });

    it('should show last run info when available', async () => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      storageData['autoDiscardEnabled'] = true;
      storageData['discardInterval'] = 10;
      storageData['lastRun'] = fiveMinutesAgo;
      storageData['lastDiscardedCount'] = 7;

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      expect(elements.status.textContent).toContain('Last run:');
      expect(elements.status.textContent).toContain('5m ago');
      expect(elements.status.textContent).toContain('7 tabs');
    });
  });

  describe('loadTelemetryStats', () => {
    it('should display telemetry stats on success', async () => {
      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            const msg = message as { action: string };
            if (msg.action === 'getTelemetryStats') {
              setTimeout(() => {
                callback({
                  success: true,
                  stats: { totalEvents: 150, totalTabs: 75, totalDiscards: 30 },
                });
              }, 0);
            } else {
              setTimeout(() => callback({ success: true }), 0);
            }
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      expect(elements.telemetryStats.textContent).toBe('150 events • 75 tabs • 30 discards');
    });

    it('should show unavailable message on failure', async () => {
      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            const msg = message as { action: string };
            if (msg.action === 'getTelemetryStats') {
              setTimeout(() => {
                callback({ success: false, error: 'Failed' });
              }, 0);
            } else {
              setTimeout(() => callback({ success: true }), 0);
            }
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      expect(elements.telemetryStats.textContent).toBe('Stats unavailable');
    });

    it('should show unavailable when stats are undefined', async () => {
      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            const msg = message as { action: string };
            if (msg.action === 'getTelemetryStats') {
              setTimeout(() => {
                callback({ success: true }); // success but no stats
              }, 0);
            } else {
              setTimeout(() => callback({ success: true }), 0);
            }
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      expect(elements.telemetryStats.textContent).toBe('Stats unavailable');
    });
  });

  describe('event listeners', () => {
    beforeEach(async () => {
      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();
    });

    describe('dashboard button', () => {
      it('should open dashboard in new tab', async () => {
        const elements = getElements();
        elements.dashboardBtn.click();
        await flushPromises();

        expect(mockChromeTabs.create).toHaveBeenCalledWith({
          url: 'html/dashboard.html',
        });
      });
    });

    describe('main toggle', () => {
      it('should update storage and send message when toggled off', async () => {
        const elements = getElements();

        // Toggle off
        elements.toggle.checked = false;
        elements.toggle.dispatchEvent(new Event('change'));
        await flushPromises();
        await vi.runAllTimersAsync();

        expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
          autoDiscardEnabled: false,
        });

        expect(mockChromeRuntime.sendMessage).toHaveBeenCalledWith({
          action: 'toggleAutoDiscard',
          enabled: false,
        });

        expect(elements.status.textContent).toBe('Auto-discard is OFF');
      });

      it('should update storage and send message when toggled on', async () => {
        const elements = getElements();

        // First toggle off
        elements.toggle.checked = false;
        elements.toggle.dispatchEvent(new Event('change'));
        await flushPromises();
        await vi.runAllTimersAsync();

        // Then toggle on
        elements.toggle.checked = true;
        elements.toggle.dispatchEvent(new Event('change'));
        await flushPromises();
        await vi.runAllTimersAsync();

        expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
          autoDiscardEnabled: true,
        });

        expect(mockChromeRuntime.sendMessage).toHaveBeenCalledWith({
          action: 'toggleAutoDiscard',
          enabled: true,
        });
      });
    });

    describe('interval selector', () => {
      it('should update storage and send message when interval changed', async () => {
        const elements = getElements();

        elements.intervalSelect.value = '30';
        elements.intervalSelect.dispatchEvent(new Event('change'));
        await flushPromises();
        await vi.runAllTimersAsync();

        expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
          discardInterval: 30,
        });

        expect(mockChromeRuntime.sendMessage).toHaveBeenCalledWith({
          action: 'updateInterval',
          interval: 30,
        });
      });

      it('should ignore invalid interval values', async () => {
        const elements = getElements();
        mockChromeStorage.local.set.mockClear();

        // Set to an invalid value
        elements.intervalSelect.value = '99';
        elements.intervalSelect.dispatchEvent(new Event('change'));
        await flushPromises();
        await vi.runAllTimersAsync();

        // Should not call storage.set for invalid interval
        expect(mockChromeStorage.local.set).not.toHaveBeenCalledWith(
          expect.objectContaining({ discardInterval: 99 })
        );
      });
    });

    describe('discard all button', () => {
      it.skip('should send discard all message when confirmed', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        mockChromeRuntime.sendMessage.mockImplementation(
          (message: unknown, callback?: (response: unknown) => void) => {
            if (callback !== undefined) {
              const msg = message as { action: string };
              if (msg.action === 'discardAll') {
                setTimeout(() => callback({ success: true, count: 5 }), 0);
              } else {
                setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
              }
            }
            return Promise.resolve({ success: true });
          }
        );

        const elements = getElements();
        elements.discardAllBtn.click();
        await flushPromises();

        // Button should be disabled while processing
        expect(elements.discardAllBtn.textContent).toBe('Discarding...');
        expect(elements.discardAllBtn.disabled).toBe(true);

        await vi.runAllTimersAsync();

        expect(mockChromeRuntime.sendMessage).toHaveBeenCalledWith(
          { action: 'discardAll' },
          expect.any(Function)
        );

        expect(alertSpy).toHaveBeenCalledWith('Discarded 5 tabs');

        // Button should be restored
        expect(elements.discardAllBtn.textContent).toBe('Discard All Tabs Now');
        expect(elements.discardAllBtn.disabled).toBe(false);

        confirmSpy.mockRestore();
        alertSpy.mockRestore();
      });

      it('should not send message when not confirmed', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        mockChromeRuntime.sendMessage.mockClear();

        const elements = getElements();
        elements.discardAllBtn.click();
        await flushPromises();
        await vi.runAllTimersAsync();

        // Should not send discardAll message
        expect(mockChromeRuntime.sendMessage).not.toHaveBeenCalledWith(
          { action: 'discardAll' },
          expect.any(Function)
        );

        confirmSpy.mockRestore();
      });

      it('should restore button even on unsuccessful response', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

        mockChromeRuntime.sendMessage.mockImplementation(
          (message: unknown, callback?: (response: unknown) => void) => {
            if (callback !== undefined) {
              const msg = message as { action: string };
              if (msg.action === 'discardAll') {
                setTimeout(() => callback({ success: false, error: 'Failed' }), 0);
              } else {
                setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
              }
            }
            return Promise.resolve({ success: true });
          }
        );

        const elements = getElements();
        elements.discardAllBtn.click();
        await flushPromises();
        await vi.runAllTimersAsync();

        // Button should be restored even on failure
        expect(elements.discardAllBtn.textContent).toBe('Discard All Tabs Now');
        expect(elements.discardAllBtn.disabled).toBe(false);

        confirmSpy.mockRestore();
      });
    });

    describe('export button', () => {
      it.skip('should download JSON when export succeeds', async () => {
        const testData = {
          exportDate: '2024-01-01',
          tabEvents: [],
          tabMetadata: [],
          discardEvents: [],
        };

        mockChromeRuntime.sendMessage.mockImplementation(
          (message: unknown, callback?: (response: unknown) => void) => {
            if (callback !== undefined) {
              const msg = message as { action: string };
              if (msg.action === 'exportTelemetry') {
                setTimeout(() => callback({ success: true, data: testData }), 0);
              } else {
                setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
              }
            }
            return Promise.resolve({ success: true });
          }
        );

        // Mock URL APIs
        const mockUrl = 'blob:test';
        const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue(mockUrl);
        const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        // Track the created link element
        let createdLink: HTMLAnchorElement | null = null;
        const originalCreateElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
          const element = originalCreateElement(tag);
          if (tag === 'a') {
            createdLink = element as HTMLAnchorElement;
            vi.spyOn(createdLink, 'click').mockImplementation(() => {});
          }
          return element;
        });

        const elements = getElements();
        elements.exportBtn.click();
        await flushPromises();

        // Button should be disabled while processing
        expect(elements.exportBtn.textContent).toBe('Exporting...');
        expect(elements.exportBtn.disabled).toBe(true);

        await vi.runAllTimersAsync();

        expect(mockChromeRuntime.sendMessage).toHaveBeenCalledWith(
          { action: 'exportTelemetry' },
          expect.any(Function)
        );

        // Verify download was triggered
        expect(createObjectURLSpy).toHaveBeenCalled();
        expect(createdLink).not.toBeNull();
        expect(createdLink?.href).toBe(mockUrl);
        expect(createdLink?.download).toMatch(/^tab-telemetry-\d{4}-\d{2}-\d{2}\.json$/);
        expect(revokeObjectURLSpy).toHaveBeenCalledWith(mockUrl);

        // Button should be restored
        expect(elements.exportBtn.textContent).toBe('Export Data (JSON)');
        expect(elements.exportBtn.disabled).toBe(false);

        createObjectURLSpy.mockRestore();
        revokeObjectURLSpy.mockRestore();
      });

      it('should restore button even when export fails', async () => {
        mockChromeRuntime.sendMessage.mockImplementation(
          (message: unknown, callback?: (response: unknown) => void) => {
            if (callback !== undefined) {
              const msg = message as { action: string };
              if (msg.action === 'exportTelemetry') {
                setTimeout(() => callback({ success: false, error: 'Export failed' }), 0);
              } else {
                setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
              }
            }
            return Promise.resolve({ success: true });
          }
        );

        const elements = getElements();
        elements.exportBtn.click();
        await flushPromises();
        await vi.runAllTimersAsync();

        // Button should be restored
        expect(elements.exportBtn.textContent).toBe('Export Data (JSON)');
        expect(elements.exportBtn.disabled).toBe(false);
      });

      it('should not download when data is undefined', async () => {
        mockChromeRuntime.sendMessage.mockImplementation(
          (message: unknown, callback?: (response: unknown) => void) => {
            if (callback !== undefined) {
              const msg = message as { action: string };
              if (msg.action === 'exportTelemetry') {
                setTimeout(() => callback({ success: true }), 0); // success but no data
              } else {
                setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
              }
            }
            return Promise.resolve({ success: true });
          }
        );

        const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL');

        const elements = getElements();
        elements.exportBtn.click();
        await flushPromises();
        await vi.runAllTimersAsync();

        // Should not create object URL when data is undefined
        expect(createObjectURLSpy).not.toHaveBeenCalled();

        createObjectURLSpy.mockRestore();
      });
    });
  });

  describe('edge cases', () => {
    it('should handle sites with special characters in display name', async () => {
      storageData['targetSites'] = { '123site.com': true };

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      const label = elements.targetSitesContainer.querySelector('.toggle-label');
      // First char capitalized (1 -> 1)
      expect(label?.textContent).toBe('123site.com');
    });

    it('should handle very long site names', async () => {
      const longSite = 'a'.repeat(100) + '.com';
      storageData['targetSites'] = { [longSite]: true };

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      const label = elements.targetSitesContainer.querySelector('.toggle-label');
      expect(label?.textContent.startsWith('A')).toBe(true);
      expect(label?.textContent.length).toBeGreaterThan(100);
    });

    it('should handle concurrent toggle changes', async () => {
      storageData['targetSites'] = {
        'site1.com': false,
        'site2.com': false,
      };

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      const checkboxes = elements.targetSitesContainer.querySelectorAll<HTMLInputElement>('.site-toggle');

      // Toggle both sites simultaneously
      checkboxes[0]!.checked = true;
      checkboxes[0]!.dispatchEvent(new Event('change'));

      checkboxes[1]!.checked = true;
      checkboxes[1]!.dispatchEvent(new Event('change'));

      await flushPromises();
      await vi.runAllTimersAsync();

      // Both should have been updated
      expect(mockChromeStorage.local.set).toHaveBeenCalled();
      expect(mockChromeRuntime.sendMessage).toHaveBeenCalledWith({
        action: 'updateTargetSites',
        targetSites: expect.any(Object),
      });
    });

    it('should handle status update when lastRun is defined but lastCount is undefined', async () => {
      storageData['autoDiscardEnabled'] = true;
      storageData['discardInterval'] = 10;
      storageData['lastRun'] = Date.now() - 60000;
      // lastDiscardedCount is undefined

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      // Should not show last run info when lastCount is undefined
      expect(elements.status.textContent).not.toContain('Last run:');
    });

    it('should handle status update when lastCount is defined but lastRun is undefined', async () => {
      storageData['autoDiscardEnabled'] = true;
      storageData['discardInterval'] = 10;
      // lastRun is undefined
      storageData['lastDiscardedCount'] = 5;

      mockChromeRuntime.sendMessage.mockImplementation(
        (message: unknown, callback?: (response: unknown) => void) => {
          if (callback !== undefined) {
            setTimeout(() => callback({ success: true, stats: { totalEvents: 0, totalTabs: 0, totalDiscards: 0 } }), 0);
          }
          return Promise.resolve({ success: true });
        }
      );

      vi.resetModules();
      await import('./popup.js');
      triggerDOMContentLoaded();
      await flushPromises();
      await vi.runAllTimersAsync();

      const elements = getElements();
      // Should not show last run info when lastRun is undefined
      expect(elements.status.textContent).not.toContain('Last run:');
    });
  });
});
