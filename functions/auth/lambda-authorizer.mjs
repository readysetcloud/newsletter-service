import { CognitoJwtVerifier } from "aws-jwt-verify";
import { CognitoIdentityProviderClient, GetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { validateApiKey } from './validate-api-key.mjs';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID,
  tokenUse: "access",
  clientId: process.env.USER_POOL_CLIENT_ID,
});

const cognito = new CognitoIdentityProviderClient();

export const handler = async (event) => {

  try {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;

    if (!authHeader) {
      throw new Error('No Authorization header provided');
    }

    // Check if it's a Bearer token (JWT)
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      return await handleJwtAuth(token, event);
    }

    // Otherwise, treat it as an API key
    return await handleApiKeyAuth(authHeader, event);

  } catch (error) {
    console.error('Authorization failed:', error);

    // Return deny policy for any authorization failure
    const apiArn = getApiArnPattern(event.methodArn);
    return generatePolicy('user', 'Deny', apiArn);
  }
};

const handleApiKeyAuth = async (apiKey, event) => {
  const userContext = await validateApiKey(apiKey);

  if (!userContext) {
    throw new Error('Invalid API key');
  }

  const apiArn = getApiArnPattern(event.methodArn);
  return generatePolicy(userContext.tenantId, 'Allow', apiArn, {
    userId: userContext.createdBy,
    tenantId: userContext.tenantId,
    keyId: userContext.keyId,
    authType: 'api_key'
  });
};

const handleJwtAuth = async (token, event) => {
  const verifiedToken = await verifier.verify(token);
  const userInfo = await getUserAttributes(token);
  const tenantId = userInfo?.['custom:tenant_id'] || null;

  // Extract user tier from Cognito groups
  const cognitoGroups = verifiedToken['cognito:groups'] || [];
  let userTier = 'free-tier'; // Default to free tier

  if (cognitoGroups.includes('pro-tier')) {
    userTier = 'pro-tier';
  } else if (cognitoGroups.includes('creator-tier')) {
    userTier = 'creator-tier';
  } else if (cognitoGroups.includes('free-tier')) {
    userTier = 'free-tier';
  }

  const apiArn = getApiArnPattern(event.methodArn);
  const policy = generatePolicy(userInfo.sub ?? verifiedToken.sub, 'Allow', apiArn, {
    userId: userInfo.sub ?? verifiedToken.sub,
    email: userInfo.email,
    firstName: userInfo.given_name,
    lastName: userInfo.family_name,
    ...userInfo.zoneinfo && { timezone: userInfo.zoneinfo },
    tenantId,
    userTier,
    authType: 'jwt',
  });

  return policy;
};

const getUserAttributes = async (accessToken) => {
  try {
    const command = new GetUserCommand({ AccessToken: accessToken });
    const response = await cognito.send(command);

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

const generatePolicy = (principalId, effect, resource, context = {}) => {
  const policy = {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource
        }
      ]
    }
  };

  if (effect === 'Allow' && Object.keys(context).length > 0) {
    policy.context = {};

    Object.keys(context).forEach(key => {
      const value = context[key];
      if (value !== null && value !== undefined) {
        policy.context[key] = String(value);
      }
    });
  }

  return policy;
};

const getApiArnPattern = (methodArn) => {
  const arnParts = methodArn.split('/');
  if (arnParts.length >= 2) {
    return `${arnParts[0]}/${arnParts[1]}/*/*`;
  }

  return methodArn;
};
