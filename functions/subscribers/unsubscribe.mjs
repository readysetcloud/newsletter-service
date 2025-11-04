import { SESv2Client, DeleteContactCommand } from "@aws-sdk/client-sesv2";
import { DynamoDBClient, UpdateItemCommand, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { getTenant, decrypt } from "../utils/helpers.mjs";
import { publishSubscriberEvent, EVENT_TYPES } from "../utils/event-publisher.mjs";

const ses = new SESv2Client();
const ddb = new DynamoDBClient();

export const handler = async (event) => {
  let emailAddress = null;
  let tenantId = null;
  let success = false;

  try {
    tenantId = event.pathParameters.tenant;

    if (!tenantId) {
      throw new Error('Missing tenant parameter');
    }

    const tenant = await getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    const email = event.queryStringParameters?.email;
    if (!email) {
      throw new Error('Missing email parameter');
    }

    try {
      emailAddress = decrypt(email);
    } catch (decryptErr) {
      console.error('Email decryption failed:', {
        error: decryptErr.message,
        tenantId,
        emailParamLength: email ? email.length : 0,
        emailParamFormat: email ? email.includes(':') : false
      });
      throw new Error('Invalid or expired unsubscribe link');
    }

    // Store recent unsubscribe FIRST to prevent immediate re-sending
    await storeRecentUnsubscribe(tenantId, emailAddress);

    // Try to remove from SES contact list (may fail if already removed)
    let sesRemovalSuccess = false;
    try {
      await ses.send(new DeleteContactCommand({
        ContactListName: tenant.list,
        EmailAddress: emailAddress
      }));
      sesRemovalSuccess = true;
    } catch (sesError) {
      if (sesError.name === 'NotFoundException') {
        console.log(`Email ${emailAddress} was already removed from SES list ${tenant.list}`);
        sesRemovalSuccess = true; // Treat as success since email is already gone
      } else {
        console.error('SES removal failed:', sesError);
        // Don't throw - we still want to protect against future sends
      }
    }

    // Update subscriber count only if SES removal was successful or email was already gone
    if (sesRemovalSuccess) {
      try {
        await updateSubscriberCount(tenantId);
      } catch (countError) {
        console.error('Failed to update subscriber count:', countError);
        // Don't throw - the main goal (preventing future emails) is achieved
      }
    }

    // Publish subscriber removed event (we've at least protected against future sends)
    try {
      await publishSubscriberEvent(
        tenantId,
        null, // No specific user ID for public unsubscribes
        EVENT_TYPES.SUBSCRIBER_REMOVED,
        {
          email: emailAddress,
          subscriberCount: Math.max(0, tenant.subscribers - 1), // New count after removal
          removedAt: new Date().toISOString(),
          reason: 'unsubscribe',
          sesRemovalSuccess
        }
      );
    } catch (eventError) {
      console.error('Failed to publish subscriber event:', eventError);
      // Don't throw - the main unsubscribe protection is in place
    }

    success = true; // Success means we've protected against future emails

    console.log('Unsubscribe completed:', {
      tenantId,
      emailAddress,
      sesRemovalSuccess,
      recentUnsubscribeStored: true
    });
  } catch (err) {
    console.error('Unsubscribe error:', {
      error: err.message,
      tenantId,
      emailAddress: emailAddress ? '[REDACTED]' : null,
      stack: err.stack
    });
    errorMessage = err.message;
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html'
    },
    body: success ? await getSuccessPage(tenantId) : await getErrorPage(tenantId)
  };
};

const updateSubscriberCount = async (tenantId) => {
  await ddb.send(new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: tenantId,
      sk: 'tenant'
    }),
    UpdateExpression: 'SET #subscribers = #subscribers + :val',
    ExpressionAttributeNames: {
      '#subscribers': 'subscribers'
    },
    ExpressionAttributeValues: {
      ':val': { N: '-1' }
    }
  }));
};

/**
 * Store recent unsubscribe to prevent immediate re-sending due to SES propagation delays
 * @param {string} tenantId - Tenant identifier
 * @param {string} emailAddress - Email address that unsubscribed
 */
const storeRecentUnsubscribe = async (tenantId, emailAddress) => {
  try {
    const now = new Date();
    const ttl = Math.floor((now.getTime() + (30 * 24 * 60 * 60 * 1000)) / 1000); // 30 days TTL

    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: `${tenantId}#recent-unsubscribes`,
        sk: emailAddress.toLowerCase(),
        email: emailAddress,
        unsubscribedAt: now.toISOString(),
        ttl: ttl
      })
    }));
  } catch (error) {
    console.error('Error storing recent unsubscribe:', error);
    // Don't throw error as this shouldn't fail the unsubscribe process
  }
};

/**
 * Get unsubscribe page template for tenant
 */
const getUnsubscribeTemplate = async (tenantId) => {
  try {
    const result = await ddb.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({
        pk: `${tenantId}#unsubscribe`,
        sk: 'templates'
      })
    }));

    if (result.Item) {
      return unmarshall(result.Item);
    }

    // Return default template if none exists
    return getDefaultTemplate();
  } catch (error) {
    console.error('Error fetching unsubscribe template:', error);
    return getDefaultTemplate();
  }
};

/**
 * Generate success page HTML using tenant template
 */
const getSuccessPage = async (tenantId) => {
  const template = await getUnsubscribeTemplate(tenantId);
  return template.success || getDefaultTemplate().successHtml;
};

/**
 * Generate error page HTML using tenant template
 */
const getErrorPage = async (tenantId) => {
  const template = await getUnsubscribeTemplate(tenantId);
  return template.error || getDefaultTemplate().errorHtml;
};

/**
 * Default generic template (fallback for any tenant)
 */
const getDefaultTemplate = () => {
  return {
    successHtml: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Unsubscribed</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 2rem;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .success-icon {
            font-size: 4rem;
            color: #28a745;
            margin-bottom: 1rem;
        }
        h1 {
            color: #2c3e50;
            margin-bottom: 1rem;
        }
        .lead {
            font-size: 1.1rem;
            color: #6c757d;
            margin-bottom: 1.5rem;
        }
        .btn {
            display: inline-block;
            padding: 0.75rem 1.5rem;
            margin: 0.5rem;
            text-decoration: none;
            border-radius: 4px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .btn-secondary {
            background-color: #6c757d;
            color: white;
        }
        .btn-secondary:hover {
            background-color: #545b62;
            color: white;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✓</div>
        <h1>Successfully Unsubscribed</h1>
        <p class="lead">Your email has been removed from our mailing list.</p>
        <p>You will no longer receive newsletter emails from us.</p>
        <div style="margin-top: 2rem;">
            <a href="#" class="btn btn-secondary" onclick="history.back(); return false;">Go Back</a>
        </div>
    </div>
</body>
</html>`,
    errorHtml: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Unsubscribe Error</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 2rem;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .error-icon {
            font-size: 4rem;
            color: #dc3545;
            margin-bottom: 1rem;
        }
        h1 {
            color: #2c3e50;
            margin-bottom: 1rem;
        }
        .lead {
            font-size: 1.1rem;
            color: #6c757d;
            margin-bottom: 1.5rem;
        }
        .btn {
            display: inline-block;
            padding: 0.75rem 1.5rem;
            margin: 0.5rem;
            text-decoration: none;
            border-radius: 4px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .btn-secondary {
            background-color: #6c757d;
            color: white;
        }
        .btn-secondary:hover {
            background-color: #545b62;
            color: white;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">⚠</div>
        <h1>Unsubscribe Error</h1>
        <p class="lead">We encountered an issue processing your unsubscribe request.</p>
        <p>This is usually caused by an invalid, expired, or corrupted unsubscribe link.</p>
        <p><strong>What you can do:</strong></p>
        <ul style="text-align: left; display: inline-block;">
            <li>Try clicking the unsubscribe link directly from your email</li>
            <li>Make sure you're using the complete link (it may have wrapped to multiple lines)</li>
            <li>Contact us directly if the problem persists</li>
        </ul>
        <div style="margin-top: 2rem;">
            <a href="#" class="btn btn-secondary" onclick="history.back(); return false;">Go Back</a>
        </div>
    </div>
</body>
</html>`
  };
};
