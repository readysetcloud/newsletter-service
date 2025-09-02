/**
 * @fileoverview Lambda function to retrieve current subscription status for a tenant
 */

import { getSubscriptionRecord } from './subscription-data.mjs';
import { SUBSCRIPTION_PLANS, getPlanById } from './types.mjs';

/**
 * Formats subscription data for API response
 */
function formatSubscriptionResponse(subscriptionRecord) {
  if (!subscriptionRecord) {
    return {
      status: 'free',
      plan: SUBSCRIPTION_PLANS.free,
      isActive: false,
      billingInfo: null
    };
  }

  const plan = getPlanById(subscriptionRecord.planId);
  const isActive = subscriptionRecord.status === 'active' || subscriptionRecord.status === 'trialing';

  return {
    status: subscriptionRecord.status,
    plan: {
      id: subscriptionRecord.planId,
      name: plan?.name || 'Unknown',
      limits: plan?.limits || {}
    },
    isActive,
    billingInfo: {
      currentPeriodStart: subscriptionRecord.currentPeriodStart,
      currentPeriodEnd: subscriptionRecord.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptionRecord.cancelAtPeriodEnd,
      stripeSubscriptionId: subscriptionRecord.stripeSubscriptionId
    },
    updatedAt: subscriptionRecord.updatedAt
  };
}

/**
 * Main Lambda handler
 */
export const handler = async (event) => {
  console.log('Get subscription status request:', JSON.stringify(event, null, 2));

  try {
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

    // Retrieve subscription record
    const subscriptionRecord = await getSubscriptionRecord(tenantId);

    // Format response
    const response = formatSubscriptionResponse(subscriptionRecord);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Error retrieving subscription status:', error);

    // Handle specific error cases
    if (error.message.includes('Tenant ID is required')) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Invalid request: Tenant ID is required' })
      };
    }

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
