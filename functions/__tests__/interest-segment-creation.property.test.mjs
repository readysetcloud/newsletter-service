import * as fc from 'fast-check';
import { jest } from '@jest/globals';
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { TOPICS, getTopicDisplayName } from '../utils/topic-taxonomy.mjs';

// Must set env before importing the module
process.env.TABLE_NAME = 'test-newsletter-table';
process.env.SUBSCRIBERS_TABLE_NAME = 'test-subscribers-table';
process.env.EMAIL_ENCRYPTION_KEY = 'test-encryption-key-for-testing-only';

/**
 * Feature: auto-interest-segmentation
 * Property 8: Interest_Segment creation produces correct record
 *
 * **Validates: Requirements 5.2, 5.5, 6.2**
 *
 * For any topic label in the taxonomy, creating an Interest_Segment must
 * produce a Segment_Record with: name equal to "Auto: {displayName}",
 * a description indicating automatic management, autoManaged set to true,
 * and memberCount of 0.
 */

let findOrCreateInterestSegment;
let mockSend;

beforeEach(async () => {
  mockSend = jest.fn().mockResolvedValue({});
  DynamoDBClient.prototype.send = mockSend;
  jest.clearAllMocks();

  const mod = await import('../process-link-click.mjs');
  findOrCreateInterestSegment = mod.findOrCreateInterestSegment;
});

const topicKeys = Object.keys(TOPICS);
const arbTopic = fc.constantFrom(...topicKeys);
const arbTenantId = fc.uuid();

describe('Property 8: Interest_Segment creation produces correct record', () => {
  /**
   * **Validates: Requirements 5.2, 5.5, 6.2**
   */
  test('segment record has correct name, autoManaged, memberCount, and description for any topic', async () => {
    await fc.assert(
      fc.asyncProperty(arbTopic, arbTenantId, async (topic, tenantId) => {
        let capturedTransactItems = null;

        mockSend.mockReset();
        mockSend.mockImplementation((command) => {
          const cmdName = command.constructor.name;

          if (cmdName === 'GetItemCommand') {
            // No existing segment
            return Promise.resolve({});
          }

          if (cmdName === 'TransactWriteItemsCommand') {
            capturedTransactItems = command.input.TransactItems;
            return Promise.resolve({});
          }

          return Promise.resolve({});
        });

        const segmentId = await findOrCreateInterestSegment(tenantId, topic);

        // Should have returned a segment ID
        expect(typeof segmentId).toBe('string');
        expect(segmentId.length).toBeGreaterThan(0);

        // TransactWriteItems should have been called
        expect(capturedTransactItems).not.toBeNull();
        expect(capturedTransactItems).toHaveLength(2);

        // Extract the segment record (second Put in the transaction)
        const segmentPut = capturedTransactItems[1].Put;
        const segmentRecord = unmarshall(segmentPut.Item);

        const displayName = getTopicDisplayName(topic);

        // Name must match "Auto: {displayName}"
        expect(segmentRecord.name).toBe(`Auto: ${displayName}`);

        // autoManaged must be true
        expect(segmentRecord.autoManaged).toBe(true);

        // memberCount must be 0
        expect(segmentRecord.memberCount).toBe(0);

        // description must contain the topic display name
        expect(segmentRecord.description).toContain(displayName);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.2**
   */
  test('uniqueness key uses normalized lowercase topic label, not display name', async () => {
    await fc.assert(
      fc.asyncProperty(arbTopic, arbTenantId, async (topic, tenantId) => {
        let capturedTransactItems = null;

        mockSend.mockReset();
        mockSend.mockImplementation((command) => {
          const cmdName = command.constructor.name;

          if (cmdName === 'GetItemCommand') {
            return Promise.resolve({});
          }

          if (cmdName === 'TransactWriteItemsCommand') {
            capturedTransactItems = command.input.TransactItems;
            return Promise.resolve({});
          }

          return Promise.resolve({});
        });

        await findOrCreateInterestSegment(tenantId, topic);

        // Extract the uniqueness record (first Put in the transaction)
        const uniquenessPut = capturedTransactItems[0].Put;
        const uniquenessRecord = unmarshall(uniquenessPut.Item);

        // Uniqueness key must use lowercase topic label
        expect(uniquenessRecord.email).toBe(`SEGMENT_NAME#auto: ${topic}`);

        // Uniqueness key must NOT contain the display name (unless display === label)
        const displayName = getTopicDisplayName(topic);
        if (displayName !== topic) {
          expect(uniquenessRecord.email).not.toContain(displayName);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.5, 6.2**
   */
  test('segment record has a valid createdAt timestamp and correct segmentId', async () => {
    await fc.assert(
      fc.asyncProperty(arbTopic, arbTenantId, async (topic, tenantId) => {
        let capturedTransactItems = null;

        mockSend.mockReset();
        mockSend.mockImplementation((command) => {
          const cmdName = command.constructor.name;

          if (cmdName === 'GetItemCommand') {
            return Promise.resolve({});
          }

          if (cmdName === 'TransactWriteItemsCommand') {
            capturedTransactItems = command.input.TransactItems;
            return Promise.resolve({});
          }

          return Promise.resolve({});
        });

        const segmentId = await findOrCreateInterestSegment(tenantId, topic);

        const segmentPut = capturedTransactItems[1].Put;
        const segmentRecord = unmarshall(segmentPut.Item);

        // segmentId in the record must match the returned value
        expect(segmentRecord.segmentId).toBe(segmentId);

        // createdAt must be a valid ISO 8601 timestamp
        expect(segmentRecord.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

        // Segment SK must follow the pattern SEGMENT#<segmentId>
        expect(segmentRecord.email).toBe(`SEGMENT#${segmentId}`);
      }),
      { numRuns: 100 }
    );
  });
});
