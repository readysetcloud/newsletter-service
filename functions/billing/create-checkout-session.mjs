/**
 * @fileoverview Lambda function to create Stripe checkout sessions for tenant subscriptions
 */

import Stripe from 'stripe';
import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { SUBSCRIPTION_PLANS, isValidPlanId } from './types.mjs';

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
 * Validates checkout session request
 */
function validateCheckoutRequest(body) {
  const errors = [];

  if (!body.planId) {
    errors.push('planId is required');
  } else if (!isValidPlanId(body.planId)) {
    errors.push(`Invalid planId: ${body.planId}`);
  } else if (body.planId === 'free') {
    errors.push('Cannot create checkout session for free plan');
  }

  if (!body.successUrl) {
    errors.push('successUrl is required');
  } else if (!isValidUrl(body.successUrl)) {
    errors.push('successUrl must be a valid URL');
  }

  if (!body.cancelUrl) {
    errors.push('cancelUrl is required');
  } else if (!isValidUrl(body.cancelUrl)) {
    errors.push('cancelUrl must be a valid URL');
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
 * Checks if tenant already has an active subscription
 */
async function getExistingSubscription(tenantId) {
  const params = {
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: 'subscription'
    })
  };

  try {
    const result = await dynamoClient.send(new GetItemCommand(params));
    return result.Item ? unmarshall(result.Item) : null;
  } catch (error) {
    throw new Error(`Failed to check existing subscription: ${error.message}`);
  }
}

/**
 * Creates Stripe checkout session
 */
async function createCheckoutSession(tenantId, planId, successUrl, cancelUrl, stripeCustomerId) {
  const stripeClient = await getStripeClient();
  const plan = SUBSCRIPTION_PLANS[planId];

  if (!plan.priceId) {
    throw new Error(`Plan ${planId} does not have a Stripe price ID`);
  }

  try {
    const session = await stripeClient.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: plan.priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        tenantId: tenantId,
        planId: planId
      },
      subscription_data: {
        metadata: {
          tenantId: tenantId,
          planId: planId
        }
      },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      customer_update: {
        address: 'auto',
        name: 'auto'
      }
    });

    return session;
  } catch (error) {
    throw new Error(`Failed to create Stripe checkout session: ${error.message}`);
  }
}

/**
 * Main Lambda handler
 */
export const handler = async (event) => {
  console.log('Create checkout session request:', JSON.stringify(event, null, 2));

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

    // Validate request
    const validation = validateCheckoutRequest(body);
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
          error: 'Tenant does not have Stripe customer setup. Please contact support.'
        })
      };
    }

    // Check for existing active subscription
    const existingSubscription = await getExistingSubscription(tenantId);
    if (existingSubscription && existingSubscription.status === 'active') {
      return {
        statusCode: 409,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Tenant already has an active subscription',
          currentPlan: existingSubscription.planId
        })
      };
    }

    // Create checkout session
    const session = await createCheckoutSession(
      tenantId,
      body.planId,
      body.successUrl,
      body.cancelUrl,
      tenant.stripeCustomerId
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
    console.error('Error creating checkout session:', error);

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
