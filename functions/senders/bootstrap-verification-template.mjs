import { SESv2Client, CreateCustomVerificationEmailTemplateCommand, UpdateCustomVerificationEmailTemplateCommand, GetCustomVerificationEmailTemplateCommand } from "@aws-sdk/client-sesv2";

const ses = new SESv2Client();

/**
 * Bootstrap custom verification email template
 * This function creates or updates the custom verification email template
 * It's designed to be idempotent and run during deployment as a CloudFormation custom resource
 */
export const handler = async (event, context) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  // CloudFormation custom resource response helper
  const sendResponse = async (status, data = {}) => {
    const responseBody = JSON.stringify({
      Status: status,
      Reason: data.reason || `See CloudWatch Log Stream: ${context.logStreamName}`,
      PhysicalResourceId: data.physicalResourceId || context.logStreamName,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: data.responseData || {}
    });

    console.log('Response body:', responseBody);

    try {
      const response = await fetch(event.ResponseURL, {
        method: 'PUT',
        headers: {
          'Content-Type': '',
          'Content-Length': responseBody.length
        },
        body: responseBody
      });
      console.log('Response sent successfully:', response.status);
    } catch (error) {
      console.error('Failed to send response:', error);
    }
  };

  try {
    // Only process Create and Update events
    if (event.RequestType === 'Delete') {
      console.log('Delete event - no action needed for verification template');
      await sendResponse('SUCCESS', {
        reason: 'Delete completed successfully',
        physicalResourceId: event.PhysicalResourceId
      });
      return;
    }

    console.log('Bootstrapping custom verification email template...');

    const templateName = process.env.SES_VERIFY_TEMPLATE_NAME;
    const fromEmailAddress = process.env.SYSTEM_FROM_EMAIL;
    const successUrl = process.env.VERIFY_SUCCESS_URL;
    const failureUrl = process.env.VERIFY_FAILURE_URL;

    if (!templateName || !fromEmailAddress || !successUrl || !failureUrl) {
      throw new Error('Missing required environment variables for template creation');
    }

    const templateSubject = 'Verify your sender email address';
    const templateContent = generateTemplateContent();

    // Check if template already exists
    let templateExists = false;
    try {
      await ses.send(new GetCustomVerificationEmailTemplateCommand({
        TemplateName: templateName
      }));
      templateExists = true;
      console.log('Template already exists, updating...');
    } catch (error) {
      if (error.name !== 'NotFoundException') {
        throw error;
      }
      console.log('Template does not exist, creating...');
    }

    if (templateExists) {
      // Update existing template
      await ses.send(new UpdateCustomVerificationEmailTemplateCommand({
        TemplateName: templateName,
        FromEmailAddress: fromEmailAddress,
        TemplateSubject: templateSubject,
        TemplateContent: templateContent,
        SuccessRedirectionURL: successUrl,
        FailureRedirectionURL: failureUrl
      }));
      console.log('Custom verification email template updated successfully');
    } else {
      // Create new template
      await ses.send(new CreateCustomVerificationEmailTemplateCommand({
        TemplateName: templateName,
        FromEmailAddress: fromEmailAddress,
        TemplateSubject: templateSubject,
        TemplateContent: templateContent,
        SuccessRedirectionURL: successUrl,
        FailureRedirectionURL: failureUrl
      }));
      console.log('Custom verification email template created successfully');
    }

    await sendResponse('SUCCESS', {
      reason: 'Custom verification email template bootstrapped successfully',
      physicalResourceId: templateName,
      responseData: {
        TemplateName: templateName,
        FromEmailAddress: fromEmailAddress,
        Action: templateExists ? 'updated' : 'created'
      }
    });

  } catch (error) {
    console.error('Error bootstrapping verification template:', error);

    await sendResponse('FAILED', {
      reason: `Failed to bootstrap verification template: ${error.message}`,
      physicalResourceId: event.PhysicalResourceId || context.logStreamName
    });
  }
};

/**
 * Generate the HTML content for the custom verification email template
 * This template will be used by SES for sender email verification
 */
const generateTemplateContent = () => `<!DOCTYPE html>
<html>
  <body>
    <h1>Newsletter Service</h1>

    <h2>Verify Your Sender Email</h2>
    <p>Hello!</p>

    <p>You're adding a new sender address to your account. To finish setup and start sending from this address, please confirm ownership.</p>

    <p><strong>Email to verify:</strong> {{EmailAddress}}</p>

    <p>Next step: click the verification link below to complete the process.</p>

    <div style="text-align: center; margin: 20px 0;">
      <a href="{{VerificationLink}}"
         style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;"
         class="verification-button">
        Verify Email Address
      </a>
    </div>

    <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
    <p style="word-break: break-all;">{{VerificationLink}}</p>

    <p>If the link has expired, start a new verification from your account settings.</p>

    <hr />
    <p>This email was sent by Newsletter Service.</p>
  </body>
</html>`.trim();

