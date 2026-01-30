/**
 * Email hashing utility for privacy-preserving subscriber tracking
 *
 * Uses SHA-256 to hash email addresses before storing in analytics events.
 * Returns full hash (no truncation) for maximum uniqueness.
 */

import crypto from 'crypto';

/**
 * Hash an email address using SHA-256
 *
 * @param {string} email - Email address to hash
 * @returns {string} Full SHA-256 hash as hex string (64 characters)
 * @throws {Error} If email is not provided or invalid
 */
export function hashEmail(email) {
  if (!email || typeof email !== 'string') {
    throw new Error('Email must be a non-empty string');
  }

  const trimmedEmail = email.trim().toLowerCase();

  if (trimmedEmail.length === 0) {
    throw new Error('Email must be a non-empty string');
  }

  return crypto.createHash('sha256').update(trimmedEmail).digest('hex');
}
