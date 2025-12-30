/**
 * Tests for type validation functions.
 */

import { describe, expect, it } from 'vitest';

import {
  isValidDiscardInterval,
  isValidDomain,
  isValidIdleThreshold,
  isValidDataRetentionDays,
} from './types.js';

describe('isValidDiscardInterval', () => {
  it('should accept valid intervals', () => {
    expect(isValidDiscardInterval(5)).toBe(true);
    expect(isValidDiscardInterval(10)).toBe(true);
    expect(isValidDiscardInterval(15)).toBe(true);
    expect(isValidDiscardInterval(30)).toBe(true);
  });

  it('should reject invalid intervals', () => {
    expect(isValidDiscardInterval(0)).toBe(false);
    expect(isValidDiscardInterval(1)).toBe(false);
    expect(isValidDiscardInterval(7)).toBe(false);
    expect(isValidDiscardInterval(20)).toBe(false);
    expect(isValidDiscardInterval(60)).toBe(false);
    expect(isValidDiscardInterval(-5)).toBe(false);
  });
});

describe('isValidIdleThreshold', () => {
  it('should accept valid thresholds', () => {
    expect(isValidIdleThreshold(0)).toBe(true); // 0 disables the feature
    expect(isValidIdleThreshold(1)).toBe(true);
    expect(isValidIdleThreshold(24)).toBe(true);
    expect(isValidIdleThreshold(720)).toBe(true); // 30 days max
  });

  it('should reject invalid thresholds', () => {
    expect(isValidIdleThreshold(-1)).toBe(false);
    expect(isValidIdleThreshold(721)).toBe(false);
    expect(isValidIdleThreshold(1000)).toBe(false);
    expect(isValidIdleThreshold(1.5)).toBe(false); // Must be integer
    expect(isValidIdleThreshold(NaN)).toBe(false);
  });
});

describe('isValidDataRetentionDays', () => {
  it('should accept valid retention periods', () => {
    expect(isValidDataRetentionDays(1)).toBe(true);
    expect(isValidDataRetentionDays(7)).toBe(true);
    expect(isValidDataRetentionDays(30)).toBe(true);
    expect(isValidDataRetentionDays(365)).toBe(true);
  });

  it('should reject invalid retention periods', () => {
    expect(isValidDataRetentionDays(0)).toBe(false); // At least 1 day
    expect(isValidDataRetentionDays(-1)).toBe(false);
    expect(isValidDataRetentionDays(366)).toBe(false);
    expect(isValidDataRetentionDays(1.5)).toBe(false);
  });
});

describe('isValidDomain', () => {
  it('should accept valid domains', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain('sub.example.com')).toBe(true);
    expect(isValidDomain('my-site.co.uk')).toBe(true);
    expect(isValidDomain('sharepoint')).toBe(true); // Partial match
    expect(isValidDomain('slack')).toBe(true);
    expect(isValidDomain('123.com')).toBe(true);
  });

  it('should reject invalid domains', () => {
    expect(isValidDomain('')).toBe(false);
    expect(isValidDomain('   ')).toBe(false);
    expect(isValidDomain('has spaces.com')).toBe(false);
    expect(isValidDomain('-starts-with-dash.com')).toBe(false);
    expect(isValidDomain('ends-with-dash-.com')).toBe(false);
    expect(isValidDomain('has..double.dots')).toBe(false);
    expect(isValidDomain('a'.repeat(254))).toBe(false); // Too long
  });

  it('should handle edge cases', () => {
    expect(isValidDomain('a')).toBe(true); // Single char is valid
    expect(isValidDomain('a'.repeat(253))).toBe(true); // Max length
    expect(isValidDomain('UPPERCASE.COM')).toBe(true); // Case insensitive
  });
});
