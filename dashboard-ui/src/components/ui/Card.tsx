import React from 'react';
import { cn } from '../../utils/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /**
   * Enable hover effect (subtle elevation and shadow)
   * @default false
   */
  hoverable?: boolean;
  /**
   * Enable interactive state (cursor pointer + hover effect)
   * @default false
   */
  interactive?: boolean;
}

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const paddingVariants = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8'
};

export const Card: React.FC<CardProps> = ({
  children,
  padding = 'md',
  hoverable = false,
  interactive = false,
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        'bg-surface rounded-lg border border-border shadow-sm',
        'transition-all duration-200 ease-in-out',
        hoverable && 'hover:shadow-md',
        interactive && 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 hover:border-primary-200',
        paddingVariants[padding],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<CardHeaderProps> = ({
  children,
  className,
  ...props
}) => {
  return (
    <div
      className={cn('flex flex-col space-y-1.5 pb-4', className)}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <h3
      className={cn('text-lg font-semibold leading-none tracking-tight text-foreground', className)}
      {...props}
    >
      {children}
    </h3>
  );
};

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <p
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    >
      {children}
    </p>
  );
};

export const CardContent: React.FC<CardContentProps> = ({
  children,
  className,
  ...props
}) => {
  return (
    <div className={cn('pt-0', className)} {...props}>
      {children}
    </div>
  );
};

export const CardFooter: React.FC<CardFooterProps> = ({
  children,
  className,
  ...props
}) => {
  return (
    <div
      className={cn('flex items-center pt-4', className)}
      {...props}
    >
      {children}
    </div>
  );
};
