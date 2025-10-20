import frontmatter from '@github-docs/frontmatter';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const bedrock = new BedrockRuntimeClient();
const ddb = new DynamoDBClient();
const MAX_ATTEMPTS = 3;

export const handler = async (state) => {
  try {
    const { content, tenant } = state;
    const newsletter = frontmatter(content);
    const issueId = newsletter.data.slug.substring(1).toLowerCase();

    let options = [];
    for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
      const response = await bedrock.send(new ConverseCommand({
        modelId: process.env.MODEL_ID,
        system: [{ text: 'You are a seasoned content editor in tune with your tech audience. You know what engages them and how to pull the most exciting content for maximum reach' }],
        messages: [
          {
            role: 'user',
            content: [{
              text: `Choose the top 4 most exciting articles based on the newsletter content below. You are tasked with coming up with the options for a vote for "best content". Select a 3-5 word friendly description for each one. Don't select the superhero as an option and make the descriptions unambiguous and feel like a complete thought. Use the 'format_vote' tool to generate the options you decide.
---
EXAMPLES
DSQL vs. Aurora
Emulating the cloud locally
AI Agents failing tasks

---
CONTENT
${content}`
            }]
          }
        ],
        toolConfig: {
          toolChoice: { tool: { name: 'format_vote' } },
          tools: [
            {
              toolSpec: {
                name: 'format_vote',
                description: 'Format the vote options for the newsletter',
                inputSchema: {
                  json: {
                    type: 'object',
                    properties: {
                      options: {
                        type: 'array',
                        minItems: 4,
                        maxItems: 4,
                        items: {
                          type: 'object',
                          properties: {
                            description: {
                              type: 'string',
                              description: 'A 3-5 word friendly description of the article'
                            }
                          },
                          required: ['description']
                        }
                      }
                    },
                    required: ['options']
                  }
                }
              }
            }
          ]
        }
      }));

      const contentBlock = response.output.message?.content?.find(c => c.toolUse);
      if (!contentBlock) continue;

      options = getFormattedOptions(issueId, contentBlock.toolUse.input.options);
      break;
    }
    if (!options?.length) {
      throw new Error('Could not generate voting options');
    }

    const voteItem = {
      pk: `${tenant.id}#${issueId}`,
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
