import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  decodeJWTPayload,
  extractMomentoTokenFromJWT,
  extractTenantIdFromJWT,
  extractUserIdFromJWT,
  isJWTExpired,
  validateMomentoTokenInfo,
  type MomentoTokenInfo,
  type JWTPayload
} from '../jwtUtils';

// Mock console methods to avoid noise in tests
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

// Helper function to create a mock JWT token
function createMockJWT(payload: Partial<JWTPayload>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const fullPayload = {
    sub: 'user-123',
    email: 'test@example.com',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    iat: Math.floor(Date.now() / 1000),
    ...payload
  };

  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(fullPayload));
  const signature = 'mock-signature';

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

describe('jwtUtils', () => {
  describe('decodeJWTPayload', () => {
    it('should decode valid JWT payload', () => {
      const payload = {
        sub: 'user-123',
        email: 'test@example.com',
        'custom:tenant_id': 'tenant-456'
      };
      const token = createMockJWT(payload);

      const result = decodeJWTPayload(token);

      expect(result).toBeTruthy();
      expect(result?.sub).toBe('user-123');
      expect(result?.email).toBe('test@example.com');
      expect(result?.['custom:tenant_id']).toBe('tenant-456');
    });

    it('should return null for invalid token format', () => {
      const result = decodeJWTPayload('invalid-token');
      expect(result).toBeNull();
    });

    it('should return null for empty token', () => {
      const result = decodeJWTPayload('');
      expect(result).toBeNull();
    });
  });

  describe('extractMomentoTokenFromJWT', () => {
    it('should extract valid Momento token info', () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const payload = {
        'custom:momento_token': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature',
        'custom:momento_cache': 'test-cache',
        'custom:momento_expires': futureDate
      };
      const token = createMockJWT(payload);

      const result = extractMomentoTokenFromJWT(token);

      expect(result).toBeTruthy();
      expect(result?.token).toBe(payload['custom:momento_token']);
      expect(result?.cacheName).toBe('test-cache');
      expect(result?.expiresAt).toBe(futureDate);
      expect(result?.isValid).toBe(true);
      expect(result?.isExpired).toBe(false);
    });

    it('should return null when no Momento token exists', () => {
      const token = createMockJWT({});

      const result = extractMomentoTokenFromJWT(token);

      expect(result).toBeNull();
    });
  });

  describe('extractTenantIdFromJWT', () => {
    it('should extract tenant ID from JWT', () => {
      const payload = {
        'custom:tenant_id': 'tenant-123'
      };
      const token = createMockJWT(payload);

      const result = extractTenantIdFromJWT(token);

      expect(result).toBe('tenant-123');
    });

    it('should return null when tenant ID is missing', () => {
      const token = createMockJWT({});

      const result = extractTenantIdFromJWT(token);

      expect(result).toBeNull();
    });
  });

  describe('validateMomentoTokenInfo', () => {
    it('should validate complete token info', () => {
      const tokenInfo: MomentoTokenInfo = {
        token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature',
        cacheName: 'test-cache',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        isValid: true,
        isExpired: false
      };

      const result = validateMomentoTokenInfo(tokenInfo);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for null token info', () => {
      const result = validateMomentoTokenInfo(null);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('No Momento token information provided');
    });
  });
});
