import { jest } from '@jest/globals';

const { getUserContext, validateTenantAccess, formatAuthError } = await import('../functions/auth/get-user-context.mjs');

describe('Get User Context', () => {
  describe('getUserContext', () => {
    it('should extract user context from Lambda authorizer', () => {
      const event = {
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            username: 'testuser',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        }
      };

      const result = getUserContext(event);

      expect(result).toEqual({
        userId: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        tenantId: 'tenant-456',
        role: 'user',
        isAdmin: false,
        isTenantAdmin: false
      });
    });

    it('should handle null tenant ID', () => {
      const event = {
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            username: 'testuser',
            tenantId: 'null', // String 'null' from Lambda authorizer
            role: 'admin',
            isAdmin: 'true',
            isTenantAdmin: 'false'
          }
        }
      };

      const result = getUserContext(event);

      expect(result).toEqual({
        userId: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        tenantId: 'null',
        role: 'admin',
        isAdmin: true,
        isTenantAdmin: false
      });
    });

    it('should handle API key authentication context', () => {
      const event = {
        requestContext: {
          authorizer: {
            userId: 'user-789',
            tenantId: 'tenant-abc',
            keyId: 'key-def',
            authType: 'api_key',
            email: 'api@example.com', // API keys still need a valid email
            username: 'null',
            role: 'api_user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        }
      };

      const result = getUserContext(event);

      expect(result).toEqual({
        userId: 'user-789',
        email: 'api@example.com',
        username: null,
        tenantId: 'tenant-abc',
        role: 'api_user',
        isAdmin: false,
        isTenantAdmin: false
      });
    });

    it('should throw error when no authorization context', () => {
      const event = {
        requestContext: {}
      };

      expect(() => getUserContext(event)).toThrow('Invalid authorization context');
    });

    it('should throw error when missing required fields', () => {
      const event = {
        requestContext: {
          authorizer: {
            // Missing userId and email
            tenantId: 'tenant-456',
            role: 'user'
          }
        }
      };

      expect(() => getUserContext(event)).toThrow('Invalid authorization context');
    });

    it('should handle missing optional fields', () => {
      const event = {
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com'
            // Missing optional fields
          }
        }
      };

      const result = getUserContext(event);

      expect(result).toEqual({
        userId: 'user-123',
        email: 'test@example.com',
        username: undefined,
        tenantId: null,
        role: 'user', // Function defaults to 'user' when role is undefined
        isAdmin: false,
        isTenantAdmin: false
      });
    });

    it('should handle string "null" values correctly', () => {
      const event = {
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            username: 'null', // String 'null' should become null
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        }
      };

      const result = getUserContext(event);

      expect(result).toEqual({
        userId: 'user-123',
        email: 'test@example.com',
        username: null,
        tenantId: 'tenant-456',
        role: 'user',
        isAdmin: false,
        isTenantAdmin: false
      });
    });

    it('should throw error when missing userId', () => {
      const event = {
        requestContext: {
          authorizer: {
            email: 'test@example.com',
            tenantId: 'tenant-456'
          }
        }
      };

      expect(() => getUserContext(event)).toThrow('Invalid authorization context');
    });

    it('should throw error when missing email', () => {
      const event = {
        requestContext: {
          authorizer: {
            userId: 'user-123',
            tenantId: 'tenant-456'
          }
        }
      };

      expect(() => getUserContext(event)).toThrow('Invalid authorization context');
    });

    it('should throw error when email is null string', () => {
      const event = {
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'null', // String 'null' becomes null, which should fail validation
            tenantId: 'tenant-456'
          }
        }
      };

      expect(() => getUserContext(event)).toThrow('Invalid authorization context');
    });

    it('should handle tenant admin with admin privileges', () => {
      const event = {
        requestContext: {
          authorizer: {
            userId: 'admin-123',
            email: 'admin@example.com',
            username: 'admin',
            tenantId: 'tenant-456',
            role: 'admin',
            isAdmin: 'true',
            isTenantAdmin: 'true'
          }
        }
      };

      const result = getUserContext(event);

      expect(result).toEqual({
        userId: 'admin-123',
        email: 'admin@example.com',
        username: 'admin',
        tenantId: 'tenant-456',
        role: 'admin',
        isAdmin: true,
        isTenantAdmin: true
      });
    });
  });

  describe('validateTenantAccess', () => {
    it('should allow admin access to any tenant', () => {
      const userContext = {
        userId: 'admin-123',
        isAdmin: true,
        tenantId: 'tenant-456'
      };

      const result = validateTenantAccess(userContext, 'different-tenant');
      expect(result).toBe(true);
    });

    it('should allow user access to their own tenant', () => {
      const userContext = {
        userId: 'user-123',
        isAdmin: false,
        tenantId: 'tenant-456'
      };

      const result = validateTenantAccess(userContext, 'tenant-456');
      expect(result).toBe(true);
    });

    it('should deny user access to different tenant', () => {
      const userContext = {
        userId: 'user-123',
        isAdmin: false,
        tenantId: 'tenant-456'
      };

      const result = validateTenantAccess(userContext, 'different-tenant');
      expect(result).toBe(false);
    });

    it('should deny access when user has no tenant', () => {
      const userContext = {
        userId: 'user-123',
        isAdmin: false,
        tenantId: null
      };

      const result = validateTenantAccess(userContext, 'tenant-456');
      expect(result).toBe(false);
    });

    it('should allow tenant admin access to their tenant', () => {
      const userContext = {
        userId: 'tenant-admin-123',
        isAdmin: false,
        isTenantAdmin: true,
        tenantId: 'tenant-456'
      };

      const result = validateTenantAccess(userContext, 'tenant-456');
      expect(result).toBe(true);
    });

    it('should deny tenant admin access to different tenant', () => {
      const userContext = {
        userId: 'tenant-admin-123',
        isAdmin: false,
        isTenantAdmin: true,
        tenantId: 'tenant-456'
      };

      const result = validateTenantAccess(userContext, 'different-tenant');
      expect(result).toBe(false);
    });

    it('should handle undefined tenantId in user context', () => {
      const userContext = {
        userId: 'user-123',
        isAdmin: false,
        tenantId: undefined
      };

      const result = validateTenantAccess(userContext, 'tenant-456');
      expect(result).toBe(false);
    });

    it('should handle empty string tenantId', () => {
      const userContext = {
        userId: 'user-123',
        isAdmin: false,
        tenantId: ''
      };

      const result = validateTenantAccess(userContext, 'tenant-456');
      expect(result).toBe(false);
    });
  });

  describe('formatAuthError', () => {
    it('should format default auth error', () => {
      const result = formatAuthError();

      expect(result).toEqual({
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ message: 'Unauthorized' })
      });
    });

    it('should format custom auth error message', () => {
      const result = formatAuthError('Custom error message');

      expect(result).toEqual({
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ message: 'Custom error message' })
      });
    });

    it('should use ORIGIN environment variable when available', () => {
      const originalOrigin = process.env.ORIGIN;
      process.env.ORIGIN = 'https://example.com';

      const result = formatAuthError('Test message');

      expect(result.headers['Access-Control-Allow-Origin']).toBe('https://example.com');

      // Restore original value
      if (originalOrigin) {
        process.env.ORIGIN = originalOrigin;
      } else {
        delete process.env.ORIGIN;
      }
    });

    it('should handle missing ORIGIN environment variable', () => {
      const originalOrigin = process.env.ORIGIN;
      delete process.env.ORIGIN;

      const result = formatAuthError('Test message');

      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');

      // Restore original value
      if (originalOrigin) {
        process.env.ORIGIN = originalOrigin;
      }
    });
  });

  describe('Edge Cases and Integration', () => {
    it('should handle malformed requestContext', () => {
      const event = {
        requestContext: null
      };

      expect(() => getUserContext(event)).toThrow('Invalid authorization context');
    });

    it('should handle missing requestContext entirely', () => {
      const event = {};

      expect(() => getUserContext(event)).toThrow('Invalid authorization context');
    });

    it('should handle boolean string values correctly', () => {
      const event = {
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            username: 'testuser',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'true',
            isTenantAdmin: 'false'
          }
        }
      };

      const result = getUserContext(event);

      expect(result.isAdmin).toBe(true);
      expect(result.isTenantAdmin).toBe(false);
    });

    it('should handle non-string boolean values', () => {
      const event = {
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            username: 'testuser',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: true, // actual boolean instead of string
            isTenantAdmin: false
          }
        }
      };

      const result = getUserContext(event);

      // Function only recognizes string 'true', so boolean true becomes false
      expect(result.isAdmin).toBe(false);
      expect(result.isTenantAdmin).toBe(false);
    });

    it('should validate tenant access with complex user context', () => {
      const userContext = getUserContext({
        requestContext: {
          authorizer: {
            userId: 'user-123',
            email: 'test@example.com',
            username: 'testuser',
            tenantId: 'tenant-456',
            role: 'user',
            isAdmin: 'false',
            isTenantAdmin: 'false'
          }
        }
      });

      expect(validateTenantAccess(userContext, 'tenant-456')).toBe(true);
      expect(validateTenantAccess(userContext, 'different-tenant')).toBe(false);
    });

    it('should handle super admin with no tenant accessing any tenant', () => {
      const userContext = {
        userId: 'super-admin',
        email: 'admin@system.com',
        isAdmin: true,
        tenantId: null // Super admin might not have a specific tenant
      };

      expect(validateTenantAccess(userContext, 'any-tenant')).toBe(true);
      expect(validateTenantAccess(userContext, 'another-tenant')).toBe(true);
    });
  });
});
