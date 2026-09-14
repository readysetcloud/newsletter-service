import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

/**
 * The `ISSUE_PUBLISHED` → `Issue Handed Off` rename, pinned.
 *
 * Renaming a detail-type that is already on the bus is a two-sided change: the
 * rule has to learn the new name and the publishers have to start using it, and
 * a deploy cannot do both at the same instant. The safety here is entirely in
 * two places that look like housekeeping and are not — a `DependsOn` on each
 * publisher, and the old name still sitting in the rule's pattern. Delete
 * either and nothing fails; an issue published in the wrong few seconds just
 * loses its analytics scheduling, silently, once.
 *
 * So these assert the arrangement rather than any behaviour. They are here to
 * make a well-meaning tidy-up loud.
 */

const TEMPLATE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'template.yaml'
);

/**
 * CloudFormation shorthand (`!Ref`, `!GetAtt`, …) is not plain YAML.
 *
 * Enumerated rather than matched by prefix because js-yaml 3 has no multi-tag
 * support. The values are never inspected here — only the structure around
 * them — so every tag resolves to its raw data.
 */
const CFN_TAGS = [
  'Ref', 'GetAtt', 'Sub', 'Join', 'Select', 'Split', 'FindInMap', 'If', 'Not',
  'Equals', 'And', 'Or', 'Base64', 'Cidr', 'ImportValue', 'GetAZs', 'Condition',
  'Transform'
];

const CFN_SCHEMA = yaml.Schema.create(
  CFN_TAGS.flatMap((tag) =>
    ['scalar', 'sequence', 'mapping'].map((kind) =>
      new yaml.Type(`!${tag}`, { kind, construct: (data) => data })
    )
  )
);

const template = yaml.safeLoad(readFileSync(TEMPLATE, 'utf8'), { schema: CFN_SCHEMA });
const resources = template.Resources;

/** The generated rule's logical id, which the DependsOn entries name. */
const RULE_ID = 'ScheduleAggregationFunctionIssuePublishedEvent';

const aggregationRule = () =>
  resources.ScheduleAggregationFunction.Properties.Events.IssuePublishedEvent;

describe('the Issue Handed Off migration', () => {
  it('keeps the aggregation rule matching both names', () => {
    // The old name is what anything already in flight was published under.
    expect(aggregationRule().Properties.Pattern['detail-type']).toEqual(
      expect.arrayContaining(['Issue Handed Off', 'ISSUE_PUBLISHED'])
    );
  });

  it.each(['PublishIssueFunction', 'ApiFunction'])(
    '%s waits for the rule before it updates',
    (fn) => {
      // Without this the two are independent resources and either may land
      // first. A publisher that landed first would emit a name the rule had not
      // learned yet, at nothing.
      expect(resources[fn].DependsOn).toBe(RULE_ID);
    }
  );

  it('names a rule that the template actually generates', () => {
    // SAM builds the id from the function and the Events key, so renaming
    // either would leave these DependsOn entries pointing at nothing — which
    // fails the deploy loudly, but only if the two halves are kept in step.
    expect(resources.ScheduleAggregationFunction).toBeDefined();
    expect(aggregationRule()).toBeDefined();
    expect(RULE_ID).toBe('ScheduleAggregationFunction' + 'IssuePublishedEvent');
  });

  it('does not let the notification consumer hear the hand-off', () => {
    // The whole reason for the rename. This event means "handed to the send
    // path", which for a scheduled issue is up to twenty-six hours before any
    // mail moves; notifications ride on `Issue Send Completed` instead.
    const detailTypes = Object.values(
      resources.CreateNotificationFunction.Properties.Events
    ).flatMap((event) => event.Properties.Pattern['detail-type']);

    expect(detailTypes).toContain('Issue Send Completed');
    expect(detailTypes).not.toContain('Issue Handed Off');
    expect(detailTypes).not.toContain('ISSUE_PUBLISHED');
  });
});
