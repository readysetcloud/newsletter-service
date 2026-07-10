import { configureAuth } from '@readysetcloud/ui/auth';

// Shared RSC Cognito user pool; this app brings its own app client id.
configureAuth({
  region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
  clientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || '',
});
