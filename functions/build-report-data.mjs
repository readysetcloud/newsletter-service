import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient();
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const pct = (num, den) => den > 0 ? Number(((n(num) / n(den)) * 100).toFixed(2)) : 0;

export const handler = async (state) => {
  try {
    if (!state.subscribers || !state.priorSubscribers || !state.stats) {
      throw new Error('Missing required state data');
    }

    const subscribers = n(state.subscribers);
    const priorSubscribers = n(state.priorSubscribers);

    const safeGrowthRate = priorSubscribers > 0
      ? Number((((subscribers - priorSubscribers) / priorSubscribers) * 100).toFixed(2))
      : (subscribers > 0 ? 100 : 0);

    const stats = unmarshall(state.stats);

    const deliveries = n(stats.deliveries);
    const uniqueOpens = n(stats.opens);
    const bounces = n(stats.bounces);
    const unsubscribes = n(stats.unsubscribes);
    const sends = n(stats.sends);
    const cleaned = n(stats.cleaned);

    const links = Array.isArray(state.links) ? state.links : [];
    const totalClicks = links.reduce((sum, l) => sum + n(l.count), 0);

    const openRate = pct(uniqueOpens, deliveries);
    const clickThroughRate = pct(totalClicks, deliveries);
    const clickToOpenRate = pct(totalClicks, uniqueOpens);
    const bounceRate = pct(bounces, deliveries);

    const name = state.issue
      ? (state.issue.split('_')[1]?.split('.')[0]?.replace('-', ' ') || 'Unknown')
      : 'Unknown';

    const topPerformingLink = links.length
      ? links.reduce((prev, cur) => n(prev.count) > n(cur.count) ? prev : cur)
      : { link: 'N/A', count: 0 };

    const netGrowth = subscribers - priorSubscribers;
    const newSubscribers = Math.max(0, netGrowth + unsubscribes + cleaned);
    const openToClickRatio = openRate > 0 ? Number(((clickThroughRate / openRate) * 100).toFixed(2)) : 0;

    const insightData = {
      currentMetrics: {
        openRate,
        clickThroughRate,
        clickToOpenRate,
        bounceRate,
        growthRate: safeGrowthRate,
        subscribers,
        delivered: deliveries,
        uniqueOpens,
        clicks: totalClicks,
        bounces,
        unsubscribes,
        cleaned,
        sends
      },
      content: {
        subjectLine: state.subjectLine || 'N/A',
        linkCount: links.length,
        topPerformingLink
      },
      engagement: {
        openToClickRatio,
        subscriberEngagement: subscribers > 0
          ? Number((((uniqueOpens + totalClicks) / subscribers) * 100).toFixed(2))
          : 0,
        newSubscribers,
        netGrowth
      },
      performance: {
        isOpenRateAboveBenchmark: openRate > 21.33,
        isCTRAboveBenchmark: clickThroughRate > 2.62,
        isBounceRateBelowBenchmark: bounceRate < 0.63,
        isGrowthPositive: safeGrowthRate > 0
      }
    };

    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: state.issue,
        sk: 'analytics',
        GSI1PK: `${state.issue.split('#')[0]}#analytics`,
        GSI1SK: new Date().toISOString(),
        ...insightData
      })
    }));

    const emailTemplate = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;">
    <tr><td align="center" style="padding:20px 0;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;max-width:600px;">

        <tr>
          <td style="background-color:#4a90e2;color:#ffffff;padding:30px 20px;text-align:center;">
            <h1 style="margin:0;font-size:24px;font-weight:bold;">📊 Newsletter Issue ${name} Performance</h1>
            <p style="margin:10px 0 0 0;font-size:16px;color:#e6f2ff;">Issue analytics summary</p>
            <p>{{LLM_INSIGHTS}}</p>
          </td>
        </tr>

        <tr>
          <td style="padding:0 20px 20px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:15px;background-color:#f8f9fa;border:1px solid #e9ecef;text-align:center;width:25%;">
                  <div style="font-size:12px;color:#666;letter-spacing:1px;margin-bottom:5px;">Open Rate</div>
                  <div style="font-size:24px;font-weight:bold;color:#333;">${openRate.toFixed(2)}%</div>
                </td>
                <td style="padding:15px;background-color:#f8f9fa;border:1px solid #e9ecef;text-align:center;width:25%;">
                  <div style="font-size:12px;color:#666;letter-spacing:1px;margin-bottom:5px;">Click Rate (CTR)</div>
                  <div style="font-size:24px;font-weight:bold;color:#333;">${clickThroughRate.toFixed(2)}%</div>
                </td>
                <td style="padding:15px;background-color:#f8f9fa;border:1px solid #e9ecef;text-align:center;width:25%;">
                  <div style="font-size:12px;color:#666;letter-spacing:1px;margin-bottom:5px;">Click-to-Open (CTOR)</div>
                  <div style="font-size:24px;font-weight:bold;color:#333;">${clickToOpenRate.toFixed(2)}%</div>
                </td>
                <td style="padding:15px;background-color:#f8f9fa;border:1px solid #e9ecef;text-align:center;width:25%;">
                  <div style="font-size:12px;color:#666;letter-spacing:1px;margin-bottom:5px;">Growth Rate</div>
                  <div style="font-size:24px;font-weight:bold;color:${safeGrowthRate >= 0 ? '#28a745' : '#dc3545'};">
                    ${safeGrowthRate.toFixed(2)}%
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:0 20px 20px 20px;">
            <h3 style="margin:0 0 15px 0;font-size:18px;color:#333;border-bottom:2px solid #e9ecef;padding-bottom:8px;">📈 Subscriber Growth</h3>
            <table width="100%" cellpadding="8" cellspacing="0" border="0" style="border:1px solid #ddd;">
              <tr style="background-color:#f2f2f2;">
                <th style="border:1px solid #ddd;padding:12px;text-align:left;">Current</th>
                <th style="border:1px solid #ddd;padding:12px;text-align:left;">Last Week</th>
                <th style="border:1px solid #ddd;padding:12px;text-align:left;">New (est.)</th>
                <th style="border:1px solid #ddd;padding:12px;text-align:left;">Unsubscribed</th>
                <th style="border:1px solid #ddd;padding:12px;text-align:left;">Cleaned</th>
                <th style="border:1px solid #ddd;padding:12px;text-align:left;">Net Change</th>
              </tr>
              <tr>
                <td style="border:1px solid #ddd;padding:12px;font-weight:bold;">${subscribers.toLocaleString()}</td>
                <td style="border:1px solid #ddd;padding:12px;">${priorSubscribers.toLocaleString()}</td>
                <td style="border:1px solid #ddd;padding:12px;">${newSubscribers.toLocaleString()}</td>
                <td style="border:1px solid #ddd;padding:12px;">${unsubscribes}</td>
                <td style="border:1px solid #ddd;padding:12px;">${cleaned}</td>
                <td style="border:1px solid #ddd;padding:12px;color:${netGrowth >= 0 ? '#28a745' : '#dc3545'};font-weight:bold;">
                  ${netGrowth >= 0 ? '+' : ''}${netGrowth.toLocaleString()}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${links.length ? `
        <tr>
          <td style="padding:0 20px 20px 20px;">
            <h3 style="margin:0 0 15px 0;font-size:18px;color:#333;border-bottom:2px solid #e9ecef;padding-bottom:8px;">🔗 Link Performance</h3>
            <table width="100%" cellpadding="8" cellspacing="0" border="0" style="border:1px solid #ddd;">
              <tr style="background-color:#f2f2f2;">
                <th style="border:1px solid #ddd;padding:12px;text-align:left;">Link</th>
                <th style="border:1px solid #ddd;padding:12px;text-align:left;">Clicks</th>
              </tr>
              ${links.map(l => `
                <tr>
                  <td style="border:1px solid #ddd;padding:12px;">${l.link || 'N/A'}</td>
                  <td style="border:1px solid #ddd;padding:12px;font-weight:bold;">${n(l.count)}</td>
                </tr>`).join('')}
            </table>
          </td>
        </tr>` : ''}

        <tr>
          <td style="padding:0 20px 20px 20px;">
            <h3 style="margin:0 0 15px 0;font-size:18px;color:#333;border-bottom:2px solid #e9ecef;padding-bottom:8px;">📋 Raw Metrics</h3>
            <table width="100%" cellpadding="8" cellspacing="0" border="0" style="border:1px solid #ddd;">
              <tr style="background-color:#f2f2f2;">
                <th style="border:1px solid #ddd;padding:12px;text-align:left;">Delivered</th>
                <th style="border:1px solid #ddd;padding:12px;text-align:left;">Opens</th>
                <th style="border:1px solid #ddd;padding:12px;text-align:left;">Bounces</th>
                <th style="border:1px solid #ddd;padding:12px;text-align:left;">Clicks</th>
              </tr>
              <tr>
                <td style="border:1px solid #ddd;padding:12px;">${deliveries.toLocaleString()}</td>
                <td style="border:1px solid #ddd;padding:12px;">${uniqueOpens.toLocaleString()}</td>
                <td style="border:1px solid #ddd;padding:12px;">${bounces}</td>
                <td style="border:1px solid #ddd;padding:12px;">${totalClicks}</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr><td style="padding:20px;text-align:center;border-top:1px solid #e9ecef;color:#666;font-size:14px;">
          <p style="margin:0;">Generated on ${new Date().toLocaleDateString()} • Ready, Set, Cloud Newsletter Analytics</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    return {
      subject: `📊 Newsletter Issue ${name} Performance Report`,
      html: emailTemplate,
      insightData,
      issue: state.issue
    };
  } catch (error) {
    console.error('Error processing newsletter stats:', error);
    return {
      subject: `❌ Newsletter Analytics Error`,
      html: `<html><body style="font-family:Arial,sans-serif;padding:20px;">
        <h2 style="color:#dc3545;">Newsletter Analytics Error</h2>
        <p>There was an error processing the newsletter statistics:</p>
        <p style="color:#666;font-family:monospace;">${error.message}</p>
        <p>Please check the input data and try again.</p>
      </body></html>`,
      insightData: null,
      error: error.message,
      issue: state.issue
    };
  }
};
