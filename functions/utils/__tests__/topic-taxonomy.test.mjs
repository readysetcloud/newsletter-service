/**
 * Unit tests for platform topic taxonomy module
 */

import {
  TOPICS,
  VALID_TOPICS,
  AUTO_SEGMENT_THRESHOLD,
  PRIMARY_SCORE_INCREMENT,
  SECONDARY_SCORE_INCREMENT,
  MAX_SCORE_PER_CLICK,
  getTopicDisplayName,
} from '../topic-taxonomy.mjs';

describe('TOPICS', () => {
  it('should be a frozen object', () => {
    expect(Object.isFrozen(TOPICS)).toBe(true);
  });

  it('should contain between 8 and 15 topics', () => {
    const count = Object.keys(TOPICS).length;
    expect(count).toBeGreaterThanOrEqual(8);
    expect(count).toBeLessThanOrEqual(15);
  });

  it('should have lowercase labels matching their keys', () => {
    for (const [key, topic] of Object.entries(TOPICS)) {
      expect(topic.label).toBe(key);
      expect(topic.label).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it('should have non-empty display names', () => {
    for (const topic of Object.values(TOPICS)) {
      expect(typeof topic.display).toBe('string');
      expect(topic.display.length).toBeGreaterThan(0);
    }
  });
});

describe('VALID_TOPICS', () => {
  it('should be a Set containing all topic keys', () => {
    expect(VALID_TOPICS).toBeInstanceOf(Set);
    expect(VALID_TOPICS.size).toBe(Object.keys(TOPICS).length);
    for (const key of Object.keys(TOPICS)) {
      expect(VALID_TOPICS.has(key)).toBe(true);
    }
  });
});

describe('constants', () => {
  it('should export correct threshold and increment values', () => {
    expect(AUTO_SEGMENT_THRESHOLD).toBe(3);
    expect(PRIMARY_SCORE_INCREMENT).toBe(1.0);
    expect(SECONDARY_SCORE_INCREMENT).toBe(0.5);
    expect(MAX_SCORE_PER_CLICK).toBe(1.5);
  });
});

describe('getTopicDisplayName', () => {
  it('should return display name for a valid topic label', () => {
    expect(getTopicDisplayName('ai')).toBe('AI');
    expect(getTopicDisplayName('serverless')).toBe('Serverless');
    expect(getTopicDisplayName('eda')).toBe('Event-Driven Architecture');
  });

  it('should return the label itself for an unknown topic', () => {
    expect(getTopicDisplayName('unknown')).toBe('unknown');
    expect(getTopicDisplayName('foo-bar')).toBe('foo-bar');
  });
});
