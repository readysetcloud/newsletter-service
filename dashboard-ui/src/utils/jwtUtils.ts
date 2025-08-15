/**
 * JWT Token Utilities for Momento Authentication
 *
 * This utility provides functions to extract and validate Momento authentication
 * tokens from JWT tokens issued by Cognito Pre Token Generation Lambda.
 */

export interface MomentoTokenInfo {
  token: string;
  cacheName: string;
  expiresAt: string;
  isValid: boolean;
  isExpired: boolean;
}

export interface JWTPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  'custom:tenant_id'?: string;
  'custom:role'?: string;
  'custom:momento_token'?: string;
  'custom:momento_cache'?: string;
  'custom:momento_expires'?: string;
  'cognito:groups'?: string[];
  exp: number;
  iat: number;
  [key: string]: any;
}

/**
 * Safely decode JWT token payload without verification
 * This is safe for client-side use since we're only extracting claims
 * and the token has already been verified by Cognito
 */
export function decodeJWTPayload(token: string): JWTPayload | null {
  try {
    if (!token || typeof token !== 'string') {
      console.warn('Invalid token provided to decodeJWTPayload');
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      console.warn('Invalid JWT format - expected 3 parts');
      return null;
    }

    // Decode the payload (second part)
    const payload = parts[1];

    // Add padding if needed for base64 decoding
    const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);

    const decodedPayload = atob(paddedPayload);
    const parsedPayload = JSON.parse(decodedPayload);

    return parsedPayload as JWTPayload;
  } catch (error) {
    console.error('Error decoding JWT payload:', error);
    return null;
  }
}

/**
 * Extract Momento token information from JWT token
 * Returns null if no Momento token is found or if token is invalid
 */
export function extractMomentoTokenFromJWT(jwtToken: string): MomentoTokenInfo | null {
  try {
    const payload = decodeJWTPayload(jwtToken);

    if (!payload) {
      console.warn('Failed to decode JWT payload');
      return null;
    }

    const momentoToken = payload['custom:momento_token'];
    const cacheName = payload['custom:momento_cache'];
    const expiresAt = payload['custom:momento_expires'];

    // Check if Momento token exists
    if (!momentoToken) {
      console.info('No Momento token found in JWT claims');
      return null;
    }

    // Validate required fields
    if (!cacheName) {
      console.warn('Momento token found but cache name is missing');
      return null;
    }

    // Check if token is expired
    const isExpired = expiresAt ? new Date(expiresAt) <= new Date() : false;

    // Basic token format validation (should be a JWT-like string)
    const isValidFormat = typeof momentoToken === 'string' &&
                         momentoToken.split('.').length === 3;

    const tokenInfo: MomentoTokenInfo = {
      token: momentoToken,
      cacheName: cacheName,
      expiresAt: expiresAt || '',
      isValid: isValidFormat && !isExpired,
      isExpired: isExpired
    };

    if (isExpired) {
      console.warn('Momento token has expired:', expiresAt);
    }

    if (!isValidFormat) {
      console.warn('Momento token has invalid format');
    }

    return tokenInfo;
  } catch (error) {
    console.error('Error extracting Momento token from JWT:', error);
    return null;
  }
}

/**
 * Extract tenant ID from JWT token
 * Thisor tenant-scoped channel subscriptions
 */
export function extractTenantIdFromJWT(jwtToken: string): string | null {
  try {
    const payload = decodeJWTPayload(jwtToken);

    if (!payload) {
      return null;
    }

    return payload['custom:tenant_id'] || null;
  } catch (error) {
    console.error('Error extracting tenant ID from JWT:', error);
    return null;
  }
}

/**
 * Extract user ID from JWT token
 * This is used for user-specific operations
 */
export function extractUserIdFromJWT(jwtToken: string): string | null {
  try {
    const payload = decodeJWTPayload(jwtToken);

    if (!payload) {
      return null;
    }

    return payload.sub || null;
  } catch (error) {
    console.error('Error extracting user ID from JWT:', error);
    return null;
  }
}

/**
 * Check if JWT token is expired
 * This checks the standard 'exp' claim
 */
export function isJWTExpired(jwtToken: string): boolean {
  try {
    const payload = decodeJWTPayload(jwtToken);

    if (!payload || !payload.exp) {
      return true; // Assume expired if we can't determine
    }

    // JWT exp is in seconds, Date.now() is in milliseconds
    const expirationTime = payload.exp * 1000;
    const currentTime = Date.now();

    return currentTime >= expirationTime;
  } catch (error) {
    console.error('Error checking JWT expiration:', error);
    return true; // Assume expired on error
  }
}

/**
 * Validate Momento token information
 * Performs comprehensive validation of extracted token info
 */
export function validateMomentoTokenInfo(tokenInfo: MomentoTokenInfo | null): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!tokenInfo) {
    errors.push('No Momento token information provided');
    return { isValid: false, errors };
  }

  if (!tokenInfo.token) {
    errors.push('Momento token is missing');
  }

  if (!tokenInfo.cacheName) {
    errors.push('Cache name is missing');
  }

  if (tokenInfo.isExpired) {
    errors.push('Momento token has expired');
  }

  if (!tokenInfo.isValid) {
    errors.push('Momento token format is invalid');
  }

  // Additional validation for token format
  if (tokenInfo.token && tokenInfo.token.split('.').length !== 3) {
    errors.push('Momento token does not have valid JWT format');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Get time until Momento token expires
 * Returns null if no expiration time or if already expired
 */
export function getTimeUntilMomentoTokenExpires(tokenInfo: MomentoTokenInfo): number | null {
  if (!tokenInfo.expiresAt) {
    return null;
  }

  try {
    const expirationTime = new Date(tokenInfo.expiresAt).getTime();
    const currentTime = Date.now();
    const timeUntilExpiry = expirationTime - currentTime;

    return timeUntilExpiry > 0 ? timeUntilExpiry : null;
  } catch (error) {
    console.error('Error calculating time until token expiry:', error);
    return null;
  }
}

/**
 * Format time remaining until token expires
 * Returns human-readable string like "2 hours 30 minutes"
 */
export function formatTimeUntilExpiry(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''}`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours} hour${hours > 1 ? 's' : ''}${remainingMinutes > 0 ? ` ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}` : ''}`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else {
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  }
}
