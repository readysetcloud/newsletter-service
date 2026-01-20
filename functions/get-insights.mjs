import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient();
const bedrock = new BedrockRuntimeClient();

export const handler = async (state) => {
  const { report, insightData, issue } = state;

  const historicalData = await getHistoricalData(issue);

  const prompt = `Analyze this newsletter performance data and provide 2-3 actionable insights. Focus on:
1. Performance vs benchmarks (industry averages: 21.33% open rate, 2.62% CTR, 0.63% bounce rate)
2. Growth trends and subscriber engagement patterns
3. Poll results and what they reveal about audience preferences
4. Specific recommendations for improvement

---
INSIGHT DATA

${JSON.stringify(insightData, null, 2)})}
${historicalData?.length ? `---
  HISTORICAL DATA
  ${JSON.stringify(historicalData, null, 2)}` : ''}

Keep insights concise and actionable. This will be inserted into an html div directly, so only answer with your thought and no extra verbiage.`;

  const response = await bedrock.send(new ConverseCommand({
    modelId: process.env.MODEL_ID,
    system: [{ text: 'You are an expert analyst specializing in brand growth. You take your expertise with current and past data and can find insights that optimize growth and conversions' }],
    messages: [
      {
        role: 'user',
        content: [{ text: prompt }]
      }
    ]
  }
  ));

  const insights = response.output.message.content[0].text;
  const updatedReport = report.replace('{{LLM_INSIGHTS}}', insights);
  return { html: updatedReport };
};

const getHistoricalData = async (issue) => {
  const queryCommand = new QueryCommand({
    TableName: process.env.TABLE_NAME,
    IndexName: 'GSI1',
    KeyConditionExpression: '#pk = :pk',
    ExpressionAttributeNames: {
      '#pk': 'GSI1PK'
    },
    ExpressionAttributeValues: {
      ':pk': { S: `${issue.split('#')[0]}#analytics` }
    },
    ScanIndexForward: false,
    Limit: 5
  });

  const queryResults = await ddb.send(queryCommand);

  const historicalData = queryResults.Items?.filter(item => item.pk.S !== issue).map(item => {
    const data = unmarshall(item);
    data.deliveredDate = data.GSI1SK;
    delete data.sk;
    delete data.GSI1PK;
    delete data.GSI1SK;
  });
  return historicalData;
};
