import { describe, it, expect } from '@jest/globals';
import {
  isSendStillLive,
  needsTemplate,
  describeIssue
} from '../scripts/check-issues-missing-template.mjs';

const HOURS = 60 * 60 * 1000;
const NOW = Date.parse('2026-08-28T00:00:00Z');
const STALE_AFTER = 48 * HOURS;

const ago = (hours) => new Date(NOW - hours * HOURS).toISOString();
const ahead = (hours) => new Date(NOW + hours * HOURS).toISOString();

describe('isSendStillLive', () => {
  // The regression this exists for. Nine production records sat on `in
  // progress` for issues sent months earlier — the status only advances when
  // the send path completes its transition, so an abandoned or partly-failed
  // send leaves it there permanently. Reading status as "an execution is
  // running" blocked a production deploy on history rather than on risk.
  describe('in progress', () => {
    it('is not live when nothing has touched the record for longer than the window', () => {
      expect(isSendStillLive(
        { status: 'in progress', updatedAt: ago(24 * 90) },
        NOW,
        STALE_AFTER
      )).toBe(false);
    });

    it('is live while the record is still moving', () => {
      expect(isSendStillLive(
        { status: 'in progress', updatedAt: ago(2) },
        NOW,
        STALE_AFTER
      )).toBe(true);
    });

    // The publish lead time is 26h in production, so a workflow that started
    // yesterday for a send happening today is genuinely still under way.
    it('is live across a full lead time', () => {
      expect(isSendStillLive(
        { status: 'in progress', updatedAt: ago(26) },
        NOW,
        STALE_AFTER
      )).toBe(true);
    });

    it('falls back to scheduledAt when the record carries no updatedAt', () => {
      expect(isSendStillLive(
        { status: 'in progress', scheduledAt: ago(1) },
        NOW,
        STALE_AFTER
      )).toBe(true);
      expect(isSendStillLive(
        { status: 'in progress', scheduledAt: ago(500) },
        NOW,
        STALE_AFTER
      )).toBe(false);
    });
  });

  describe('scheduled', () => {
    it('is live for a send that has not happened yet', () => {
      expect(isSendStillLive(
        { status: 'scheduled', scheduledAt: ahead(72) },
        NOW,
        STALE_AFTER
      )).toBe(true);
    });

    it('is live for one that just fired, since the workflow may still be running', () => {
      expect(isSendStillLive(
        { status: 'scheduled', scheduledAt: ago(3) },
        NOW,
        STALE_AFTER
      )).toBe(true);
    });

    it('is not live once its instant is well past', () => {
      expect(isSendStillLive(
        { status: 'scheduled', scheduledAt: ago(24 * 30) },
        NOW,
        STALE_AFTER
      )).toBe(false);
    });
  });

  // Blocking a deploy that did not need blocking costs an evening. Letting a
  // real one through costs the whole list receiving nothing, so an
  // unclassifiable record is treated as live.
  it('treats a record with no usable timestamp as live', () => {
    expect(isSendStillLive({ status: 'in progress' }, NOW, STALE_AFTER)).toBe(true);
    expect(isSendStillLive({ status: 'scheduled' }, NOW, STALE_AFTER)).toBe(true);
    expect(isSendStillLive(
      { status: 'in progress', updatedAt: 'not a date' },
      NOW,
      STALE_AFTER
    )).toBe(true);
  });

  it('honours a widened window', () => {
    const issue = { status: 'in progress', updatedAt: ago(100) };
    expect(isSendStillLive(issue, NOW, 48 * HOURS)).toBe(false);
    expect(isSendStillLive(issue, NOW, 200 * HOURS)).toBe(true);
  });
});

describe('needsTemplate', () => {
  it('exempts pre-rendered html, which is sent verbatim', () => {
    expect(needsTemplate('html')).toBe(false);
  });

  it('requires one for every other mode, including an absent contentType', () => {
    expect(needsTemplate('markdown')).toBe(true);
    expect(needsTemplate('json')).toBe(true);
    expect(needsTemplate(undefined)).toBe(true);
  });
});

describe('describeIssue', () => {
  // Records predating `issueNumber` printed as "#undefined" with subject
  // "undefined", which told an operator nothing about which row to go fix.
  it('falls back to the partition key when the record has no issueNumber', () => {
    const line = describeIssue({
      pk: 'readysetcloud#150',
      issueNumber: null,
      subject: null,
      status: 'in progress',
      scheduledAt: null,
      updatedAt: null,
      reason: 'no templateId'
    });

    expect(line).toContain('readysetcloud#150');
    expect(line).toContain('(#?)');
    expect(line).toContain('(no subject)');
    expect(line).not.toContain('undefined');
  });

  it('shows the number and subject when they are there', () => {
    const line = describeIssue({
      pk: 'readysetcloud#223',
      issueNumber: 223,
      subject: 'MicroVMs as GitHub runners',
      status: 'scheduled',
      scheduledAt: '2026-09-01T14:00:00Z',
      updatedAt: null,
      reason: 'no templateId'
    });

    expect(line).toContain('(#223)');
    expect(line).toContain('MicroVMs as GitHub runners');
    expect(line).toContain('2026-09-01T14:00:00Z');
  });
});
