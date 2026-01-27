import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout';
import { OnboardingSenderStep } from '@/components/onboarding/OnboardingSenderStep';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';

export function SenderOnboardingPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const { addToast } = useToast();
  const [, setIsCompleting] = useState(false);

  const handleComplete = async () => {
    console.log('=== Sender Onboarding Complete ===');
    setIsCompleting(true);

    try {
      addToast({
        type: 'success',
        title: 'Onboarding Complete!',
        message: 'Welcome to your newsletter dashboard. You\'re all set to start creating amazing content.',
      });

      // Refresh user context to ensure everything is up to date
      await refreshUser();

      // Small delay to ensure any backend processing completes
      await new Promise(resolve => setTimeout(resolve, 500));

      // Navigate to dashboard
      navigate('/dashboard', { replace: true });
    } catch (error) {
      console.error('Onboarding completion error:', error);
      addToast({
        type: 'error',
        title: 'Setup Error',
        message: 'There was an error completing your setup. Please try again.',
      });
    } finally {
      setIsCompleting(false);
    }
  };

  const handleSkip = async () => {
    console.log('=== Skipping Sender Setup ===');
    setIsCompleting(true);

    try {
      addToast({
        type: 'success',
        title: 'Onboarding Complete!',
        message: 'You can set up sender emails later from your dashboard settings.',
      });

      // Refresh user context
      await refreshUser();

      // Small delay for UX
      await new Promise(resolve => setTimeout(resolve, 300));

      // Navigate to dashboard
      navigate('/dashboard', { replace: true });
    } catch (error) {
      console.error('Onboarding skip error:', error);
      addToast({
        type: 'error',
        title: 'Navigation Error',
        message: 'There was an error navigating to your dashboard. Please try again.',
      });
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <OnboardingLayout
      currentStep="sender"
      title="Set Up Your Sender Email"
      description="Configure a verified email address to send newsletters from your own domain (optional)"
    >
      <OnboardingSenderStep
        onComplete={handleComplete}
        onSkip={handleSkip}
      />

      {/* Additional help text */}
      <div className="mt-8 p-4 bg-primary-50 border border-primary-200 rounded-lg">
        <h4 className="text-sm font-medium text-primary-900 mb-2">Why set up a sender email?</h4>
        <ul className="text-sm text-primary-800 space-y-1">
          <li>• Better email deliverability and trust</li>
          <li>• Professional branding with your own domain</li>
          <li>• Avoid generic &quot;noreply&quot; sender addresses</li>
          <li>• Build stronger relationships with subscribers</li>
        </ul>
        <p className="text-xs text-primary-700 mt-3">
          Don&apos;t worry - you can always set this up later from your dashboard settings.
        </p>
      </div>
    </OnboardingLayout>
  );
}
