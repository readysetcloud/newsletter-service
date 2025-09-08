/**
 * Performance monitoring utility for template operations
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
  }

  /**
   * Start timing an operation
   * @param {string} operationName - Name of the operation
   * @param {Object} context - Additional context for the operation
   * @returns {string} Timer ID
   */
  startTimer(operationName, context = {}) {
    const timerId = `${operationName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.metrics.set(timerId, {
      operationName,
      context,
      startTime: Date.now(),
      startHrTime: process.hrtime.bigint()
    });

    return timerId;
  }

  /**
   * End timing an operation and log the result
   * @param {string} timerId - Timer ID from startTimer
   * @param {Object} additionalContext - Additional context to log
   */
  endTimer(timerId, additionalContext = {}) {
    const metric = this.metrics.get(timerId);
    if (!metric) {
      console.warn(`Timer ${timerId} not found`);
      return;
    }

    const endTime = Date.now();
    const endHrTime = process.hrtime.bigint();
    const duration = endTime - metric.startTime;
    const precisionDuration = Number(endHrTime - metric.startHrTime) / 1000000; // Convert to milliseconds

    const logData = {
      operation: metric.operationName,
      duration_ms: duration,
      precision_duration_ms: precisionDuration,
      context: { ...metric.context, ...additionalContext },
      timestamp: new Date().toISOString()
    };

    // Log performance data
    console.log('PERFORMANCE_METRIC:', JSON.stringify(logData));

    // Clean up
    this.metrics.delete(timerId);

    return {
      duration,
      precisionDuration,
      operationName: metric.operationName
    };
  }

  /**
   * Log cache hit/miss statistics
   * @param {string} operation - Operation name (e.g., 'template_content', 'snippet_metadata')
   * @param {boolean} hit - Whether it was a cache hit
   * @param {Object} context - Additional context
   */
  logCacheMetric(operation, hit, context = {}) {
    const logData = {
      metric_type: 'cache_performance',
      operation,
      cache_hit: hit,
      context,
      timestamp: new Date().toISOString()
    };

    console.log('CACHE_METRIC:', JSON.stringify(logData));
  }

  /**
   * Log DynamoDB query performance
   * @param {string} tableName - Table name
   * @param {string} operation - Operation type (Query, GetItem, etc.)
   * @param {number} itemCount - Number of items returned
   * @param {number} consumedCapacity - Consumed capacity units
   * @param {number} duration - Query duration in milliseconds
   * @param {Object} context - Additional context
   */
  logDynamoDBMetric(tableName, operation, itemCount, consumedCapacity, duration, context = {}) {
    const logData = {
      metric_type: 'dynamodb_performance',
      table_name: tableName,
      operation,
      item_count: itemCount,
      consumed_capacity: consumedCapacity,
      duration_ms: duration,
      context,
      timestamp: new Date().toISOString()
    };

    console.log('DYNAMODB_METRIC:', JSON.stringify(logData));
  }

  /**
   * Log S3 operation performance
   * @param {string} bucket - Bucket name
   * @param {string} operation - Operation type (GetObject, PutObject, etc.)
   * @param {string} key - Object key
   * @param {number} size - Object size in bytes
   * @param {number} duration - Operation duration in milliseconds
   * @param {boolean} fromCache - Whether the operation used cache
   * @param {Object} context - Additional context
   */
  logS3Metric(bucket, operation, key, size, duration, fromCache = false, context = {}) {
    const logData = {
      metric_type: 's3_performance',
      bucket,
      operation,
      key,
      size_bytes: size,
      duration_ms: duration,
      from_cache: fromCache,
      context,
      timestamp: new Date().toISOString()
    };

    console.log('S3_METRIC:', JSON.stringify(logData));
  }

  /**
   * Log template rendering performance
   * @param {string} templateId - Template ID
   * @param {number} templateSize - Template size in characters
   * @param {number} snippetCount - Number of snippets used
   * @param {number} duration - Rendering duration in milliseconds
   * @param {Object} context - Additional context
   */
  logRenderingMetric(templateId, templateSize, snippetCount, duration, context = {}) {
    const logData = {
      metric_type: 'template_rendering',
      template_id: templateId,
      template_size_chars: templateSize,
      snippet_count: snippetCount,
      duration_ms: duration,
      context,
      timestamp: new Date().toISOString()
    };

    console.log('RENDERING_METRIC:', JSON.stringify(logData));
  }

  /**
   * Create a performance summary for a complex operation
   * @param {string} operationName - Name of the overall operation
   * @param {Array} subOperations - Array of sub-operation results
   * @param {Object} context - Additional context
   */
  logOperationSummary(operationName, subOperations, context = {}) {
    const totalDuration = subOperations.reduce((sum, op) => sum + (op.duration || 0), 0);
    const cacheHits = subOperations.filter(op => op.cacheHit).length;
    const cacheMisses = subOperations.filter(op => op.cacheHit === false).length;

    const logData = {
      metric_type: 'operation_summary',
      operation: operationName,
      total_duration_ms: totalDuration,
      sub_operation_count: subOperations.length,
      cache_hits: cacheHits,
      cache_misses: cacheMisses,
      cache_hit_rate: cacheHits / (cacheHits + cacheMisses) || 0,
      sub_operations: subOperations,
      context,
      timestamp: new Date().toISOString()
    };

    console.log('OPERATION_SUMMARY:', JSON.stringify(logData));
  }

  /**
   * Log memory usage statistics
   * @param {string} operation - Operation name
   * @param {Object} context - Additional context
   */
  logMemoryUsage(operation, context = {}) {
    const memUsage = process.memoryUsage();

    const logData = {
      metric_type: 'memory_usage',
      operation,
      memory: {
        rss_mb: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100,
        heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100,
        heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
        external_mb: Math.round(memUsage.external / 1024 / 1024 * 100) / 100
      },
      context,
      timestamp: new Date().toISOString()
    };

    console.log('MEMORY_METRIC:', JSON.stringify(logData));
  }

  /**
   * Create a performance-aware wrapper for async functions
   * @param {string} operationName - Name of the operation
   * @param {Function} asyncFn - Async function to wrap
   * @param {Object} context - Additional context
   * @returns {Function} Wrapped function
   */
  wrapAsync(operationName, asyncFn, context = {}) {
    return async (...args) => {
      const timerId = this.startTimer(operationName, context);

      try {
        const result = await asyncFn(...args);
        this.endTimer(timerId, { success: true });
        return result;
      } catch (error) {
        this.endTimer(timerId, { success: false, error: error.message });
        throw error;
      }
    };
  }

  /**
   * Get current metrics snapshot
   * @returns {Object} Current metrics
   */
  getMetricsSnapshot() {
    return {
      active_timers: this.metrics.size,
      memory_usage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Export class for testing
export { PerformanceMonitor };
