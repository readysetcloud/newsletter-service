/**
 * Structured Logging Utility
 *
 * Provides consistent structured logging across all Lambda functions
 * with correlation IDs, tenant context, and performance metrics.
 */

/**
 * Base log entry structure with common fields
 * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG)
 * @param {string} message - Log message
 * @param {string} correlationId - Correlation ID for tracing
 * @param {Object} context - Additional context data
 * @returns {Object} Structured log entry
 */
const createLogEntry = (level, message, correlationId, context = {}) => {
    return {
        timestamp: new Date().toISOString(),
        level,
        message,
        correlationId,
        service: 'newsletter-notification-system',
        version: process.env.AWS_LAMBDA_FUNCTIRSION || 'unknown',
        functionName: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
        requestId: process.env.AWS_REQUEST_ID || 'unknown',
        ...context
    };
};

/**
 * Enhanced logger class with structured logging capabilities
 */
export class StructuredLogger {
    constructor(correlationId, tenantId = null, userId = null) {
        this.correlationId = correlationId;
        this.tenantId = tenantId;
        this.userId = userId;
        this.startTime = Date.now();
    }

    /**
     * Create base context with tenant and user information
     * @param {Object} additionalContext - Additional context to merge
     * @returns {Object} Base context object
     */
    getBaseContext(additionalContext = {}) {
        const baseContext = {
            tenantId: this.tenantId,
            userId: this.userId,
            ...additionalContext
        };

        // Remove null/undefined values to keep logs clean
        return Object.fromEntries(
            Object.entries(baseContext).filter(([_, value]) => value != null)
        );
    }

    /**
     * Log info message
     * @param {string} message - Log message
     * @param {Object} context - Additional context
     */
    info(message, context = {}) {
        const logEntry = createLogEntry(
            'INFO',
            message,
            this.correlationId,
            this.getBaseContext(context)
        );
        console.log(JSON.stringify(logEntry));
    }

    /**
     * Log warning message
     * @param {string} message - Log message
     * @param {Object} context - Additional context
     */
    warn(message, context = {}) {
        const logEntry = createLogEntry(
            'WARN',
            message,
            this.correlationId,
            this.getBaseContext(context)
        );
        console.warn(JSON.stringify(logEntry));
    }

    /**
     * Log error message
     * @param {string} message - Log message
     * @param {Error|Object} error - Error object or additional context
     * @param {Object} context - Additional context
     */
    error(message, error = {}, context = {}) {
        const errorContext = {
            ...context
        };

        // Handle Error objects
        if (error instanceof Error) {
            errorContext.error = {
                name: error.name,
                message: error.message,
                stack: error.stack
            };
        } else if (typeof error === 'object') {
            errorContext.error = error;
        }

        const logEntry = createLogEntry(
            'ERROR',
            message,
            this.correlationId,
            this.getBaseContext(errorContext)
        );
        console.error(JSON.stringify(logEntry));
    }

    /**
     * Log debug message (only in development)
     * @param {string} message - Log message
     * @param {Object} context - Additional context
     */
    debug(message, context = {}) {
        if (process.env.LOG_LEVEL === 'DEBUG') {
            const logEntry = createLogEntry(
                'DEBUG',
                message,
                this.correlationId,
                this.getBaseContext(context)
            );
            console.debug(JSON.stringify(logEntry));
        }
    }

    /**
     * Log performance metrics
     * @param {string} operation - Operation name
     * @param {number} durationMs - Duration in milliseconds
     * @param {Object} context - Additional context
     */
    metric(operation, durationMs, context = {}) {
        const logEntry = createLogEntry(
            'METRIC',
            `Performance metric: ${operation}`,
            this.correlationId,
            this.getBaseContext({
                operation,
                durationMs,
                ...context
            })
        );
        console.log(JSON.stringify(logEntry));
    }

    /**
     * Log function start with context
     * @param {string} functionName - Name of the function starting
     * @param {Object} context - Additional context
     */
    functionStart(functionName, context = {}) {
        this.info(`Function started: ${functionName}`, {
            functionName,
            ...context
        });
    }

    /**
     * Log function completion with duration
     * @param {string} functionName - Name of the function completing
     * @param {Object} context - Additional context
     */
    functionEnd(functionName, context = {}) {
        const duration = Date.now() - this.startTime;
        this.info(`Function completed: ${functionName}`, {
            functionName,
            totalDurationMs: duration,
            ...context
        });
        this.metric(functionName, duration, context);
    }

    /**
     * Log generic operation attempt
     * @param {string} operation - Operation status (start/success/failure)
     * @param {Object} context - Additional context
     */
    operationAttempt(operation, context = {}) {
        const message = `Operation ${operation}`;

        if (operation === 'failure') {
            this.error(message, context.error, context);
        } else {
            this.info(message, context);
        }
    }

    /**
     * Log EventBridge event processing
     * @param {string} eventType - Type of event being processed
     * @param {string} status - Processing status (start/success/failure)
     * @param {Object} context - Additional context
     */
    eventProcessing(eventType, status, context = {}) {
        const message = `EventBridge event processing ${status}: ${eventType}`;

        if (status === 'failure') {
            this.error(message, context.error, { eventType, ...context });
        } else {
            this.info(message, { eventType, ...context });
        }
    }

    /**
     * Log notification publishing
     * @param {string} channel - Notification channel
     * @param {string} status - Publishing status (start/success/failure)
     * @param {Object} context - Additional context
     */
    notificationPublishing(channel, status, context = {}) {
        const message = `Notification publishing ${status}: ${channel}`;

        if (status === 'failure') {
            this.error(message, context.error, { channel, ...context });
        } else {
            this.info(message, { channel, ...context });
        }
    }

    /**
     * Log user authentication context extraction
     * @param {Object} userContext - Extracted user context
     * @param {Object} context - Additional context
     */
    userContextExtraction(userContext, context = {}) {
        this.info('User context extracted', {
            hasUserId: !!userContext.userId,
            hasEmail: !!userContext.email,
            hasTenantId: !!userContext.tenantId,
            extractedTenantId: userContext.tenantId,
            ...context
        });
    }

    /**
     * Create a child logger with additional context
     * @param {Object} additionalContext - Additional context to include
     * @returns {StructuredLogger} New logger instance with additional context
     */
    child(additionalContext = {}) {
        const childLogger = new StructuredLogger(
            this.correlationId,
            additionalContext.tenantId || this.tenantId,
            additionalContext.userId || this.userId
        );
        childLogger.startTime = this.startTime;
        return childLogger;
    }
}

/**
 * Create a new structured logger instance
 * @param {string} correlationId - Correlation ID for tracing
 * @param {string} tenantId - Tenant ID (optional)
 * @param {string} userId - User ID (optional)
 * @returns {StructuredLogger} New logger instance
 */
export const createLogger = (correlationId, tenantId = null, userId = null) => {
    return new StructuredLogger(correlationId, tenantId, userId);
};

/**
 * Legacy console.log wrapper for backward compatibility
 * @deprecated Use StructuredLogger instead
 */
export const legacyLog = (message, context = {}) => {
    console.log(message, context);
};
