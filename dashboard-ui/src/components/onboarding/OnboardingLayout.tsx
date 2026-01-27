import React from 'react';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

interface OnboardingLayoutProps {
  children: React.ReactNode;
  currentStep: 'brand' | 'profile' | 'sender';
  title: string;
  description: string;
}

export function OnboardingLayout({
  children,
  currentStep,
  title,
  description
}: OnboardingLayoutProps) {
  const { needsBrandSetup, needsProfileSetup } = useOnboardingStatus();

  const steps = [
    {
      id: 'brand',
      name: 'Brand Setup',
      description: 'Set up your brand information',
      completed: !needsBrandSetup,
      current: currentStep === 'brand',
    },
    {
      id: 'profile',
      name: 'Profile Setup',
      description: 'Complete your profile',
      completed: !needsProfileSetup,
      current: currentStep === 'profile',
    },
    {
      id: 'sender',
      name: 'Sender Email',
      description: 'Configure sender email (optional)',
      completed: false, // This is always optional
      current: currentStep === 'sender',
      optional: true,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-surface shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Welcome to Outboxed
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Let&apos;s get your account set up
                </p>
              </div>
              <div className="text-sm text-muted-foreground">
                Step {currentStep === 'brand' ? '1' : currentStep === 'profile' ? '2' : '3'} of 3
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <nav aria-label="Progress">
          <ol className="flex items-center justify-center space-x-8 mb-8">
            {steps.map((step, stepIdx) => (
              <li key={step.id} className="flex items-center">
                <div className="flex items-center">
                  <div className="flex items-center space-x-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full ${
                        step.completed
                          ? 'bg-success-600'
                          : step.current
                          ? 'bg-primary-600'
                          : 'bg-border'
                      }`}
                    >
                      {step.completed ? (
                        <CheckCircleIcon className="h-5 w-5 text-white" />
                      ) : (
                        <span
                          className={`text-sm font-medium ${
                            step.current ? 'text-white' : 'text-muted-foreground'
                          }`}
                        >
                          {stepIdx + 1}
                        </span>
                      )}
                    </div>
                    <div className="text-left">
                      <p
                        className={`text-sm font-medium ${
                          step.current ? 'text-primary-600' : 'text-foreground'
                        }`}
                      >
                        {step.name}
                        {step.optional && (
                          <span className="text-xs text-muted-foreground ml-1">(optional)</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{step.description}</p>
                    </div>
                  </div>
                </div>
                {stepIdx < steps.length - 1 && (
                  <div className="ml-8 h-px w-16 bg-border" />
                )}
              </li>
            ))}
          </ol>
        </nav>

        {/* Main Content */}
        <div className="max-w-2xl mx-auto">
          <div className="bg-surface shadow rounded-lg">
            <div className="px-6 py-8">
              <div className="text-center mb-8">
                <h2 className="text-xl font-semibold text-foreground">{title}</h2>
                <p className="mt-2 text-muted-foreground">{description}</p>
              </div>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
