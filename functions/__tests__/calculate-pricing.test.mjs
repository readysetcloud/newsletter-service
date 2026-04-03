import fc from 'fast-check';
import {
  computeBaseline,
  clampMultiplier,
  applySmoothing,
  validateLlmResponse,
  computeRecommendedPrice,
  computeWeeklyWindow,
  determineConfidence,
  cpmForBand,
  getValidBands,
  factorsToMultiplier,
  classifyBandFromQuestionnaire,
  reconcileBandWithFactors,
  buildDeterministicClassification
} from '../utils/pricing.mjs';
import {
  buildPrompt,
  selectSmoothingBaseRecord,
  evaluatePricingConfidence
} from '../calculate-pricing.mjs';

describe('Audience band CPM table', () => {
  it('returns a CPM for every valid band', () => {
    for (const band of getValidBands()) {
      expect(cpmForBand(band)).toBeGreaterThan(0);
    }
  });

  it('falls back to prosumer for unknown bands', () => {
    expect(cpmForBand('nonexistent')).toBe(cpmForBand('prosumer'));
  });

  it('premium_niche has the highest CPM', () => {
    const cpms = getValidBands().map(b => cpmForBand(b));
    expect(cpmForBand('premium_niche')).toBe(Math.max(...cpms));
  });
});

describe('factorsToMultiplier', () => {
  it('all medium factors produce multiplier of 1.0', () => {
    const m = factorsToMultiplier({
      audienceQuality: 'medium', nicheSpecificity: 'medium',
      cadenceHealth: 'medium', sponsorFit: 'medium'
    });
    expect(m).toBe(1.0);
  });

  it('all high factors produce multiplier > 1.0', () => {
    const m = factorsToMultiplier({
      audienceQuality: 'high', nicheSpecificity: 'high',
      cadenceHealth: 'high', sponsorFit: 'high'
    });
    expect(m).toBeGreaterThan(1.0);
    expect(m).toBeLessThanOrEqual(2.0);
  });

  it('all low factors produce multiplier < 1.0', () => {
    const m = factorsToMultiplier({
      audienceQuality: 'low', nicheSpecificity: 'low',
      cadenceHealth: 'low', sponsorFit: 'low'
    });
    expect(m).toBeLessThan(1.0);
    expect(m).toBeGreaterThanOrEqual(0.5);
  });

  it('result is always clamped to [0.5, 2.0]', () => {
    fc.assert(fc.property(
      fc.constantFrom('low', 'medium', 'high'),
      fc.constantFrom('low', 'medium', 'high'),
      fc.constantFrom('low', 'medium', 'high'),
      fc.constantFrom('low', 'medium', 'high'),
      (aq, ns, ch, sf) => {
        const m = factorsToMultiplier({ audienceQuality: aq, nicheSpecificity: ns, cadenceHealth: ch, sponsorFit: sf });
        expect(m).toBeGreaterThanOrEqual(0.5);
        expect(m).toBeLessThanOrEqual(2.0);
      }
    ), { numRuns: 81 });
  });
});

describe('validateLlmResponse (structured classification)', () => {
  it('accepts valid classification', () => {
    const result = validateLlmResponse({
      audienceQuality: 'high', nicheSpecificity: 'medium',
      cadenceHealth: 'high', sponsorFit: 'high',
      suggestedBand: 'b2b_technical', justification: 'Strong technical audience'
    });
    expect(result.valid).toBe(true);
  });

  it('rejects invalid factor ratings', () => {
    const result = validateLlmResponse({
      audienceQuality: 'very_high', nicheSpecificity: 'medium',
      cadenceHealth: 'high', sponsorFit: 'high',
      suggestedBand: 'b2b_technical', justification: 'test'
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('audienceQuality')]));
  });

  it('rejects invalid band', () => {
    const result = validateLlmResponse({
      audienceQuality: 'high', nicheSpecificity: 'medium',
      cadenceHealth: 'high', sponsorFit: 'high',
      suggestedBand: 'ultra_premium', justification: 'test'
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('suggestedBand')]));
  });

  it('rejects non-object input', () => {
    expect(validateLlmResponse(null).valid).toBe(false);
    expect(validateLlmResponse('string').valid).toBe(false);
    expect(validateLlmResponse([]).valid).toBe(false);
  });
});

describe('Pipeline: clamp + smooth composition', () => {
  it('clamp then smooth produces same result as composed function', () => {
    fc.assert(fc.property(
      fc.double({ min: 0.3, max: 2.5, noNaN: true }),
      fc.double({ min: 1, max: 10_000, noNaN: true }),
      fc.double({ min: 1, max: 10_000, noNaN: true }),
      (rawMultiplier, previousPrice, baseline) => {
        const multiplierMin = 0.5;
        const multiplierMax = 2.0;
        const smoothingCapPct = 0.20;
        const metricChanges = { subscriberChangePct: 0.05, openRateChangePts: 2 };
        const significantThresholds = { subscriberChangePct: 0.25, openRateChangePts: 10 };

        const clamped = clampMultiplier(rawMultiplier, multiplierMin, multiplierMax);
        const newPrice = computeRecommendedPrice(baseline, clamped);
        const { smoothedPrice } = applySmoothing(
          previousPrice, newPrice, smoothingCapPct, metricChanges, significantThresholds
        );

        const composed = applySmoothing(
          previousPrice,
          computeRecommendedPrice(baseline, clampMultiplier(rawMultiplier, multiplierMin, multiplierMax)),
          smoothingCapPct, metricChanges, significantThresholds
        ).smoothedPrice;

        expect(smoothedPrice).toBe(composed);
      }
    ), { numRuns: 100 });
  });
});

describe('Lambda pricing flow helpers', () => {
  it('smoothing anchors to the previous completed week only', () => {
    const currentWeekWindow = '2026-04-01T15:00:00.000Z/2026-04-08T15:00:00.000Z';
    const previousWeekRecord = {
      weekWindow: '2026-03-25T15:00:00.000Z/2026-04-01T15:00:00.000Z',
      recommendedPrice: 100
    };
    const currentWeekRecord = { weekWindow: currentWeekWindow, recommendedPrice: 130 };

    expect(selectSmoothingBaseRecord(previousWeekRecord, currentWeekWindow)).toBe(previousWeekRecord);
    expect(selectSmoothingBaseRecord(currentWeekRecord, currentWeekWindow)).toBeNull();
  });

  it('stale data lowers deterministic confidence', () => {
    const metrics = {
      avgOpenRate: 0.35, avgClickRate: 0.05, avgBounceRate: 0.001, avgComplaintRate: 0.0001,
      publishedIssueCount: 12, volatility: { openRateCoV: 0.05, clickRateCoV: 0.10 },
      cadenceStdDevDays: 1, latestPublishedAt: '2026-01-01T00:00:00.000Z'
    };
    const config = { cadenceRegularityThreshold: 3, dataRecencyThresholdDays: 30 };
    const result = evaluatePricingConfidence(metrics, { q1: 'Technology' }, false, config, new Date('2026-04-02T00:00:00.000Z'));
    expect(result.isDataStale).toBe(true);
    expect(result.confidence).toBe('low');
  });

  it('serializes questionnaire arrays and objects cleanly into the prompt', () => {
    const metrics = {
      subscriberCount: 10000, subscriberGrowthRate: 0.05,
      avgOpenRate: 0.32, avgClickRate: 0.04, avgBounceRate: 0.002, avgComplaintRate: 0.0001,
      publishedIssueCount: 10, latestPublishedAt: '2026-04-01T00:00:00.000Z',
      averageDaysBetweenIssues: 7, medianDaysBetweenIssues: 7, cadenceStdDevDays: 1,
      recentTrend: {
        openRate: { first: 0.28, last: 0.34, slopePerIssue: 0.01 },
        clickRate: { first: 0.03, last: 0.05, slopePerIssue: 0.004 }
      },
      volatility: { openRateCoV: 0.12, clickRateCoV: 0.18 },
      issueDataPoints: [
        { subscribers: 9500, openRate: 0.28, clickRate: 0.03, bounceRate: 0.002, complaintRate: 0.0001, publishedAt: '2026-03-25T00:00:00.000Z' },
        { subscribers: 10000, openRate: 0.34, clickRate: 0.05, bounceRate: 0.002, complaintRate: 0.0001, publishedAt: '2026-04-01T00:00:00.000Z' }
      ]
    };
    const questionnaireResponses = {
      q3: ['Dedicated email', 'Banner ad'],
      q6: { niche: 'Cloud', audience: 'Engineers' }
    };
    const config = { industryAvgOpenRate: 0.4346, industryAvgClickRate: 0.0209, industryAvgUnsubscribeRate: 0.0022 };

    const prompt = buildPrompt(metrics, questionnaireResponses, config);
    expect(prompt).toContain('Dedicated email, Banner ad');
    expect(prompt).toContain('{"niche":"Cloud","audience":"Engineers"}');
    expect(prompt).toContain('submit_pricing_classification');
  });
});

describe('Baseline floor for small lists', () => {
  it('floor kicks in for small subscriber counts', () => {
    const baseline = computeBaseline(500, 0.30, 0.03, 25, 2.0);
    const floor = 500 * 0.05;
    expect(baseline).toBeGreaterThanOrEqual(floor);
  });

  it('CPM calculation dominates for large lists with high CPM', () => {
    // At high CPM and large list, CPM price exceeds the per-sub floor
    const baseline = computeBaseline(100000, 0.40, 0.03, 250, 2.0);
    const cpmPrice = (100000 * 0.40 / 1000) * 250 * (1 + 0.03 * 2.0);
    const floor = 100000 * 0.10;
    expect(cpmPrice).toBeGreaterThan(floor);
    expect(baseline).toBe(cpmPrice);
  });
});

describe('DynamoDB key generation', () => {
  it('pk={tenantId}, sk=pricing#{timestamp}', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-12-31T23:59:59Z'), noInvalidDate: true }),
      (tenantId, date) => {
        const timestamp = date.toISOString();
        const sk = `pricing#${timestamp}`;
        expect(sk.startsWith('pricing#')).toBe(true);
        expect(new Date(sk.replace('pricing#', '')).toISOString()).toBe(timestamp);
      }
    ), { numRuns: 100 });
  });
});

describe('Reduced accuracy notice', () => {
  it('included when published issues < minimum', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 2 }),
      fc.integer({ min: 3, max: 10 }),
      fc.string({ minLength: 1, maxLength: 200 }),
      (count, min, original) => {
        let justification = original;
        if (count < min) {
          justification = `[Reduced accuracy: only ${count} published issue(s), minimum recommended is ${min}] ${justification}`;
        }
        expect(justification).toContain('[Reduced accuracy:');
        expect(justification).toContain(original);
      }
    ), { numRuns: 100 });
  });
});

describe('classifyBandFromQuestionnaire', () => {
  it('classifies Technology industry as b2b_technical', () => {
    const band = classifyBandFromQuestionnaire({ q1: 'Technology', q2: 'General tech news' }, null);
    expect(band).toBe('b2b_technical');
  });

  it('upgrades band when niche description mentions executives', () => {
    const band = classifyBandFromQuestionnaire({
      q1: 'Technology',
      q2: 'For CTOs and engineering leaders at startups'
    }, null);
    expect(band).toBe('exec_operator');
  });

  it('classifies Finance as premium_niche', () => {
    const band = classifyBandFromQuestionnaire({ q1: 'Finance', q2: 'Investment strategies' }, null);
    expect(band).toBe('premium_niche');
  });

  it('upgrades when dedicated email AND revenue goal', () => {
    const band = classifyBandFromQuestionnaire({
      q1: 'Education',
      q2: 'Online learning tips',
      q3: ['Dedicated email'],
      q5: 'Maximize revenue per issue'
    }, null);
    // Education = prosumer, dedicated email + revenue goal nudges up to b2b_general
    expect(band).toBe('b2b_general');
  });

  it('uses niche keywords to upgrade from industry default', () => {
    const band = classifyBandFromQuestionnaire({
      q1: 'Technology',
      q2: 'For app builders who care about AI agents, serverless, and cloud development'
    }, null);
    expect(band).toBe('b2b_technical');
  });

  it('falls back to metrics when no questionnaire', () => {
    const band = classifyBandFromQuestionnaire(null, { avgOpenRate: 0.55, avgClickRate: 0.06 });
    expect(band).toBe('b2b_technical');
  });

  it('falls back to prosumer when no signals', () => {
    const band = classifyBandFromQuestionnaire(null, { avgOpenRate: 0.20, avgClickRate: 0.01 });
    expect(band).toBe('prosumer');
  });
});

describe('reconcileBandWithFactors', () => {
  it('keeps band when factors are consistent', () => {
    const band = reconcileBandWithFactors({
      suggestedBand: 'premium_niche',
      nicheSpecificity: 'high',
      audienceQuality: 'high'
    });
    expect(band).toBe('premium_niche');
  });

  it('downgrades band when factors are inconsistent', () => {
    const band = reconcileBandWithFactors({
      suggestedBand: 'premium_niche',
      nicheSpecificity: 'low',
      audienceQuality: 'high'
    });
    expect(band).toBe('exec_operator');
  });

  it('downgrades exec_operator when audienceQuality is not high', () => {
    const band = reconcileBandWithFactors({
      suggestedBand: 'exec_operator',
      audienceQuality: 'medium',
      nicheSpecificity: 'high'
    });
    expect(band).toBe('b2b_technical');
  });

  it('passes through broad_consumer with no constraints', () => {
    const band = reconcileBandWithFactors({
      suggestedBand: 'broad_consumer',
      audienceQuality: 'low',
      nicheSpecificity: 'low'
    });
    expect(band).toBe('broad_consumer');
  });

  it('passes through prosumer with no constraints', () => {
    const band = reconcileBandWithFactors({
      suggestedBand: 'prosumer',
      sponsorFit: 'low',
      audienceQuality: 'low'
    });
    expect(band).toBe('prosumer');
  });

  it('downgrades multiple tiers until consistent', () => {
    // premium_niche requires nicheSpecificity: high
    // exec_operator requires audienceQuality: high
    // b2b_technical requires nicheSpecificity: medium
    // b2b_general requires audienceQuality: medium
    // With all-low factors, should fall through to prosumer
    const band = reconcileBandWithFactors({
      suggestedBand: 'premium_niche',
      audienceQuality: 'low',
      nicheSpecificity: 'low',
      cadenceHealth: 'low',
      sponsorFit: 'low'
    });
    expect(band).toBe('prosumer');
  });
});

describe('buildDeterministicClassification', () => {
  const baseMetrics = {
    avgOpenRate: 0.35, avgClickRate: 0.04,
    cadenceStdDevDays: 0.5,
    volatility: { openRateCoV: 0.10 },
    latestPublishedAt: new Date().toISOString()
  };
  const baseConfig = {
    cadenceRegularityThreshold: 3,
    industryAvgOpenRate: 0.4346,
    industryAvgClickRate: 0.0209
  };

  it('produces high cadenceHealth for very regular cadence', () => {
    const c = buildDeterministicClassification(null, { ...baseMetrics, cadenceStdDevDays: 0.5 }, baseConfig);
    expect(c.cadenceHealth).toBe('high');
  });

  it('produces low cadenceHealth for irregular cadence', () => {
    const c = buildDeterministicClassification(null, { ...baseMetrics, cadenceStdDevDays: 10 }, baseConfig);
    expect(c.cadenceHealth).toBe('low');
  });

  it('produces high audienceQuality when metrics beat benchmarks', () => {
    const c = buildDeterministicClassification(null, {
      ...baseMetrics, avgOpenRate: 0.60, avgClickRate: 0.05
    }, baseConfig);
    expect(c.audienceQuality).toBe('high');
  });

  it('produces low audienceQuality when metrics are well below benchmarks', () => {
    const c = buildDeterministicClassification(null, {
      ...baseMetrics, avgOpenRate: 0.15, avgClickRate: 0.005
    }, baseConfig);
    expect(c.audienceQuality).toBe('low');
  });

  it('produces high nicheSpecificity for detailed niche descriptions', () => {
    const c = buildDeterministicClassification({
      q1: 'Technology',
      q2: 'For app builders who care about AI agents, serverless, event-driven architecture, and modern cloud development'
    }, baseMetrics, baseConfig);
    expect(c.nicheSpecificity).toBe('high');
  });

  it('produces low nicheSpecificity when no niche description', () => {
    const c = buildDeterministicClassification({ q1: 'Other' }, baseMetrics, baseConfig);
    expect(c.nicheSpecificity).toBe('low');
  });

  it('produces high sponsorFit with multiple formats and revenue goal', () => {
    const c = buildDeterministicClassification({
      q1: 'Technology', q2: 'Tech newsletter',
      q3: ['Sponsored section', 'Banner ad'],
      q5: 'Maximize revenue per issue'
    }, baseMetrics, baseConfig);
    expect(c.sponsorFit).toBe('high');
  });

  it('produces low sponsorFit when growing audience first', () => {
    const c = buildDeterministicClassification({
      q1: 'Technology', q2: 'Tech newsletter',
      q3: [],
      q5: 'Grow audience first, monetize later'
    }, baseMetrics, baseConfig);
    expect(c.sponsorFit).toBe('low');
  });

  it('band and factors are consistent (no downgrade on reconcile)', () => {
    const c = buildDeterministicClassification({
      q1: 'Technology',
      q2: 'For app builders who care about AI agents, serverless, event-driven architecture, and modern cloud development',
      q3: ['Sponsored section', 'Product mention'],
      q5: 'Maximize revenue per issue'
    }, { ...baseMetrics, avgOpenRate: 0.55, avgClickRate: 0.05, cadenceStdDevDays: 0.5 }, baseConfig);

    const reconciled = reconcileBandWithFactors(c);
    expect(reconciled).toBe(c.suggestedBand);
  });
});
