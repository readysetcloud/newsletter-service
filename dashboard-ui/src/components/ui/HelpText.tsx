import React, { useState, useEffect } from 'react';
import {
  XMarkIcon,
  LightBulbIcon,
  InformationCircleIcon,
  SparklesIcon,
  ArrowRightIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';

interface HelpTextProps {
  id: string;
  title: string;
  content: React.ReactNode;
  variant?: 'info' | 'tip' | 'success' | 'magic';
  position?: 'top' | 'bottom' | 'left' | 'right';
  dismissible?: boolean;
  autoShow?: boolean;
  delay?: number;
  className?: string;
  onDismiss?: () => void;
  children?: React.ReactNode;
}

const STORAGE_KEY = 'dismissed-help-texts';

const getDismissedHelpTexts = (): Set<string> => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return new Set(stored ? JSON.parse(stored) : []);
  } catch {
    return new Set();
  }
};

const setDismissedHelpText = (id: string) => {
  try {
    const dismissed = getDismissedHelpTexts();
    dismissed.add(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
  } catch {
    // Ignore storage errors
  }
};

const variantStyles = {
  info: {
    container: 'bg-blue-50 border-blue-200 text-blue-900',
    icon: 'text-blue-600',
    iconComponent: InformationCircleIcon
  },
  tip: {
    container: 'bg-amber-50 border-amber-200 text-amber-900',
    icon: 'text-amber-600',
    iconComponent: LightBulbIcon
  },
  success: {
    container: 'bg-green-50 border-green-200 text-green-900',
    icon: 'text-green-600',
    iconComponent: CheckCircleIcon
  },
  magic: {
    container: 'bg-purple-50 border-purple-200 text-purple-900',
    icon: 'text-purple-600',
    iconComponent: SparklesIcon
  }
};

export const HelpText: React.FC<HelpTextProps> = ({
  id,
  title,
  content,
  variant = 'info',
  position = 'top',
  dismissible = true,
  autoShow = true,
  delay = 0,
  className,
  onDismiss,
  children
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const styles = variantStyles[variant];
  const IconComponent = styles.iconComponent;

  useEffect(() => {
    if (!autoShow) return;

    const dismissed = getDismissedHelpTexts();
    if (dismissed.has(id)) return;

    const timer = setTimeout(() => {
      setIsVisible(true);
      setIsAnimating(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [id, autoShow, delay]);

  const handleDismiss = () => {
    setIsAnimating(false);
    setTimeout(() => {
      setIsVisible(false);
      setDismissedHelpText(id);
      onDismiss?.();
    }, 200);
  };

  const handleShow = () => {
    setIsVisible(true);
    setIsAnimating(true);
  };

  if (!isVisible && autoShow) return null;

  const helpTextElement = (
    <div
      className={cn(
        'relative rounded-lg border p-4 shadow-sm transition-all duration-200',
        styles.container,
        isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
        className
      )}
      role="complementary"
      aria-labelledby={`help-title-${id}`}
    >
      <div className="flex items-start space-x-3">
        <IconComponent className={cn('h-5 w-5 flex-shrink-0 mt-0.5', styles.icon)} />
        <div className="flex-1 min-w-0">
          <h4 id={`help-title-${id}`} className="text-sm font-medium mb-1">
            {title}
          </h4>
          <div className="text-sm opacity-90">
            {content}
          </div>
        </div>
        {dismissible && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="flex-shrink-0 -mt-1 -mr-1 h-6 w-6 p-0 hover:bg-black/5"
            aria-label="Dismiss help text"
          >
            <XMarkIcon className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );

  if (!autoShow) {
    return (
      <div className="relative">
        {children}
        {isVisible && helpTextElement}
        {!isVisible && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleShow}
            className="absolute top-2 right-2 h-6 w-6 p-0 opacity-50 hover:opacity-100"
            aria-label="Show help"
          >
            <InformationCircleIcon className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return helpTextElement;
};

interface HelpSequenceProps {
  steps: Array<{
    id: string;
    title: string;
    content: React.ReactNode;
    variant?: HelpTextProps['variant'];
    trigger?: () => boolean;
  }>;
  onComplete?: () => void;
}

export const HelpSequence: React.FC<HelpSequenceProps> = ({ steps, onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  useEffect(() => {
    const step = steps[currentStep];
    if (step?.trigger && step.trigger()) {
      setCompletedSteps(prev => new Set([...prev, currentStep]));
      if (currentStep < steps.length - 1) {
        setTimeout(() => setCurrentStep(currentStep + 1), 1000);
      } else {
        onComplete?.();
      }
    }
  }, [currentStep, steps, onComplete]);

  const currentStepData = steps[currentStep];
  if (!currentStepData || completedSteps.has(currentStep)) return null;

  return (
    <HelpText
      id={`sequence-${currentStepData.id}`}
      title={`${currentStep + 1}/${steps.length}: ${currentStepData.title}`}
      content={
        <div className="space-y-2">
          {currentStepData.content}
          <div className="flex items-center justify-between mt-3">
            <div className="flex space-x-1">
              {steps.map((_, index) => (
                <div
                  key={index}
                  className={cn(
                    'h-1.5 w-6 rounded-full',
                    index <= currentStep ? 'bg-current opacity-100' : 'bg-current opacity-20'
                  )}
                />
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentStep(currentStep + 1)}
              className="text-xs"
            >
              Next <ArrowRightIcon className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </div>
      }
      variant={currentStepData.variant}
      dismissible={false}
    />
  );
};

interface QuickTipProps {
  children: React.ReactNode;
  tip: string;
  variant?: HelpTextProps['variant'];
}

export const QuickTip: React.FC<QuickTipProps> = ({ children, tip, variant = 'tip' }) => {
  const [showTip, setShowTip] = useState(false);

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      {children}
      {showTip && (
        <div className={cn(
          'absolute z-50 px-2 py-1 text-xs rounded shadow-lg whitespace-nowrap',
          'bottom-full left-1/2 transform -translate-x-1/2 mb-2',
          variantStyles[variant].container
        )}>
          {tip}
          <div className={cn(
            'absolute top-full left-1/2 transform -translate-x-1/2',
            'border-4 border-transparent',
            variant === 'info' && 'border-t-blue-200',
            variant === 'tip' && 'border-t-amber-200',
            variant === 'success' && 'border-t-green-200',
            variant === 'magic' && 'border-t-purple-200'
          )} />
        </div>
      )}
    </div>
  );
};
