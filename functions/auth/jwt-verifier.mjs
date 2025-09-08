import { CognitoJwtVerifier } from "aws-jwt-verify";
import { CognitoIdentityProviderClient, GetUserCommand } from "@aws-sdk/client-cognito-identity-provider";

let verifier;
let cognito;

const getVerifier = () => {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.USER_POOL_ID,
      tokenUse: "access",
      clientId: process.env.USER_POOL_CLIENT_ID,
    });
  }
  return verifier;
};

const getCognito = () => {
  if (!cognito) {
    cognito = new CognitoIdentityProviderClient();
  }
  return cognito;
};

/**
 * Verify JWT token and return user attributes
 * @param {string} token - JWT access token
 * @returns {Promise<Object>} User attributes including custom:tenantId
 */
export const verifyJWT = async (token) => {
  try {
    // Verify the token
    const verifiedToken = await getVerifier().verify(token);

    // Get user attributes
    const userInfo = await getUserAttributes(token);

    return {
      sub: userInfo.sub ?? verifiedToken.sub,
      email: userInfo.email,
      given_name: userInfo.given_name,
      family_name: userInfo.family_name,
      'custom:tenantId': userInfo['custom:tenant_id'],
      ...userInfo.zoneinfo && { zoneinfo: userInfo.zoneinfo }
    };
  } catch (error) {
    console.error('JWT verification failed:', error);
    throw new Error('Invalid JWT token');
  }
};

/**
 * Get user attributes from Cognito
 * @param {string} accessToken - JWT access token
 * @returns {Promise<Object>} User attributes
 */
const getUserAttributes = async (accessToken) => {
  try {
    const command = new GetUserCommand({ AccessToken: accessToken });
    const response = await getCognito().send(command);

    const attrs = {};
    for (const attr of response.UserAttributes) {
      attrs[attr.Name] = attr.Value;
    }
    return attrs;
  } catch (err) {
    console.error("Error fetching user attributes:", err);
    return {};
  }
};
