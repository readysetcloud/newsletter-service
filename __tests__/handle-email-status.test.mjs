import { jest, describe, it, expect, beforeEach } from '@jest/globals';

let handler;
let ddbSend;
let PutItemCommand;
let UpdateItemCommand;

const loadIsolated = async () => {
  await jest.isolateModulesAsync(async () => {
    ddbSend = jest.fn();

    jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
      PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
      UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
    }));

    jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
      marshall: (obj) => {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'string') {
            result[key] = { S: value };
          } else if (typeof value === 'number') {
            result[key] = { N: String(value) };
          } else if (Array.isArray(value)) {
            result[key] = { L: value.map(v => ({ S: v })) };
          }
        }
        return result;
      },
    }));

    jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
      hash: jest.fn((str) => `hash_${str}`),
    }));

    jest.unstable_mockModule('../functions/utils/detect-device.mjs', () => ({
      detectDevice: jest.fn((ua) => {
        if (!ua) return 'unknown';
        if (ua.includes('iPhone')) return 'mobile';
        if (ua.includes('iPad')) return 'tablet';
        return 'desktop';
      }),
    }));

    jest.unstable_mockModule('ulid', () => ({
      ulid: jest.fn(() => '01HQZX3Y4K5M6N7P8Q9R0S1T2U'),
    }));

    ({ handler } = await import('../functions/handle-email-status.mjs'));
    ({ PutItemCommand, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb'));
  });
};

describe('handle-email-status', () => {
  beforeEach(async () => {
    jest.resetModules();
    process.env.TABLE_NAME = 'test-table';
    await loadIsolated();
  });

  describe('Open event tracking', () => {
    it('should track first open with userAgent and ipAddress', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com'],
            commonHeaders: {}
          },
          open: {
            timestamp: '2025-01-21T10:30:00.000Z',
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
            ipAddress: '192.0.2.1'
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(3);

      const trackCall = ddbSend.mock.calls[1][0];
      expect(trackCall.__type).toBe('PutItem');
      expect(trackCall.Item.pk.S).toBe('tenant123#issue-456');
      expect(trackCall.Item.sk.S).toBe('opens#subscriber@example.com');
      expect(trackCall.Item.userAgent.S).toBe('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)');
      expect(trackCall.Item.ipAddress.S).toBe('192.0.2.1');
      expect(trackCall.Item.openedAt.S).toBe('2025-01-21T10:30:00.000Z');
      expect(trackCall.Item.createdAt.S).toBeDefined();
      expect(trackCall.Item.ttl.N).toBeDefined();

      const updateCall = ddbSend.mock.calls[2][0];
      expect(updateCall.__type).toBe('UpdateItem');
    });

    it('should track first open without optional fields', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com'],
            commonHeaders: {}
          },
          open: {}
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);

      const trackCall = ddbSend.mock.calls[1][0];
      expect(trackCall.Item.pk.S).toBe('tenant123#issue-456');
      expect(trackCall.Item.sk.S).toBe('opens#subscriber@example.com');
      expect(trackCall.Item.userAgent).toBeUndefined();
      expect(trackCall.Item.ipAddress).toBeUndefined();
      expect(trackCall.Item.openedAt).toBeUndefined();
      expect(trackCall.Item.createdAt.S).toBeDefined();
    });

    it('should detect reopens and increment reopens stat', async () => {
      ddbSend.mockResolvedValueOnce({});

      const conditionalError = new Error('ConditionalCheckFailedException');
      conditionalError.name = 'ConditionalCheckFailedException';

      ddbSend.mockRejectedValueOnce(conditionalError);
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com'],
            commonHeaders: {}
          },
          open: {
            timestamp: '2025-01-21T11:30:00.000Z',
            userAgent: 'Mozilla/5.0',
            ipAddress: '192.0.2.1'
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(3);

      const updateCall = ddbSend.mock.calls[2][0];
      expect(updateCall.__type).toBe('UpdateItem');
      expect(updateCall.ExpressionAttributeNames['#stat']).toBe('reopens');
    });
  });

  describe('Open event capture (analytics)', () => {
    it('should capture open event with full metadata when sentAt is available', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com'],
            commonHeaders: {
              date: '2025-01-21T10:00:00.000Z'
            }
          },
          open: {
            timestamp: '2025-01-21T10:30:00.000Z',
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
            ipAddress: '192.0.2.1'
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(3);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.__type).toBe('PutItem');
      expect(captureCall.Item.pk.S).toBe('tenant123#issue-456');
      expect(captureCall.Item.sk.S).toMatch(/^open#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#[a-f0-9]{64}#01HQZX3Y4K5M6N7P8Q9R0S1T2U$/);
      expect(captureCall.Item.eventType.S).toBe('open');
      expect(captureCall.Item.subscriberEmailHash.S).toMatch(/^[a-f0-9]{64}$/);
      expect(captureCall.Item.device.S).toBe('mobile');
      expect(captureCall.Item.country.S).toBe('unknown');
      expect(captureCall.Item.timeToOpen.N).toBe('1800');
      expect(captureCall.Item.ttl.N).toBeDefined();
    });

    it('should capture open event with timeToOpen as null when sentAt is missing', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com'],
            commonHeaders: {}
          },
          open: {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            ipAddress: '192.0.2.1'
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.__type).toBe('PutItem');
      expect(captureCall.Item.timeToOpen).toBeUndefined();
    });

    it('should use full SHA-256 hash for subscriber email', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['test@example.com'],
            commonHeaders: {}
          },
          open: {}
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.subscriberEmailHash.S).toMatch(/^[a-f0-9]{64}$/);
      expect(captureCall.Item.subscriberEmailHash.S.length).toBe(64);
    });

    it('should detect device type from user agent', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com'],
            commonHeaders: {}
          },
          open: {
            userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)'
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.device.S).toBe('tablet');
    });

    it('should set device to unknown when userAgent is missing', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com'],
            commonHeaders: {}
          },
          open: {}
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.device.S).toBe('unknown');
    });

    it('should set TTL to 90 days from now', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const now = Date.now();
      const expectedTTL = Math.floor(now / 1000) + (90 * 24 * 60 * 60);

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com'],
            commonHeaders: {}
          },
          open: {}
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      const actualTTL = parseInt(captureCall.Item.ttl.N);
      expect(actualTTL).toBeGreaterThanOrEqual(expectedTTL - 5);
      expect(actualTTL).toBeLessThanOrEqual(expectedTTL + 5);
    });

    it('should include ULID in sort key for uniqueness', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com'],
            commonHeaders: {}
          },
          open: {}
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.sk.S).toContain('01HQZX3Y4K5M6N7P8Q9R0S1T2U');
    });
  });

  describe('Bounce event capture (analytics)', () => {
    it('should capture permanent bounce event with full metadata', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['bounced@example.com']
          },
          bounce: {
            timestamp: '2025-01-21T10:30:00.000Z',
            bounceType: 'Permanent',
            bounceSubType: 'General',
            bouncedRecipients: [
              {
                emailAddress: 'bounced@example.com',
                status: '5.1.1',
                diagnosticCode: 'smtp; 550 5.1.1 user unknown'
              }
            ]
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(2);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.__type).toBe('PutItem');
      expect(captureCall.Item.pk.S).toBe('tenant123#issue-456');
      expect(captureCall.Item.sk.S).toMatch(/^bounce#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#[a-f0-9]{64}#01HQZX3Y4K5M6N7P8Q9R0S1T2U$/);
      expect(captureCall.Item.eventType.S).toBe('bounce');
      expect(captureCall.Item.subscriberEmailHash.S).toMatch(/^[a-f0-9]{64}$/);
      expect(captureCall.Item.bounceType.S).toBe('permanent');
      expect(captureCall.Item.bounceReason.S).toBe('smtp; 550 5.1.1 user unknown');
      expect(captureCall.Item.ttl.N).toBeDefined();
    });

    it('should categorize transient bounce as temporary', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['bounced@example.com']
          },
          bounce: {
            bounceType: 'Transient',
            bounceSubType: 'MailboxFull',
            bouncedRecipients: [
              {
                emailAddress: 'bounced@example.com',
                diagnosticCode: 'smtp; 552 mailbox full'
              }
            ]
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.bounceType.S).toBe('temporary');
      expect(captureCall.Item.bounceReason.S).toBe('smtp; 552 mailbox full');
    });

    it('should categorize suppressed bounce correctly', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['bounced@example.com']
          },
          bounce: {
            bounceType: 'Permanent',
            bounceSubType: 'Suppressed',
            bouncedRecipients: [
              {
                emailAddress: 'bounced@example.com',
                status: '5.1.1'
              }
            ]
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.bounceType.S).toBe('suppressed');
    });

    it('should use status as bounce reason when diagnosticCode is missing', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['bounced@example.com']
          },
          bounce: {
            bounceType: 'Permanent',
            bouncedRecipients: [
              {
                emailAddress: 'bounced@example.com',
                status: '5.1.1'
              }
            ]
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.bounceReason.S).toBe('5.1.1');
    });

    it('should use bounceSubType as reason when recipient info is missing', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['bounced@example.com']
          },
          bounce: {
            bounceType: 'Permanent',
            bounceSubType: 'NoEmail'
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.bounceReason.S).toBe('NoEmail');
    });

    it('should default to unknown reason when no bounce info available', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['bounced@example.com']
          },
          bounce: {}
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.bounceReason.S).toBe('unknown');
    });

    it('should default to temporary bounce type when undetermined', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['bounced@example.com']
          },
          bounce: {
            bounceType: 'Undetermined'
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.bounceType.S).toBe('temporary');
    });

    it('should use full SHA-256 hash for subscriber email', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['test@example.com']
          },
          bounce: {
            bounceType: 'Permanent'
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.subscriberEmailHash.S).toMatch(/^[a-f0-9]{64}$/);
      expect(captureCall.Item.subscriberEmailHash.S.length).toBe(64);
    });

    it('should set TTL to 90 days from now', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const now = Date.now();
      const expectedTTL = Math.floor(now / 1000) + (90 * 24 * 60 * 60);

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['bounced@example.com']
          },
          bounce: {
            bounceType: 'Permanent'
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      const actualTTL = parseInt(captureCall.Item.ttl.N);
      expect(actualTTL).toBeGreaterThanOrEqual(expectedTTL - 5);
      expect(actualTTL).toBeLessThanOrEqual(expectedTTL + 5);
    });

    it('should include ULID in sort key for uniqueness', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['bounced@example.com']
          },
          bounce: {
            bounceType: 'Permanent'
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.sk.S).toContain('01HQZX3Y4K5M6N7P8Q9R0S1T2U');
    });

    it('should handle missing bounce event object', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['bounced@example.com']
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.bounceType.S).toBe('temporary');
      expect(captureCall.Item.bounceReason.S).toBe('unknown');
    });
  });

  describe('Complaint event capture (analytics)', () => {
    it('should capture spam complaint event with full metadata', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Complaint',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['complainer@example.com']
          },
          complaint: {
            timestamp: '2025-01-21T10:30:00.000Z',
            complaintFeedbackType: 'spam'
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(2);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.__type).toBe('PutItem');
      expect(captureCall.Item.pk.S).toBe('tenant123#issue-456');
      expect(captureCall.Item.sk.S).toMatch(/^complaint#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#[a-f0-9]{64}#01HQZX3Y4K5M6N7P8Q9R0S1T2U$/);
      expect(captureCall.Item.eventType.S).toBe('complaint');
      expect(captureCall.Item.subscriberEmailHash.S).toMatch(/^[a-f0-9]{64}$/);
      expect(captureCall.Item.complaintType.S).toBe('spam');
      expect(captureCall.Item.ttl.N).toBeDefined();
    });

    it('should categorize abuse complaint correctly', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Complaint',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['complainer@example.com']
          },
          complaint: {
            complaintFeedbackType: 'abuse'
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.complaintType.S).toBe('abuse');
    });

    it('should categorize fraud as abuse', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Complaint',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['complainer@example.com']
          },
          complaint: {
            complaintFeedbackType: 'fraud'
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.complaintType.S).toBe('abuse');
    });

    it('should categorize virus as abuse', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Complaint',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['complainer@example.com']
          },
          complaint: {
            complaintFeedbackType: 'virus'
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.complaintType.S).toBe('abuse');
    });

    it('should default to spam when complaintFeedbackType is missing', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Complaint',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['complainer@example.com']
          },
          complaint: {}
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.complaintType.S).toBe('spam');
    });

    it('should default to spam when complaint event is missing', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Complaint',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['complainer@example.com']
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.complaintType.S).toBe('spam');
    });

    it('should use full SHA-256 hash for subscriber email', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Complaint',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['test@example.com']
          },
          complaint: {
            complaintFeedbackType: 'spam'
          }
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.subscriberEmailHash.S).toMatch(/^[a-f0-9]{64}$/);
      expect(captureCall.Item.subscriberEmailHash.S.length).toBe(64);
    });

    it('should set TTL to 90 days from now', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const now = Date.now();
      const expectedTTL = Math.floor(now / 1000) + (90 * 24 * 60 * 60);

      const event = {
        detail: {
          eventType: 'Complaint',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['complainer@example.com']
          },
          complaint: {}
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      const actualTTL = parseInt(captureCall.Item.ttl.N);
      expect(actualTTL).toBeGreaterThanOrEqual(expectedTTL - 5);
      expect(actualTTL).toBeLessThanOrEqual(expectedTTL + 5);
    });

    it('should include ULID in sort key for uniqueness', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Complaint',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['complainer@example.com']
          },
          complaint: {}
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.sk.S).toContain('01HQZX3Y4K5M6N7P8Q9R0S1T2U');
    });

    it('should use event request time as timestamp when complaint timestamp is missing', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Complaint',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['complainer@example.com']
          },
          complaint: {}
        }
      };

      await handler(event);

      const captureCall = ddbSend.mock.calls[0][0];
      expect(captureCall.Item.timestamp.S).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('Other event types', () => {
    it('should handle bounce events with stats counter', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Bounce',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['bounced@example.com']
          },
          bounce: {
            bounceType: 'Permanent'
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(2);

      const updateCall = ddbSend.mock.calls[1][0];
      expect(updateCall.__type).toBe('UpdateItem');
      expect(updateCall.ExpressionAttributeNames['#stat']).toBe('bounces');
    });

    it('should handle complaint events with stats counter', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Complaint',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['complainer@example.com']
          },
          complaint: {
            complaintFeedbackType: 'spam'
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(2);

      const updateCall = ddbSend.mock.calls[1][0];
      expect(updateCall.__type).toBe('UpdateItem');
      expect(updateCall.ExpressionAttributeNames['#stat']).toBe('complaints');
    });

    it('should handle delivery events', async () => {
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Delivery',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['delivered@example.com']
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(1);
    });

    it('should handle click events', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Click',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['clicker@example.com']
          },
          click: {
            link: 'https://example.com/article',
            ipAddress: '192.0.2.1'
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('GSI attributes', () => {
    it('should add GSI attributes to stats record on first event', async () => {
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Delivery',
          mail: {
            tags: {
              referenceNumber: ['tenant123_42']
            },
            destination: ['subscriber@example.com']
          }
        }
      };

      const result = await handler(event);

      expect(result).toBe(true);
      expect(ddbSend).toHaveBeenCalledTimes(1);

      const updateCall = ddbSend.mock.calls[0][0];
      expect(updateCall.__type).toBe('UpdateItem');
      expect(updateCall.UpdateExpression).toContain('GSI1PK = if_not_exists(GSI1PK, :gsi1pk)');
      expect(updateCall.UpdateExpression).toContain('GSI1SK = if_not_exists(GSI1SK, :gsi1sk)');
      expect(updateCall.UpdateExpression).toContain('statsPhase = if_not_exists(statsPhase, :phase)');
      expect(updateCall.ExpressionAttributeValues[':gsi1pk'].S).toBe('tenant123#issue');
      expect(updateCall.ExpressionAttributeValues[':gsi1sk'].S).toBe('00042');
      expect(updateCall.ExpressionAttributeValues[':phase'].S).toBe('realtime');
    });

    it('should pad issue numbers correctly', async () => {
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Send',
          mail: {
            tags: {
              referenceNumber: ['tenant456_7']
            },
            destination: ['subscriber@example.com']
          }
        }
      };

      await handler(event);

      const updateCall = ddbSend.mock.calls[0][0];
      expect(updateCall.ExpressionAttributeValues[':gsi1sk'].S).toBe('00007');
    });

    it('should handle large issue numbers', async () => {
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Send',
          mail: {
            tags: {
              referenceNumber: ['tenant789_12345']
            },
            destination: ['subscriber@example.com']
          }
        }
      };

      await handler(event);

      const updateCall = ddbSend.mock.calls[0][0];
      expect(updateCall.ExpressionAttributeValues[':gsi1sk'].S).toBe('12345');
    });
  });

  describe('Error handling', () => {
    it('should return early if no reference number', async () => {
      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {},
            destination: ['subscriber@example.com']
          }
        }
      };

      const result = await handler(event);

      expect(result).toBeUndefined();
      expect(ddbSend).not.toHaveBeenCalled();
    });

    it('should handle unsupported event types', async () => {
      const event = {
        detail: {
          eventType: 'Unknown',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com']
          }
        }
      };

      const result = await handler(event);

      expect(result).toBeUndefined();
      expect(ddbSend).not.toHaveBeenCalled();
    });

    it('should return false on unexpected errors', async () => {
      ddbSend.mockRejectedValueOnce(new Error('Unexpected error'));

      const event = {
        detail: {
          eventType: 'Open',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['subscriber@example.com']
          },
          open: {}
        }
      };

      const result = await handler(event);

      expect(result).toBe(false);
    });
  });

  describe('Click event geolocation (SES)', () => {
    let mockLookupCountry;

    beforeEach(async () => {
      jest.resetModules();
      mockLookupCountry = jest.fn();

      jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
        DynamoDBClient: jest.fn(() => ({ send: ddbSend })),
        PutItemCommand: jest.fn((params) => ({ __type: 'PutItem', ...params })),
        UpdateItemCommand: jest.fn((params) => ({ __type: 'UpdateItem', ...params })),
      }));

      jest.unstable_mockModule('@aws-sdk/util-dynamodb', () => ({
        marshall: (obj) => {
          const result = {};
          for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
              result[key] = { S: value };
            } else if (typeof value === 'number') {
              result[key] = { N: String(value) };
            } else if (Array.isArray(value)) {
              result[key] = { L: value.map(v => ({ S: v })) };
            }
          }
          return result;
        },
      }));

      jest.unstable_mockModule('../functions/utils/helpers.mjs', () => ({
        hash: jest.fn((str) => `hash_${str}`),
      }));

      jest.unstable_mockModule('../functions/utils/geolocation.mjs', () => ({
        lookupCountry: mockLookupCountry,
      }));

      ({ handler } = await import('../functions/handle-email-status.mjs'));
    });

    it('should include country when IP provided and lookup succeeds', async () => {
      mockLookupCountry.mockResolvedValue({
        countryCode: 'US',
        countryName: 'United States'
      });

      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Click',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['clicker@example.com']
          },
          click: {
            link: 'https://example.com/article',
            ipAddress: '8.8.8.8'
          }
        }
      };

      await handler(event);

      expect(mockLookupCountry).toHaveBeenCalledWith('8.8.8.8');
      expect(ddbSend).toHaveBeenCalledTimes(2);

      const linkUpdateCall = ddbSend.mock.calls[0][0];
      expect(linkUpdateCall.__type).toBe('UpdateItem');
      expect(linkUpdateCall.ExpressionAttributeValues[':country'].S).toBe('US');
    });

    it('should handle missing IP gracefully', async () => {
      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Click',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['clicker@example.com']
          },
          click: {
            link: 'https://example.com/article'
          }
        }
      };

      await handler(event);

      expect(mockLookupCountry).not.toHaveBeenCalled();
      expect(ddbSend).toHaveBeenCalledTimes(2);

      const linkUpdateCall = ddbSend.mock.calls[0][0];
      expect(linkUpdateCall.ExpressionAttributeValues[':country'].S).toBe('unknown');
    });

    it('should handle lookup failure gracefully', async () => {
      mockLookupCountry.mockResolvedValue(null);

      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Click',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['clicker@example.com']
          },
          click: {
            link: 'https://example.com/article',
            ipAddress: '10.0.0.1'
          }
        }
      };

      await handler(event);

      expect(mockLookupCountry).toHaveBeenCalledWith('10.0.0.1');
      expect(ddbSend).toHaveBeenCalledTimes(2);

      const linkUpdateCall = ddbSend.mock.calls[0][0];
      expect(linkUpdateCall.ExpressionAttributeValues[':country'].S).toBe('unknown');
    });

    it('should not store IP address in link tracking', async () => {
      mockLookupCountry.mockResolvedValue({
        countryCode: 'GB',
        countryName: 'United Kingdom'
      });

      ddbSend.mockResolvedValueOnce({});
      ddbSend.mockResolvedValueOnce({});

      const event = {
        detail: {
          eventType: 'Click',
          mail: {
            tags: {
              referenceNumber: ['tenant123_issue-456']
            },
            destination: ['clicker@example.com']
          },
          click: {
            link: 'https://example.com/article',
            ipAddress: '8.8.4.4'
          }
        }
      };

      await handler(event);

      const linkUpdateCall = ddbSend.mock.calls[0][0];
      const marshalledValues = linkUpdateCall.ExpressionAttributeValues;

      const hasIpField = Object.keys(marshalledValues).some(key =>
        key.toLowerCase().includes('ip') ||
        (marshalledValues[key].S && marshalledValues[key].S.includes('8.8.4.4'))
      );

      expect(hasIpField).toBe(false);
      expect(linkUpdateCall.ExpressionAttributeValues[':country'].S).toBe('GB');
    });
  });
});
