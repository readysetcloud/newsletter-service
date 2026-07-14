import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { Agent, BedrockModel } from '@strands-agents/sdk';
import { z } from 'zod';

const ddb = new DynamoDBClient();
const MAX_ATTEMPTS = 3;

const votingOptionsSchema = z.object({
  options: z.array(z.object({
    description: z.string().describe('A 3-5 word friendly description of the article')
  })).length(4)
});

const systemPrompt = 'You are a seasoned content editor in tune with your tech audience. You know what engages them and how to pull the most exciting content for maximum reach.';

const buildUserPrompt = (content) => `Choose the top 4 most exciting articles based on the newsletter content below. You are tasked with coming up with the options for a vote for "best content". Select a 3-5 word friendly description for each one. Don't select the superhero as an option and make the descriptions unambiguous and feel like a complete thought.
---
EXAMPLES
DSQL vs. Aurora
Emulating the cloud locally
AI Agents failing tasks

---
CONTENT
${content}`;

export const handler = async (state) => {
  try {
    const { content, tenant, issueId } = state;
    const normalizedIssueId = String(issueId || '').trim().toLowerCase();
    if (!normalizedIssueId) {
      throw new Error('Missing issueId');
    }

    const options = await generateVotingOptions(content, normalizedIssueId);
    if (!options?.length) {
      throw new Error('Could not generate voting options');
    }

    const voteItem = {
      pk: `${tenant.id}#${normalizedIssueId}`,
      sk: 'votes',
      options
    };

    options.forEach(option => {
      voteItem[option.id] = 0;
    });

    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall(voteItem)
    }));

    return options;
  } catch (err) {
    console.error(err);
    return [];
  }
};

async function generateVotingOptions(content, issueId) {
  for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
    try {
      const agent = new Agent({
        model: new BedrockModel({
          modelId: process.env.MODEL_ID,
          maxTokens: 800,
          temperature: 0.3,
          stream: false
        }),
        systemPrompt,
        structuredOutputSchema: votingOptionsSchema,
        printer: false
      });

      const result = await agent.invoke(buildUserPrompt(content), {
        structuredOutputSchema: votingOptionsSchema,
        limits: {
          turns: 1,
          totalTokens: 5000
        },
        cancelSignal: AbortSignal.timeout(10000)
      });

      const options = result.structuredOutput?.options;
      if (options?.length === 4) {
        return getFormattedOptions(issueId, options);
      }
    } catch (err) {
      console.warn('Failed to generate voting options', {
        attempt: attempts + 1,
        error: err.message
      });
    }
  }

  return [];
}

const getFormattedOptions = (issueId, options) => {
  const newOptions = options.map((option, index) => {
    const { description } = option;
    return {
      id: `${issueId}-${index}`,
      description
    };
  });

  return newOptions;
};
