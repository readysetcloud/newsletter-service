/**
 * Unit tests for email hashing utility
 */

import { hashEmail } from '../hash-email.mjs';

describe('hashEmail', () => {
  it('should hash email address using SHA-256', () => {
    const email = 'test@example.com';
    const hash = hashEmail(email);

    // SHA-256 produces 64 character hex string
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should return full hash without truncation', () => {
    const email = 'user@domain.com';
    const hash = hashEmail(email);

    // Verify it's a complete SHA-256 hash (64 hex characters)
    expect(hash).toHaveLength(64);
  });

  it('should produce consistent hash for same email', () => {
    const email = 'consistent@test.com';
    const hash1 = hashEmail(email);
    const hash2 = hashEmail(email);

    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different emails', () => {
    const email1 = 'user1@example.com';
    const email2 = 'user2@example.com';

    const hash1 = hashEmail(email1);
    const hash2 = hashEmail(email2);

    expect(hash1).not.toBe(hash2);
  });

  it('should normalize email to lowercase before hashing', () => {
    const email1 = 'User@Example.COM';
    const email2 = 'user@example.com';

    const hash1 = hashEmail(email1);
    const hash2 = hashEmail(email2);

    expect(hash1).toBe(hash2);
  });

  it('should trim whitespace before hashing', () => {
    const email1 = '  user@example.com  ';
    const email2 = 'user@example.com';

    const hash1 = hashEmail(email1);
    const hash2 = hashEmail(email2);

    expect(hash1).toBe(hash2);
  });

  it('should throw error for empty string', () => {
    expect(() => hashEmail('')).toThrow('Email must be a non-empty string');
  });

  it('should throw error for whitespace-only string', () => {
    expect(() => hashEmail('   ')).toThrow('Email must be a non-empty string');
  });

  it('should throw error for null', () => {
    expect(() => hashEmail(null)).toThrow('Email must be a non-empty string');
  });

  it('should throw error for undefined', () => {
    expect(() => hashEmail(undefined)).toThrow('Email must be a non-empty string');
  });

  it('should throw error for non-string input', () => {
    expect(() => hashEmail(123)).toThrow('Email must be a non-empty string');
    expect(() => hashEmail({})).toThrow('Email must be a non-empty string');
    expect(() => hashEmail([])).toThrow('Email must be a non-empty string');
  });

  it('should produce expected hash for known email', () => {
    // Test with a known email and its expected SHA-256 hash
    const email = 'test@example.com';
    const expectedHash = '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b';

    const hash = hashEmail(email);

    expect(hash).toBe(expectedHash);
  });
});
