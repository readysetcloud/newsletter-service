import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient();

export const handler = async (state) => {
  try {
    // Validate required inputs
    if (!state.subscribers || !state.priorSubscribers || !state.stats) {
      throw new Error('Missing required state data');
    }

    const subscribers = Number(state.subscribers);
    const priorSubscribers = Number(state.priorSubscribers);

    // Prevent division by zero
    const safeGrowthRate = priorSubscribers > 0
      ? (((subscribers - priorSubscribers) / priorSubscribers) * 100).toFixed(2)
      : subscribers > 0 ? '100.00' : '0.00';

    // Calculate rates with safety checks
    const openRate = state.stats.delivered > 0
      ? ((state.stats.unique_opens / state.stats.delivered) * 100).toFixed(2)
      : '0.00';

    const clickThroughRate = state.stats.delivered > 0
      ? ((state.stats.clicks / state.stats.delivered) * 100).toFixed(2)
      : '0.00';

    const bounceRate = state.stats.delivered > 0
      ? ((state.stats.bounces / state.stats.delivered) * 100).toFixed(2)
      : '0.00';

    const name = state.issue ? state.issue.split('_')[1]?.split('.')[0]?.replace('-', ' ') || 'Unknown' : 'Unknown';

    // Process poll data with error handling
    let pollResults = [];
    let totalVotes = 0;
    let pollEngagementRate = '0.00';

    if (state.voteResults) {
      const pollData = unmarshall(state.voteResults);
      totalVotes = pollData.options.reduce((sum, option) => sum + (pollData[option.id] || 0), 0);

      pollResults = pollData.options.map(option => ({
        description: option.description || 'Unknown Option',
        votes: pollData[option.id] || 0,
        percentage: totalVotes > 0 ? ((pollData[option.id] || 0) / totalVotes * 100).toFixed(1) : '0.0'
      })).sort((a, b) => b.votes - a.votes);

      // Calculate poll engagement rate (votes / opens)
      pollEngagementRate = state.stats.unique_opens > 0
        ? (totalVotes / state.stats.unique_opens * 100).toFixed(2)
        : '0.00';
    }

    // Handle links with safety
    const links = state.links && Array.isArray(state.links) ? state.links : [];
    const topPerformingLink = links.length > 0
      ? links.reduce((prev, current) => ((prev.count || 0) > (current.count || 0)) ? prev : current, {count: 0})
      : { link: 'N/A', count: 0 };

    // Prepare comprehensive data for LLM insights
    const insightData = {
      // Current metrics
      currentMetrics: {
        openRate: parseFloat(openRate),
        clickThroughRate: parseFloat(clickThroughRate),
        bounceRate: parseFloat(bounceRate),
        growthRate: parseFloat(safeGrowthRate),
        subscribers: subscribers,
        totalVotes: totalVotes,
        delivered: state.stats.delivered || 0,
        uniqueOpens: state.stats.unique_opens || 0,
        clicks: state.stats.clicks || 0,
        bounces: state.stats.bounces || 0,
        unsubscribes: state.stats.unsubscribes || 0
      },

      // Content analysis
      content: {
        subjectLine: state.subjectLine || 'N/A',
        linkCount: links.length,
        topPerformingLink: topPerformingLink,
        pollEngagement: pollEngagementRate,
        pollResults: pollResults
      },

      // Engagement patterns
      engagement: {
        openToClickRatio: parseFloat(openRate) > 0 ? (parseFloat(clickThroughRate) / parseFloat(openRate) * 100).toFixed(2) : '0.00',
        subscriberEngagement: subscribers > 0 ? (((state.stats.unique_opens || 0) + (state.stats.clicks || 0)) / subscribers * 100).toFixed(2) : '0.00',
        pollParticipationRate: pollEngagementRate,
        newSubscribers: Math.max(0, subscribers - priorSubscribers + (state.stats.unsubscribes || 0)),
        netGrowth: subscribers - priorSubscribers
      },

      // Performance indicators
      performance: {
        isOpenRateAboveBenchmark: parseFloat(openRate) > 21.33,
        isCTRAboveBenchmark: parseFloat(clickThroughRate) > 2.62,
        isBounceRateBelowBenchmark: parseFloat(bounceRate) < 0.63,
        isGrowthPositive: parseFloat(safeGrowthRate) > 0,
        hasHighPollEngagement: parseFloat(pollEngagementRate) > 10 // 10% of opens participated
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
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; max-width: 600px;">

          <!-- Header -->
          <tr>
            <td style="background-color: #4a90e2; color: #ffffff; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: bold;">📊 Newsletter ${name} Performance</h1>
              <p style="margin: 10px 0 0 0; font-size: 16px; color: #e6f2ff;">Your weekly analytics summary</p>
            </td>
          </tr>

          <!-- Insights Box -->
          <tr>
            <td style="padding: 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #4CAF50; border-radius: 8px;">
                <tr>
                  <td style="padding: 20px; color: #ffffff;">
                    <h2 style="margin: 0 0 15px 0; font-size: 20px; font-weight: bold;">🔍 Insights</h2>
                    <div style="background-color: rgba(255,255,255,0.2); padding: 15px; border-radius: 6px; border-left: 4px solid rgba(255,255,255,0.5);">
                      <p style="margin: 0; font-style: italic; line-height: 1.5;">
                        {{LLM_INSIGHTS}}
                      </p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Key Metrics -->
          <tr>
            <td style="padding: 0 20px 20px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding: 15px; background-color: #f8f9fa; border: 1px solid #e9ecef; text-align: center; width: 25%;">
                    <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">Open Rate</div>
                    <div style="font-size: 24px; font-weight: bold; color: #333;">${openRate}%</div>
                  </td>
                  <td style="padding: 15px; background-color: #f8f9fa; border: 1px solid #e9ecef; text-align: center; width: 25%;">
                    <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">Click Rate</div>
                    <div style="font-size: 24px; font-weight: bold; color: #333;">${clickThroughRate}%</div>
                  </td>
                  <td style="padding: 15px; background-color: #f8f9fa; border: 1px solid #e9ecef; text-align: center; width: 25%;">
                    <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">Bounce Rate</div>
                    <div style="font-size: 24px; font-weight: bold; color: #333;">${bounceRate}%</div>
                  </td>
                  <td style="padding: 15px; background-color: #f8f9fa; border: 1px solid #e9ecef; text-align: center; width: 25%;">
                    <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">Growth Rate</div>
                    <div style="font-size: 24px; font-weight: bold; color: ${parseFloat(safeGrowthRate) >= 0 ? '#28a745' : '#dc3545'};">${safeGrowthRate}%</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Subscriber Growth -->
          <tr>
            <td style="padding: 0 20px 20px 20px;">
              <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #333; border-bottom: 2px solid #e9ecef; padding-bottom: 8px;">📈 Subscriber Growth</h3>
              <table width="100%" cellpadding="8" cellspacing="0" border="0" style="border: 1px solid #ddd;">
                <tr style="background-color: #f2f2f2;">
                  <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">Current</th>
                  <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">Last Week</th>
                  <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">New</th>
                  <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">Unsubscribed</th>
                  <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">Net Change</th>
                </tr>
                <tr>
                  <td style="border: 1px solid #ddd; padding: 12px; font-weight: bold;">${subscribers.toLocaleString()}</td>
                  <td style="border: 1px solid #ddd; padding: 12px;">${priorSubscribers.toLocaleString()}</td>
                  <td style="border: 1px solid #ddd; padding: 12px;">${insightData.engagement.newSubscribers.toLocaleString()}</td>
                  <td style="border: 1px solid #ddd; padding: 12px;">${state.stats.unsubscribes || 0}</td>
                  <td style="border: 1px solid #ddd; padding: 12px; color: ${subscribers - priorSubscribers >= 0 ? '#28a745' : '#dc3545'}; font-weight: bold;">
                    ${subscribers - priorSubscribers >= 0 ? '+' : ''}${(subscribers - priorSubscribers).toLocaleString()}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${pollResults.length > 0 ? `
          <!-- Poll Results -->
          <tr>
            <td style="padding: 0 20px 20px 20px;">
              <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #333; border-bottom: 2px solid #e9ecef; padding-bottom: 8px;">📊 Reader Poll Results</h3>
              <div style="background-color: #f8f9fa; padding: 20px; border: 1px solid #e9ecef; border-radius: 8px;">
                <p style="margin: 0 0 15px 0; font-weight: bold;">Total Votes: ${totalVotes.toLocaleString()} (${pollEngagementRate}% of opens)</p>
                ${pollResults.map(result => `
                  <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #ddd;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-weight: bold; color: #333; padding-bottom: 5px;">${result.description}</td>
                        <td style="text-align: right; padding-bottom: 5px;">
                          <span style="font-size: 18px; font-weight: bold; color: #333;">${result.votes}</span>
                          <span style="font-size: 14px; color: #666; margin-left: 5px;">(${result.percentage}%)</span>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top: 5px;">
                          <div style="width: 100%; height: 8px; background-color: #e9ecef; border-radius: 4px; overflow: hidden;">
                            <div style="width: ${result.percentage}%; height: 100%; background-color: #4a90e2; border-radius: 4px;"></div>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </div>
                `).join('')}
              </div>
            </td>
          </tr>
          ` : ''}

          ${links.length > 0 ? `
          <!-- Link Performance -->
          <tr>
            <td style="padding: 0 20px 20px 20px;">
              <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #333; border-bottom: 2px solid #e9ecef; padding-bottom: 8px;">🔗 Link Performance</h3>
              <table width="100%" cellpadding="8" cellspacing="0" border="0" style="border: 1px solid #ddd;">
                <tr style="background-color: #f2f2f2;">
                  <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">Link</th>
                  <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">Clicks</th>
                </tr>
                ${links.map(l => `
                  <tr>
                    <td style="border: 1px solid #ddd; padding: 12px;">${l.link || 'N/A'}</td>
                    <td style="border: 1px solid #ddd; padding: 12px; font-weight: bold;">${l.count || 0}</td>
                  </tr>
                `).join('')}
              </table>
            </td>
          </tr>
          ` : ''}

          <!-- Raw Metrics -->
          <tr>
            <td style="padding: 0 20px 20px 20px;">
              <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #333; border-bottom: 2px solid #e9ecef; padding-bottom: 8px;">📋 Raw Metrics</h3>
              <table width="100%" cellpadding="8" cellspacing="0" border="0" style="border: 1px solid #ddd;">
                <tr style="background-color: #f2f2f2;">
                  <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">Delivered</th>
                  <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">Opens</th>
                  <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">Bounces</th>
                  <th style="border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold;">Clicks</th>
                </tr>
                <tr>
                  <td style="border: 1px solid #ddd; padding: 12px;">${(state.stats.delivered || 0).toLocaleString()}</td>
                  <td style="border: 1px solid #ddd; padding: 12px;">${(state.stats.unique_opens || 0).toLocaleString()}</td>
                  <td style="border: 1px solid #ddd; padding: 12px;">${state.stats.bounces || 0}</td>
                  <td style="border: 1px solid #ddd; padding: 12px;">${state.stats.clicks || 0}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 20px; text-align: center;">
              <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
                <tr>
                  <td style="background-color: #4a90e2; border-radius: 6px; padding: 12px 24px;">
                    <a href="https://mc.sendgrid.com/single-sends/${state.singleSendId || ''}/stats" style="color: #ffffff; text-decoration: none; font-weight: bold; font-size: 16px; display: block;">
                      📊 View Full Analytics in SendGrid
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px; text-align: center; border-top: 1px solid #e9ecef; color: #666; font-size: 14px;">
              <p style="margin: 0;">Generated on ${new Date().toLocaleDateString()} • Ready, Set, Cloud Newsletter Analytics</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

    return {
      subject: `📊 Newsletter ${name} Performance Report`,
      html: emailTemplate,
      insightData: insightData,
      issue: state.issue
    };

  } catch (error) {
    console.error('Error processing newsletter stats:', error);

    return {
      subject: `❌ Newsletter Analytics Error`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #dc3545;">Newsletter Analytics Error</h2>
            <p>There was an error processing the newsletter statistics:</p>
            <p style="color: #666; font-family: monospace;">${error.message}</p>
            <p>Please check the input data and try again.</p>
          </body>
        </html>
      `,
      insightData: null,
      error: error.message,
      issue: state.issue
    };
  }
};
