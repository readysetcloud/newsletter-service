import { jest } from '@jest/globals';

// Mock AWS SDK
const mockSend = jest.fn().mockResolvedValue({});

jest.unstable_mockModule('@aws-sdk/client-cloudwatch', () => ({
    CloudWatchClient: jest.fn(() => ({ send: mockSend })),
    PutMetricDataCommand: jest.fn((params) => params)
}));

// Import after mocking
const {
    publishMetricEvent,
    publishMetricEvents,
    timeOperation,
    createMetricsContext,
    getAvailableEventTypes,
    isValidEventType,
    getMetricConfig
} = await import('../cloudwatch-metrics.mjs');

describe('CloudWatch Metrics Utility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSend.mockResolvedValue({});
        // Clear console logs
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    describe('publishMetricEvent', () => {
        it('should publish a valid metric event', async () => {
            await publishMetricEvent('momento.token.generated', {
                dimensions: { TenantId: 'test-tenant' }
            }, 'test-correlation-id');

            expect(console.log).toHaveBeenCalledWith(
                'Published CloudWatch metric event',
                expect.objectContaining({
                    correlationId: 'test-correlation-id',
                    eventType: 'momento.token.generated',
                    namespace: 'Newsletter/Momento',
                    metricName: 'TokenGenerationSuccess'
                })
            );
        });

        it('should warn for unknown event types', async () => {
            await publishMetricEvent('unknown.event.type', {}, 'test-correlation-id');

            expect(console.warn).toHaveBeenCalledWith(
                'Unknown metric event type',
                expect.objectContaining({
                    eventType: 'unknown.event.type',
                    correlationId: 'test-correlation-id'
                })
            );
        });

        it('should handle custom values and units', async () => {
            await publishMetricEvent('momento.token.duration', {
                value: 150,
                dimensions: { TenantId: 'test-tenant' }
            }, 'test-correlation-id');

            expect(console.log).toHaveBeenCalledWith(
                'Published CloudWatch metric event',
                expect.objectContaining({
                    value: 150,
                    unit: 'Milliseconds'
                })
            );
        });
    });

    describe('publishMetricEvents', () => {
        it('should publish multiple events in batch', async () => {
            const events = [
                { eventType: 'momento.token.generated', eventData: { dimensions: { TenantId: 'tenant-1' } } },
                { eventType: 'notification.published', eventData: { dimensions: { TenantId: 'tenant-1' } } }
            ];

            await publishMetricEvents(events, 'test-correlation-id');

            expect(console.log).toHaveBeenCalledWith(
                'Published CloudWatch metric events batch',
                expect.objectContaining({
                    correlationId: 'test-correlation-id',
                    eventCount: 2
                })
            );
        });
    });

    describe('timeOperation', () => {
        it('should time an operation and publish metrics', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await timeOperation('momento.token', mockOperation, {
                TenantId: 'test-tenant'
            }, 'test-correlation-id');

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalled();

            // Should publish both duration and success metrics
            expect(console.log).toHaveBeenCalledTimes(2);
        });

        it('should handle operation failures', async () => {
            const mockOperation = jest.fn().mockRejectedValue(new Error('Test error'));

            await expect(timeOperation('momento.token', mockOperation, {
                TenantId: 'test-tenant'
            }, 'test-correlation-id')).rejects.toThrow('Test error');

            // Should still publish duration and failure metrics
            expect(console.log).toHaveBeenCalledTimes(2);
        });
    });

    describe('createMetricsContext', () => {
        it('should accumulate and publish events', async () => {
            const metrics = createMetricsContext('test-correlation-id');

            metrics.addEvent('user.created', { dimensions: { TenantId: 'test-tenant' } });
            metrics.addEvent('brand.updated', { dimensions: { TenantId: 'test-tenant' } });

            expect(metrics.getEventCount()).toBe(2);

            await metrics.publishAll();

            expect(console.log).toHaveBeenCalledWith(
                'Published CloudWatch metric events batch',
                expect.objectContaining({
                    eventCount: 2
                })
            );

            expect(metrics.getEventCount()).toBe(0); // Should clear after publishing
        });

        it('should time operations within context', async () => {
            const metrics = createMetricsContext('test-correlation-id');
            const mockOperation = jest.fn().mockResolvedValue('success');

            const result = await metrics.timeOperation('api', mockOperation, {
                Endpoint: '/test'
            });

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalled();
            // The metrics context timeOperation uses the global timeOperation which should publish metrics
            expect(mockSend).toHaveBeenCalled();
        });
    });

    describe('utility functions', () => {
        it('should return available event types', () => {
            const eventTypes = getAvailableEventTypes();
            expect(eventTypes).toContain('momento.token.generated');
            expect(eventTypes).toContain('notification.published');
            expect(eventTypes).toContain('event.processed');
        });

        it('should validate event types', () => {
            expect(isValidEventType('momento.token.generated')).toBe(true);
            expect(isValidEventType('invalid.event.type')).toBe(false);
        });

        it('should return metric configuration', () => {
            const config = getMetricConfig('momento.token.generated');
            expect(config).toEqual({
                namespace: 'Newsletter/Momento',
                metricName: 'TokenGenerationSuccess',
                unit: 'Count',
                value: 1
            });

            expect(getMetricConfig('invalid.event.type')).toBeNull();
        });
    });

    describe('error handling', () => {
        it('should not throw errors when CloudWatch fails', async () => {
            // Mock CloudWatch to throw an error
            mockSend.mockRejectedValueOnce(new Error('CloudWatch error'));

            // Should not throw
            await expect(publishMetricEvent('momento.token.generated', {
                dimensions: { TenantId: 'test-tenant' }
            }, 'test-correlation-id')).resolves.toBeUndefined();

            expect(console.error).toHaveBeenCalledWith(
                'Failed to publish CloudWatch metric event',
                expect.objectContaining({
                    eventType: 'momento.token.generated',
                    error: 'CloudWatch error'
                })
            );
        });
    });
});
