/**
 * @fileoverview Lambda function to create Stripe customer portal seions for tenant billing management
 */

import Stripe from 'stripe';
import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({});

// Initialize Stripe client
let stripe;
async function getStripeClient() {
  if (!stripe) {
    const apiKey = await getParameter(process.env.STRIPE_API_KEY_PARAM, { decrypt: true });
    stripe = new Stripe(apiKey);
  }
  return stripe;
}

/**
 * Validates customer portal request
 */
function validatePortalRequest(body) {
  const errors = [];

  if (!body.returnUrl) {
    errors.push('returnUrl is required');
  } else if (!isValidUrl(body.returnUrl)) {
    errors.push('returnUrl must be a valid URL');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validates URL format
 */
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Gets tenant information including Stripe customer ID
 */
async function getTenantInfo(tenantId) {
  const params = {
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: 'tenant'
    })
  };

  try {
    const result = await dynamoClient.send(new GetItemCommand(params));
    return result.Item ? unmarshall(result.Item) : null;
  } catch (error) {
    throw new Error(`Failed to retrieve tenant information: ${error.message}`);
  }
}

/**
 * Creates Stripe customer portal session
 */
async function createCustomerPortalSession(stripeCustomerId, returnUrl) {
  const stripeClient = await getStripeClient();

  try {
    const session = await stripeClient.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    return session;
  } catch (error) {
    throw new Error(`Failed to create Stripe customer portal session: ${error.message}`);
  }
}

/**
 * Main Lambda handler
 */
export const handler = async (event) => {
  console.log('Create customer portal session request:', JSON.stringify(event, null, 2));

  try {
    // Parse request body
    const body = JSON.parse(event.body || '{}');

    // Get tenant ID from JWT claims (set by authorizer)
    const tenantId = event.requestContext?.authorizer?.claims?.['custom:tenantId'];
    if (!tenantId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Unauthorized: No tenant ID found' })
      };
    }

    // Check if user is tenant admin
    const userGroups = event.requestContext?.authorizer?.claims?.['cognito:groups'];
    const isAdmin = userGroups && userGroups.includes('tenant-admin');

    if (!isAdmin) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Forbidden: Admin access required' })
      };
    }

    // Validate request
    const validation = validatePortalRequest(body);
    if (!validation.isValid) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Invalid request',
          details: validation.errors
        })
      };
    }

    // Get tenant information
    const tenant = await getTenantInfo(tenantId);
    if (!tenant) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Tenant not found' })
      };
    }

    // Check if tenant has Stripe customer ID
    if (!tenant.stripeCustomerId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'No billing account found. Please contact support to set up billing.'
        })
      };
    }

    // Create customer portal session
    const session = await createCustomerPortalSession(
      tenant.stripeCustomerId,
      body.returnUrl
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        sessionId: session.id,
        url: session.url
      })
    };

  } catch (error) {
    console.error('Error creating customer portal session:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
      })
    };
  }
};
