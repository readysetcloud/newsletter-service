/**
 * Cognito Pre Token Generation Lambda Trigger
 *
 * This Lambda function is triggered by AWS Cognito during the token generation process.
 * It enriches JWT tokens with Momento authentication tokens for real-time notifications.
 *
 */

import { randomUUID } from 'crypto';
import { momentoClient } from '../utils/momento-client.mjs';
import { createMetricsContext } from '../utils/cloudwatch-metrics.mjs';
import { createLogger } from '../utils/structured-logger.mjs';

/**
 * Extract user context from Cognito Pre Token Generation event
 * @param {Object} event - Cognito event
 * @param {Object} logger - Structured logger instance
 * @returns {Object} User context with userId, email, and tenantId
 */
const extractUserContext = (event, logger) => {
    const userAttributes = event.request?.userAttributes || {};

    const userContext = {
        userId: userAttributes.sub || null,
        email: userAttributes.email || null,
        tenantId: userAttributes['custom:tenant_id'] || null
    };

    logger.userContextExtraction(userContext, {
        userName: event.userName,
        availableAttributes: Object.keys(userAttributes)
    });

    if (!userContext.userId) {
        logger.warn('Missing user ID in Cognito event', {
            userName: event.userName,
            availableAttributes: Object.keys(userAttributes)
        });
    }

    if (!userContext.email) {
        logger.warn('Missing email in Cognito event', {
            userName: event.userName,
            availableAttributes: Object.keys(userAttributes)
        });
    }

    if (!userContext.tenantId) {
        logger.warn('Missing tenant ID in Cognito event - user will have no channel access', {
            userName: event.userName,
            availableAttributes: Object.keys(userAttributes)
        });
    }

    return userContext;
};

/**
 * Generate Momento read only token for tenant-scoped access
 * @param {string} tenantId - Tenant ID for scoping permissions
 * @param {string} userId - User ID for logging and tracking
 * @param {Object} logger - Structured logger instance
 * @returns {Promise<string|null>} Generated Momento auth token or null if failed
 */
const generateMomentoReadOnlyToken = async (tenantId, userId, logger) => {
    // If no tenant ID, return null (user will have no channel access)
    if (!tenantId) {
        logger.warn('No tenant ID provided - skipping Momento token generation', {
            userId
        });
        return null;
    }

    if (!momentoClient.isAvailable()) {
        logger.warn('Momento not available - MOMENTO_API_KEY not configured', {
            tenantId,
            userId
        });
        return null;
    }

    const startTime = Date.now();

    try {
        const ttlHours = parseInt(process.env.TTL_HOURS || '24', 10);

        logger.momentoTokenGeneration('start', {
            tenantId,
            userId,
            ttlHours
        });

        const token = await momentoClient.generateReadOnlyToken(tenantId, userId, ttlHours);
        const duration = Date.now() - startTime;

        logger.momentoTokenGeneration('success', {
            tenantId,
            userId,
            ttlHours,
            tokenLength: token?.length || 0,
            durationMs: duration
        });

        // Publish success metrics using event-driven approach
        const metrics = createMetricsContext(logger.correlationId);
        metrics.addEvent('momento.token.generated', {
            dimensions: { TenantId: tenantId }
        });
        metrics.addEvent('momento.token.duration', {
            value: duration,
            dimensions: { TenantId: tenantId }
        });
        await metrics.publishAll();

        return token;
    } catch (error) {
        const duration = Date.now() - startTime;

        // Log error but don't throw - authentication should continue
        logger.momentoTokenGeneration('failure', {
            tenantId,
            userId,
            durationMs: duration,
            error
        });

        // Publish failure metrics using event-driven approach
        const errorType = error.name || 'UNKNOWN_ERROR';
        const metrics = createMetricsContext(logger.correlationId);
        metrics.addEvent('momento.token.failed', {
            dimensions: { TenantId: tenantId, ErrorType: errorType }
        });
        metrics.addEvent('momento.token.duration', {
            value: duration,
            dimensions: { TenantId: tenantId, ErrorType: errorType }
        });
        await metrics.publishAll();

        return null;
    }
};

/**
 * Enrich JWT claims with Momento token and related information
 * @param {Object} event - Cognito Pre Token Generation event
 * @param {string|null} momentoToken - Generated Momento auth token
 * @param {Object} logger - Structured logger instance
 * @returns {Object} Modified event with enriched claims
 */
const enrichClaims = (event, momentoToken, logger) => {
    // Initialize claims override if not present
    if (!event.response) {
        event.response = {};
    }
    if (!event.response.claimsOverrideDetails) {
        event.response.claimsOverrideDetails = {};
    }
    if (!event.response.claimsOverrideDetails.claimsToAddOrOverride) {
        event.response.claimsOverrideDetails.claimsToAddOrOverride = {};
    }

    const claims = event.response.claimsOverrideDetails.claimsToAddOrOverride;

    // Add Momento token to custom claims if available
    if (momentoToken) {
        claims['custom:momento_token'] = momentoToken;
        claims['custom:momento_cache'] = momentoClient.getCacheName();

        // Calculate expiration time based on TTL
        const ttlHours = parseInt(process.env.TTL_HOURS || '24', 10);
        const expirationTime = new Date(Date.now() + (ttlHours * 60 * 60 * 1000));
        claims['custom:momento_expires'] = expirationTime.toISOString();

        logger.info('Added Momento claims to JWT', {
            userName: event.userName,
            cacheName: momentoClient.getCacheName(),
            expiresAt: expirationTime.toISOString(),
            tokenLength: momentoToken.length
        });
    } else {
        // Handle cases where token generation failed
        // Add empty claims to indicate Momento is not available for this user
        claims['custom:momento_token'] = '';
        claims['custom:momento_cache'] = '';
        claims['custom:momento_expires'] = '';

        logger.warn('Added empty Momento claims due to token generation failure', {
            userName: event.userName
        });
    }

    return event;
};

/**
 * Main Lambda handler for Cognito Pre Token Generation trigger
 * @param {Object} event - Cognito Pre Token Generation event
 * @returns {Object} Modified event with enriched claims
 */
export const handler = async (event) => {
    const correlationId = randomUUID();
    const logger = createLogger(correlationId);

    logger.functionStart('Pre Token Generation', {
        triggerSource: event.triggerSource,
        userName: event.userName,
        userPoolId: event.userPoolId
    });

    try {
        // Extract user context from the Cognito event
        const userContext = extractUserContext(event, logger);

        // Create child logger with user context
        const contextLogger = logger.child({
            tenantId: userContext.tenantId,
            userId: userContext.userId
        });

        // Generate Momento read only token for tenant-scoped access
        const momentoToken = await generateMomentoReadOnlyToken(
            userContext.tenantId,
            userContext.userId,
            contextLogger
        );

        // Enrich JWT claims with Momento token and related information
        const enrichedEvent = enrichClaims(event, momentoToken, contextLogger);

        contextLogger.functionEnd('Pre Token Generation', {
            userName: event.userName,
            hasMomentoToken: !!momentoToken,
            success: true
        });

        return enrichedEvent;
    } catch (error) {
        // Critical: Never throw errors that would block authentication
        // Log the error but allow authentication to continue
        logger.error('Pre Token Generation failed - continuing authentication', error, {
            userName: event.userName
        });

        logger.functionEnd('Pre Token Generation', {
            userName: event.userName,
            success: false,
            error: error.message
        });

        // Return the original event to allow authentication to proceed
        return event;
    }
};
