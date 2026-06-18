import { useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircleIcon, ExclamationTriangleIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

type VerificationVariant = 'success' | 'failed' | 'info';

interface VerificationResult {
  variant: VerificationVariant;
  title: string;
  message: string;
}

/**
 * Landing page that Amazon SES redirects to after the recipient clicks the
 * sender verification link. SES appends `?status=success` or `?status=failed`
 * based on the configured success/failure redirect URLs (see the
 * VERIFY_SUCCESS_URL / VERIFY_FAILURE_URL env vars on the verification template
 * bootstrap function).
 */
export function VerifySenderPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const status = searchParams.get('status');

  const result = useMemo<VerificationResult>(() => {
    switch (status) {
      case 'success':
        return {
          variant: 'success',
          title: 'Email Verified!',
          message: 'Your sender email address has been verified. You can now send newsletters from it.'
        };
      case 'failed':
        return {
          variant: 'failed',
          title: 'Verification Failed',
          message:
            "We couldn't verify this email address. The link may have expired or already been used. You can request a new verification email from your sender settings."
        };
      default:
        return {
          variant: 'info',
          title: 'Check Your Email',
          message:
            'Open the verification link in the email we sent to confirm your sender address. You can manage senders and re-send verification from your sender settings.'
        };
    }
  }, [status]);

  useEffect(() => {
    if (status === 'success') {
      addToast({
        type: 'success',
        title: 'Sender verified',
        message: 'Your sender email is ready to use.'
      });
    } else if (status === 'failed') {
      addToast({
        type: 'error',
        title: 'Verification failed',
        message: 'We could not verify your sender email.'
      });
    }
  }, [status, addToast]);

  const goToSenders = () => navigate('/senders');
  const goToDashboard = () => navigate('/');

  return (
    <div className="min-h-screen bg-background flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <Card className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          {result.variant === 'success' && (
            <CheckCircleIcon className="mx-auto h-12 w-12 text-success-500" />
          )}
          {result.variant === 'failed' && (
            <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-error-500" />
          )}
          {result.variant === 'info' && (
            <EnvelopeIcon className="mx-auto h-12 w-12 text-primary-500" />
          )}
          <h2 className="mt-6 text-3xl font-bold text-foreground">{result.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{result.message}</p>
        </div>

        <div className="mt-8 space-y-4">
          <Button onClick={goToSenders} className="w-full" variant="primary">
            Go to Sender Settings
          </Button>
          <Button onClick={goToDashboard} className="w-full" variant="secondary">
            Go to Dashboard
          </Button>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-muted-foreground">
            Having trouble? Contact support for assistance.
          </p>
        </div>
      </Card>
    </div>
  );
}

export default VerifySenderPage;
