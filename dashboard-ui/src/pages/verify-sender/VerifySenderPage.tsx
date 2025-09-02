import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircleIcon, ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface VerificationResult {
  success: boolean;
  message: string;
  senderId?: string;
  email?: string;
  verificationStatus?: string;
  alreadyVerified?: boolean;
  expired?: boolean;
  error?: string;
}

export function VerifySenderPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [isVerifying, setIsVerifying] = useState(true);
  const [result, setResult] = useState<VerificationResult | null>(null);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setResult({
        success: false,
        message: 'No verification token provided. Please use the link from your email.',
        error: 'Missing token'
      });
      setIsVerifying(false);
      return;
    }

    verifyToken(token);
  }, [token]);

  const verifyToken = async (verificationToken: string) => {
    // Note: This verification flow is now handled by SES custom verification emails
    // which redirect directly to success/failure pages. This component is kept for
    // backward compatibility but the verification logic has been streamlined.

    setResult({
      success: false,
      message: 'Email verification is now handled automatically. Please check your email for the verification link and follow the instructions provided.',
      error: 'Deprecated verification method'
    });

    addToast({
      type: 'info',
      title: 'Verification Method Updated',
      message: 'Email verification now uses a streamlined process. Please check your email for the verification link.'
    });

    setIsVerifying(false);
  };

  const handleGoToDashboard = () => {
    navigate('/senders');
  };

  const handleRequestNewVerification = () => {
    navigate('/senders', {
      state: {
        message: 'Please request a new verification email from your sender settings.'
      }
    });
  };

  if (isVerifying) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <Card className="max-w-md w-full space-y-8 p-8">
          <div className="text-center">
            <ArrowPathIcon className="mx-auto h-12 w-12 text-blue-500 animate-spin" />
            <h2 className="mt-6 text-3xl font-bold text-gray-900">
              Verifying Email
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Please wait while we verify your sender email address...
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <Card className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          {result?.success ? (
            <>
              <CheckCircleIcon className="mx-auto h-12 w-12 text-green-500" />
              <h2 className="mt-6 text-3xl font-bold text-gray-900">
                {result.alreadyVerified ? 'Already Verified' : 'Email Verified!'}
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                {result.message}
              </p>
              {result.email && (
                <div className="mt-4 p-4 bg-green-50 rounded-lg">
                  <p className="text-sm font-medium text-green-800">
                    Verified Email: {result.email}
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-red-500" />
              <h2 className="mt-6 text-3xl font-bold text-gray-900">
                Verification Failed
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                {result?.message || 'Unable to verify your email address.'}
              </p>
              {result?.expired && (
                <div className="mt-4 p-4 bg-yellow-50 rounded-lg">
                  <p className="text-sm font-medium text-yellow-800">
                    The verification link has expired. Please request a new one.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-8 space-y-4">
          {result?.success ? (
            <Button
              onClick={handleGoToDashboard}
              className="w-full"
              variant="primary"
            >
              Go to Sender Settings
            </Button>
          ) : (
            <>
              <Button
                onClick={handleRequestNewVerification}
                className="w-full"
                variant="primary"
              >
                {result?.expired ? 'Request New Verification' : 'Go to Sender Settings'}
              </Button>
              <Button
                onClick={() => navigate('/')}
                className="w-full"
                variant="secondary"
              >
                Go to Dashboard
              </Button>
            </>
          )}
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500">
            Having trouble? Contact support for assistance.
          </p>
        </div>
      </Card>
    </div>
  );
}

export default VerifySenderPage;
