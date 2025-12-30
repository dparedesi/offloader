/**
 * Test setup file for vitest.
 * Mocks Chrome extension APIs and IndexedDB.
 */

import { vi } from 'vitest';
import 'fake-indexeddb/auto';

// Mock chrome.storage.local
const storageData: Record<string, unknown> = {};

const mockChromeStorage = {
  local: {
    get: vi.fn((keys: string | string[]) => {
      return Promise.resolve(
        Array.isArray(keys)
          ? keys.reduce(
              (acc, key) => {
                if (key in storageData) {
                  acc[key] = storageData[key];
                }
                return acc;
              },
              {} as Record<string, unknown>
            )
          : { [keys]: storageData[keys] }
      );
    }),
    set: vi.fn((items: Record<string, unknown>) => {
      Object.assign(storageData, items);
      return Promise.resolve();
    }),
    remove: vi.fn((keys: string | string[]) => {
      const keysArray = Array.isArray(keys) ? keys : [keys];
      keysArray.forEach((key) => delete storageData[key]);
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      Object.keys(storageData).forEach((key) => delete storageData[key]);
      return Promise.resolve();
    }),
  },
};

// Mock chrome.alarms
const alarms: Map<string, chrome.alarms.Alarm> = new Map();
const alarmListeners: ((alarm: chrome.alarms.Alarm) => void)[] = [];

const mockChromeAlarms = {
  create: vi.fn((name: string, alarmInfo: chrome.alarms.AlarmCreateInfo) => {
    const alarm: chrome.alarms.Alarm = {
      name,
      scheduledTime: Date.now() + (alarmInfo.delayInMinutes ?? 0) * 60 * 1000,
      periodInMinutes: alarmInfo.periodInMinutes,
    };
    alarms.set(name, alarm);
    return Promise.resolve();
  }),
  get: vi.fn((name: string) => {
    return Promise.resolve(alarms.get(name));
  }),
  clear: vi.fn((name: string) => {
    const existed = alarms.has(name);
    alarms.delete(name);
    return Promise.resolve(existed);
  }),
  clearAll: vi.fn(() => {
    alarms.clear();
    return Promise.resolve();
  }),
  getAll: vi.fn(() => {
    return Promise.resolve(Array.from(alarms.values()));
  }),
  onAlarm: {
    addListener: vi.fn((callback: (alarm: chrome.alarms.Alarm) => void) => {
      alarmListeners.push(callback);
    }),
    removeListener: vi.fn((callback: (alarm: chrome.alarms.Alarm) => void) => {
      const index = alarmListeners.indexOf(callback);
      if (index > -1) {
        alarmListeners.splice(index, 1);
      }
    }),
    hasListener: vi.fn((callback: (alarm: chrome.alarms.Alarm) => void) => {
      return alarmListeners.includes(callback);
    }),
  },
};

// Mock chrome.tabs
const mockChromeTabs = {
  query: vi.fn(() => Promise.resolve([])),
  discard: vi.fn((tabId: number) => Promise.resolve()),
  create: vi.fn((createProperties: chrome.tabs.CreateProperties) =>
    Promise.resolve({ id: Math.random(), ...createProperties })
  ),
  onCreated: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(),
  },
  onActivated: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(),
  },
  onUpdated: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(),
  },
  onRemoved: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(),
  },
};

// Mock chrome.runtime
const messageListeners: ((
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void)[] = [];

const mockChromeRuntime = {
  sendMessage: vi.fn(
    (message: unknown, callback?: (response: unknown) => void) => {
      // Simulate async response
      if (callback !== undefined) {
        setTimeout(() => callback({ success: true }), 0);
      }
      return Promise.resolve({ success: true });
    }
  ),
  onMessage: {
    addListener: vi.fn(
      (
        callback: (
          message: unknown,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ) => {
        messageListeners.push(callback);
      }
    ),
    removeListener: vi.fn(),
    hasListener: vi.fn(),
  },
  onInstalled: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(),
  },
  onStartup: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(),
  },
};

// Assemble mock chrome object
const mockChrome = {
  storage: mockChromeStorage,
  alarms: mockChromeAlarms,
  tabs: mockChromeTabs,
  runtime: mockChromeRuntime,
};

// Set global chrome object
(globalThis as Record<string, unknown>).chrome = mockChrome;

// Export for tests that need to access mocks directly
export {
  mockChromeStorage,
  mockChromeAlarms,
  mockChromeTabs,
  mockChromeRuntime,
  storageData,
  alarms,
  alarmListeners,
};

// Helper to trigger an alarm (for testing)
export function triggerAlarm(name: string): void {
  const alarm = alarms.get(name);
  if (alarm !== undefined) {
    alarmListeners.forEach((listener) => listener(alarm));
  }
}

// Helper to clear all mocks between tests
export function resetMocks(): void {
  vi.clearAllMocks();
  Object.keys(storageData).forEach((key) => delete storageData[key]);
  alarms.clear();
}
