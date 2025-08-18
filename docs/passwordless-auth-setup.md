# Passwordless Authentication Setup

Your Cognito User Pool has been configured to support passwordless authentication. Here's what's been updated and how to use it.

## What's Changed

### User Pool Configuration
- ✅ **MFA enabled** with optional enforcement
- ✅ **Advanced Security Mode** enforced for better protection
- ✅ **WebAuthn/FIDO2 support** via enhanced auth flows
- ✅ **Email-only sign-in** (phone number removed as option)
- ✅ **Custom auth flows** enabled for passwordless login
- ✅ **Hosted UI domain** created for easy integration

### Authentication Flows Enabled
- `ALLOW_USER_AUTH` - New unified auth flow
- `ALLOW_CUSTOM_AUTH` - For passwordless implementations
- `ALLOW_USER_SRP_AUTH` - Secure Remote Password
- `ALLOW_REFRESH_TOKEN_AUTH` - Token refresh
- Traditional password flows (as fallback)

## Deployment

Deploy your updated template:

```bash
sam build && sam deploy
```

After deployment, note the new output:
- `UserPoolDomainUrl` - Your hosted UI URL for authentication

## Implementation Options

### Option 1: Hosted UI (Recommended)
Use Cognito's built-in hosted UI for the easiest passwordless setup:

```javascript
// Redirect users to hosted UI
const hostedUIUrl = `https://your-domain.auth.region.amazoncognito.com/login?client_id=YOUR_CLIENT_ID&response_type=code&scope=email+openid+profile&redirect_uri=YOUR_CALLBACK_URL`;
window.location.href = hostedUIUrl;
```

### Option 2: Custom Implementation
For full control, implement custom passwordless flow:

```javascript
import { testPasswordlessAuth } from './scripts/test-passwordless-auth.mjs';

// Initiate passwordless auth
const authSession = await testPasswordlessAuth('user@example.com', 'your-client-id');

// User receives email with magic link/code
// Complete auth with verification code
const tokens = await completePasswordlessAuth(authSession.session, 'verification-code', 'your-client-id');
```

## Required Lambda Triggers

For full passwordless functionality, you'll need to implement these Cognito triggers:

### 1. Create Auth Challenge
```javascript
// functions/auth/create-auth-challenge.mjs
export const handler = async (event) => {
  if (event.request.challengeName === 'CUSTOM_CHALLENGE') {
    // Generate and send magic link or OTP
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Store code in DynamoDB with TTL
    // Send email with code or magic link

    event.response.publicChallengeParameters = {
      email: event.request.userAttributes.email
    };
    event.response.privateChallengeParameters = {
      answer: code
    };
    event.response.challengeMetadata = 'EMAIL_CHALLENGE';
  }
  return event;
};
```

### 2. Define Auth Challenge
```javascript
// functions/auth/define-auth-challenge.mjs
export const handler = async (event) => {
  if (event.request.session.length === 0) {
    // First attempt - issue custom challenge
    event.response.challengeName = 'CUSTOM_CHALLENGE';
    event.response.issueTokens = false;
  } else if (event.request.session.length === 1 &&
             event.request.session[0].challengeResult === true) {
    // Correct answer - issue tokens
    event.response.issueTokens = true;
  } else {
    // Wrong answer - fail auth
    event.response.issueTokens = false;
  }
  return event;
};
```

### 3. Verify Auth Challenge
```javascript
// functions/auth/verify-auth-challenge.mjs
export const handler = async (event) => {
  const expectedAnswer = event.request.privateChallengeParameters.answer;
  const providedAnswer = event.request.challengeAnswer;

  event.response.answerCorrect = (expectedAnswer === providedAnswer);
  return event;
};
```

## Testing

1. **Test the configuration:**
   ```bash
   cd scripts
   node test-passwordless-auth.mjs
   ```

2. **Test hosted UI:**
   - Visit the `UserPoolDomainUrl` from your CloudFormation outputs
   - Try signing in with email only
   - Configure MFA options in the UI

## Security Features

### Advanced Security Mode
- Automatic risk detection
- Adaptive authentication
- Compromised credential detection
- Unusual activity monitoring

### MFA Options
- SMS MFA (optional)
- TOTP/Software tokens (optional)
- WebAuthn/FIDO2 (when implemented)

## Migration Notes

### Existing Users
- Current users can still sign in with passwords
- They can opt into passwordless/MFA gradually
- No breaking changes to existing auth flows

### Client Applications
- Update redirect URIs in your app client settings
- Test with both password and passwordless flows
- Implement proper error handling for auth challenges

## Next Steps

1. **Deploy the updated template**
2. **Test the hosted UI** with your domain
3. **Implement custom auth triggers** if needed
4. **Update your frontend** to support new auth flows
5. **Configure MFA policies** based on your security requirements

## Troubleshooting

### Common Issues
- **Domain already exists**: User pool domains must be globally unique
- **Auth flow not allowed**: Check ExplicitAuthFlows in your client config
- **Challenge not working**: Verify your Lambda triggers are properly configured

### Useful Commands
```bash
# Check user pool configuration
aws cognito-idp describe-user-pool --user-pool-id YOUR_POOL_ID

# Test auth flows
aws cognito-idp initiate-auth --auth-flow CUSTOM_AUTH --client-id YOUR_CLIENT_ID --auth-parameters USERNAME=user@example.com
```

## Resources

- [AWS Cognito Passwordless Authentication](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-challenge.html)
- [WebAuthn with Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-adaptive-authentication.html)
- [Hosted UI Customization](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-app-ui-customization.html)
