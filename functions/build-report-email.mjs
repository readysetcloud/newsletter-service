export const handler = async (state) => {
  const subscribers = Number(state.subscribers);
  const priorSubscribers = Number(state.priorSubscribers);

  const openRate = ((state.stats.unique_opens / state.stats.delivered) * 100).toFixed(2);
  const clickThroughRate = ((state.stats.clicks / state.stats.delivered) * 100).toFixed(2);
  const bounceRate = ((state.stats.bounces / state.stats.delivered) * 100).toFixed(2);
  const growthRate = (((subscribers - priorSubscribers) / priorSubscribers) * 100).toFixed(2);

  const name = state.issue.split('_')[1].split('.')[0].replace('-', ' ');

  const emailTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #ddd; text-align: left; padding: 8px; }
    th { background-color: #f2f2f2; }
    .diff { color: #007700; }
</style>
</head>
<body>
<div>
    <h2>Serverless Picks of the Week ${name} Performance</h2>

    <table>
        <tr>
            <th>Delivered</th>
            <th>Opens</th>
            <th>Bounces</th>
            <th>Clicks</th>
        </tr>
        <tr>
            <td>${state.stats.delivered}</td>
            <td>${state.stats.unique_opens}</td>
            <td>${state.stats.bounces}</td>
            <td>${state.stats.clicks}</td>
        </tr>
    </table>

    <table>
        <tr>
            <th>Open Rate</th>
            <th>Click-Through Rate (CTR)</th>
            <th>Bounce Rate</th>
            <th>Growth Rate</th>
        </tr>
        <tr>
            <td>${openRate}%</td>
            <td>${clickThroughRate}%</td>
            <td>${bounceRate}%</td>
            <td>${growthRate}%</td>
        </tr>
    </table>

    <table>
      <tr>
        <th>Current Subscribers</th>
        <th>Last Week's Subscribers</th>
        <th>New This Week</th>
        <th>Unsubscribed This Week</th>
        <th>Difference</th>
      </tr>
      <tr>
        <td>${subscribers}</td>
        <td>${priorSubscribers}</td>
        <td>${subscribers - priorSubscribers + state.stats.unsubscribes}</td>
        <td>${state.stats.unsubscribes}</td>
        <td>${subscribers - priorSubscribers}</td>
      </tr>
    </table>

    <div style="margin-top: 1em">
      <h3>Link Performance</h3>
      <ol>
        ${state.links.map(l => { return `<li>${l.link} - ${l.count ?? 0} Clicks</li>`; })}
      </ol>
    </div>

    <a href="https://mc.sendgrid.com/single-sends/${state.singleSendId}/stats">View full analytics in SendGrid</a>
</div>
</body>
</html>
`;

  return {
    subject: `Newsletter ${name} Performance`,
    content: emailTemplate
  };
};
