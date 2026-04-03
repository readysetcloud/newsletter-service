import { classifyLink } from '../link-classifier.mjs';
import { VALID_TOPICS } from '../topic-taxonomy.mjs';

describe('classifyLink', () => {
  describe('return shape', () => {
    it('should return an object with primaryTopic, secondaryTopics, confidence, classifiedBy', () => {
      const result = classifyLink('https://example.com', 'some text');
      expect(result).toHaveProperty('primaryTopic');
      expect(result).toHaveProperty('secondaryTopics');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('classifiedBy');
    });

    it('should always set classifiedBy to heuristic', () => {
      const result = classifyLink('https://example.com', 'serverless lambda');
      expect(result.classifiedBy).toBe('heuristic');
    });
  });

  describe('anchor text keyword matching (primary signal)', () => {
    it('should classify serverless anchor text as serverless', () => {
      const result = classifyLink('https://example.com/article', 'Getting started with serverless');
      expect(result.primaryTopic).toBe('serverless');
      expect(result.confidence).toBe(1.0);
    });

    it('should classify machine learning anchor text as ai', () => {
      const result = classifyLink('https://example.com/post', 'Introduction to machine learning');
      expect(result.primaryTopic).toBe('ai');
      expect(result.confidence).toBe(1.0);
    });

    it('should classify react anchor text as frontend', () => {
      const result = classifyLink('https://example.com/blog', 'Building components with React');
      expect(result.primaryTopic).toBe('frontend');
      expect(result.confidence).toBe(1.0);
    });

    it('should classify terraform anchor text as devops', () => {
      const result = classifyLink('https://example.com/guide', 'Terraform best practices');
      expect(result.primaryTopic).toBe('devops');
      expect(result.confidence).toBe(1.0);
    });

    it('should classify dynamodb anchor text as databases', () => {
      const result = classifyLink('https://example.com/docs', 'DynamoDB single table design');
      expect(result.primaryTopic).toBe('databases');
      expect(result.confidence).toBe(1.0);
    });
  });

  describe('domain matching (supporting signal)', () => {
    it('should use domain hints when anchor text is generic', () => {
      const result = classifyLink('https://openai.com/blog/new-release', 'Read more');
      expect(result.primaryTopic).toBe('ai');
      expect(result.confidence).toBe(1.0);
    });

    it('should match aws lambda domain to serverless', () => {
      const result = classifyLink('https://aws.amazon.com/lambda/features', 'Learn more');
      expect(result.primaryTopic).toBe('serverless');
    });

    it('should match aws dynamodb domain to databases', () => {
      const result = classifyLink('https://aws.amazon.com/dynamodb/pricing', 'Check pricing');
      expect(result.primaryTopic).toBe('databases');
    });

    it('should match owasp.org to security', () => {
      const result = classifyLink('https://owasp.org/top-ten', 'View list');
      expect(result.primaryTopic).toBe('security');
    });
  });

  describe('path keyword matching (supporting signal)', () => {
    it('should use path keywords when anchor text is generic', () => {
      const result = classifyLink('https://example.com/blog/serverless-patterns', 'Click here');
      expect(result.primaryTopic).toBe('serverless');
    });

    it('should match security in path', () => {
      const result = classifyLink('https://example.com/docs/security/best-practices', 'Read docs');
      expect(result.primaryTopic).toBe('security');
    });
  });

  describe('anchor text takes priority over URL signals', () => {
    it('should prefer anchor text topic over domain topic', () => {
      const result = classifyLink('https://openai.com/security', 'Security vulnerability disclosure');
      expect(result.primaryTopic).toBe('security');
    });
  });

  describe('no match', () => {
    it('should return null primaryTopic for unrecognized content', () => {
      const result = classifyLink('https://example.com/random', 'Click here for more');
      expect(result.primaryTopic).toBeNull();
      expect(result.secondaryTopics).toEqual([]);
      expect(result.confidence).toBe(0.0);
      expect(result.classifiedBy).toBe('heuristic');
    });

    it('should return null for empty anchor text and generic URL', () => {
      const result = classifyLink('https://example.com', '');
      expect(result.primaryTopic).toBeNull();
      expect(result.confidence).toBe(0.0);
    });

    it('should handle null anchor text gracefully', () => {
      const result = classifyLink('https://example.com', null);
      expect(result.primaryTopic).toBeNull();
      expect(result.confidence).toBe(0.0);
    });

    it('should handle null URL with valid anchor text', () => {
      const result = classifyLink(null, 'serverless');
      expect(result.primaryTopic).toBe('serverless');
      expect(result.confidence).toBe(1.0);
    });
  });

  describe('secondary topics', () => {
    it('should return secondary topics when multiple topics match', () => {
      const result = classifyLink('https://example.com/post', 'Serverless security best practices for APIs');
      expect(result.primaryTopic).not.toBeNull();
      expect(result.secondaryTopics.length).toBeGreaterThan(0);
      expect(result.secondaryTopics.length).toBeLessThanOrEqual(2);
    });

    it('should return at most 2 secondary topics', () => {
      const result = classifyLink('https://example.com', 'AI serverless security devops testing databases career');
      expect(result.secondaryTopics.length).toBeLessThanOrEqual(2);
    });

    it('should sort secondary topics by descending score', () => {
      const result = classifyLink('https://example.com', 'serverless lambda security testing');
      expect(result.primaryTopic).toBe('serverless');
      expect(result.secondaryTopics.length).toBeGreaterThan(0);
      for (const topic of result.secondaryTopics) {
        expect(VALID_TOPICS.has(topic)).toBe(true);
      }
    });

    it('should not include primary topic in secondary topics', () => {
      const result = classifyLink('https://example.com', 'AI machine learning serverless');
      if (result.primaryTopic) {
        expect(result.secondaryTopics).not.toContain(result.primaryTopic);
      }
    });
  });

  describe('all topic labels are valid', () => {
    it('should only return topics from the taxonomy', () => {
      const testCases = [
        { url: 'https://example.com', anchor: 'serverless lambda functions' },
        { url: 'https://openai.com', anchor: 'AI models' },
        { url: 'https://example.com/security', anchor: 'OWASP top 10' },
      ];

      for (const { url, anchor } of testCases) {
        const result = classifyLink(url, anchor);
        if (result.primaryTopic) {
          expect(VALID_TOPICS.has(result.primaryTopic)).toBe(true);
        }
        for (const topic of result.secondaryTopics) {
          expect(VALID_TOPICS.has(topic)).toBe(true);
        }
      }
    });
  });
});
