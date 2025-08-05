import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';

const poolData = {
  UserPoolId: process.env.REACT_APP_USER_POOL_ID,
  ClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID
};

const userPool = new CognitoUserPool(poolData);

export class AuthService {
  static getCurrentUser() {
    return userPool.getCurrentUser();
  }

  static async signIn(email, password) {
    return new Promise((resolve, reject) => {
      const authenticationDetails = new AuthenticationDetails({
        Username: email,
        Password: password
      });

      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool
      });

      cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: (result) => {
          const accessToken = result.getAccessToken().getJwtToken();
          const idToken = result.getIdToken().getJwtToken();
          const refreshToken = result.getRefreshToken().getToken();

          // Extract tenant info from ID token
          const payload = JSON.parse(atob(idToken.split('.')[1]));
          const tenantId = payload['custom:tenant_id'];
          const role = payload['custom:role'];

          resolve({
            accessToken,
            idToken,
            refreshToken,
            user: {
              email: payload.email,
              tenantId,
              role,
              isAdmin: role === 'admin',
              isTenantAdmin: role === 'tenant_admin'
            }
          });
        },
        onFailure: (err) => {
          reject(err);
        },
        newPasswordRequired: (userAttributes, requiredAttributes) => {
          // Handle first-time login password change
          resolve({
            needsNewPassword: true,
            cognitoUser,
            userAttributes,
            requiredAttributes
          });
        }
      });
    });
  }

  static async completeNewPasswordChallenge(cognitoUser, newPassword, userAttributes = {}) {
    return new Promise((resolve, reject) => {
      cognitoUser.completeNewPasswordChallenge(newPassword, userAttributes, {
        onSuccess: (result) => {
          const accessToken = result.getAccessToken().getJwtToken();
          const idToken = result.getIdToken().getJwtToken();
          const payload = JSON.parse(atob(idToken.split('.')[1]));

          resolve({
            accessToken,
            idToken,
            user: {
              email: payload.email,
              tenantId: payload['custom:tenant_id'],
              role: payload['custom:role']
            }
          });
        },
        onFailure: (err) => {
          reject(err);
        }
      });
    });
  }

  static signOut() {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
    }
    localStorage.removeItem('authTokens');
  }

  static async getSession() {
    return new Promise((resolve, reject) => {
      const cognitoUser = userPool.entUser();

      if (!cognitoUser) {
        reject(new Error('No current user'));
        return;
      }

      cognitoUser.getSession((err, session) => {
        if (err) {
          reject(err);
          return;
        }

        if (!session.isValid()) {
          reject(new Error('Session is not valid'));
          return;
        }

        const idToken = session.getIdToken().getJwtToken();
        const payload = JSON.parse(atob(idToken.split('.')[1]));

        resolve({
          session,
          user: {
            email: payload.email,
            tenantId: payload['custom:tenant_id'],
            role: payload['custom:role'],
            isAdmin: payload['custom:role'] === 'admin',
            isTenantAdmin: payload['custom:role'] === 'tenant_admin'
          }
        });
      });
    });
  }

  static getAuthHeaders() {
    const cognitoUser = userPool.getCurrentUser();

    if (!cognitoUser) {
      return {};
    }

    return new Promise((resolve, reject) => {
      cognitoUser.getSession((err, session) => {
        if (err || !session.isValid()) {
          reject(err || new Error('Invalid session'));
          return;
        }

        resolve({
          'Authorization': `Bearer ${session.getIdToken().getJwtToken()}`
        });
      });
    });
  }
}
