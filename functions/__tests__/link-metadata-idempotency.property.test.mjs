import * as fc from 'fast-check';
import { jest } from '@jest/globals';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { classifyAndStoreLinkMetadata } from '../update-link-tracking.mjs';

/**
 * Feature: auto-interest-segmentation
 * Property 5: Link_Metadata storage is idempotent
 *
 * **Validates: Requirements 2.9**
 *
 * For any classified link URL, storing Link_Metadata for the same normalized
 * URL multiple times must result in exactly one Link_Metadata record. The
 * second and subsequent writes must reuse the existing classification without
 * overwriting.
 */

/**
 * Arbitrary: generates a classifiable URL paired with matching anchor text
 * so the classifier produces confidence >= 0.5 and actually attempts storage.
 */
const arbClassifiableLink = fc.constantFrom(
  { url: 'https://aws.amazon.com/lambda', anchorText: 'Getting started with serverless Lambda' },
  { url: 'https://kubernetes.io/docs', anchorText: 'Kubernetes DevOps guide' },
  { url: 'https://reactjs.org/tutorial', anchorText: 'React frontend tutorial' },
  { url: 'https://docs.docker.com/engine', anchorText: 'Docker container security' },
  { url: 'https://github.com/actions', anchorText: 'GitHub Actions CI/CD pipeline' },
  { url: 'https://owasp.org/security', anchorText: 'OWASP security best practices' },
  { url: 'https://graphql.org/learn', anchorText: 'GraphQL API design patterns' },
  { url: 'https://prometheus.io/docs', anchorText: 'Prometheus observability monitoring' }
);

describe('Property 5: Link_Metadata storage is idempotent', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.TABLE_NAME;
    process.env.TABLE_NAME = 'test-table';
  });

  afterEach(() => {
    process.env.TABLE_NAME = originalEnv;
  });

  /**
   * **Validates: Requirements 2.9**
   */
  test('storing Link_Metadata twice for the same URL results in exactly one record', async () => {
    await fc.assert(
      fc.asyncProperty(arbClassifiableLink, async ({ url, anchorText }) => {
        const storedItems = new Map();
        let putCallCount = 0;

        DynamoDBClient.prototype.send = jest.fn().mockImplementation((command) => {
          const cmdName = command.constructor.name;

          if (cmdName === 'GetItemCommand') {
            const key = unmarshall(command.input.Key);
            if (storedItems.has(key.sk)) {
              return Promise.resolve({
                Item: marshall(storedItems.get(key.sk)),
              });
            }
            return Promise.resolve({});
          }

          if (cmdName === 'PutItemCommand') {
            const item = unmarshall(command.input.Item);
            putCallCount++;

            if (storedItems.has(item.sk)) {
              const err = new Error('The conditional request failed');
              err.name = 'ConditionalCheckFailedException';
              return Promise.reject(err);
            }

            storedItems.set(item.sk, item);
            return Promise.resolve({});
          }

          return Promise.resolve({});
        });

        // First call - should classify and store
        await classifyAndStoreLinkMetadata(url, anchorText);

        // Second call - should detect existing metadata via GetItem and skip
        await classifyAndStoreLinkMetadata(url, anchorText);

        // Exactly one record should exist
        expect(storedItems.size).toBe(1);

        // The stored record should have correct structure
        const [, record] = [...storedItems.entries()][0];
        expect(record.pk).toBe('LINK_META');
        expect(record.primaryTopic).toBeDefined();
        expect(record.classifiedBy).toBe('heuristic');

        // Only one PutItem should have succeeded
        expect(putCallCount).toBe(1);
      }),
      { numRuns: 100 }
    );
  });

  test('second write is a no-op when ConditionalCheckFailedException is thrown on race condition', async () => {
    await fc.assert(
      fc.asyncProperty(arbClassifiableLink, async ({ url, anchorText }) => {
        let putAttempts = 0;
        let conditionalFailures = 0;

        DynamoDBClient.prototype.send = jest.fn().mockImplementation((command) => {
          const cmdName = command.constructor.name;

          if (cmdName === 'GetItemCommand') {
            // Simulate race condition: GetItem always returns empty
            return Promise.resolve({});
          }

          if (cmdName === 'PutItemCommand') {
            putAttempts++;

            if (putAttempts > 1) {
              conditionalFailures++;
              const err = new Error('The conditional request failed');
              err.name = 'ConditionalCheckFailedException';
              return Promise.reject(err);
            }

            return Promise.resolve({});
          }

          return Promise.resolve({});
        });

        // First call - stores successfully
        await classifyAndStoreLinkMetadata(url, anchorText);

        // Second call - PutItem throws ConditionalCheckFailedException (no-op)
        await classifyAndStoreLinkMetadata(url, anchorText);

        // Two PutItem attempts were made (race condition scenario)
        expect(putAttempts).toBe(2);

        // Second attempt was caught as ConditionalCheckFailedException
        expect(conditionalFailures).toBe(1);
      }),
      { numRuns: 100 }
    );
  });
});
