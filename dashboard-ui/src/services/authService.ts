import { fetchAuthSession } from 'aws-amplify/auth';

export interface MomentoTokenResponse {
  momentoToken: string;
  cacheName: string;
  expiresAt: string;
  tenantId: string;
}

export class AuthService {
  private static instance: AuthService;

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Refresh Momento token using the backend endpoint
   */
  async refreshMomentoToken(): Promise<MomentoTokenResponse> {
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();

      if (!idToken) {
        throw new Error('No authentication token available');
      }

      const response = await fetch('/api/auth/refresh-momento-token', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to refresh token: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to refresh Momento token:', error);
      throw error;
    }
  }
}

export const authService = AuthService.getInstance();
