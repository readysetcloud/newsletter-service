import React from 'react';
import { cn } from '@/utils/cn';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'error' | 'warning' | 'dot' | 'pill';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export interface BadgeConfig {
  count?: number;
  status?: 'success' | 'error' | 'warning' | 'info';
  text?: string;
  variant?: BadgeProps['variant'];
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  className
}) => {
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-0.5 text-xs',
    lg: 'px-3 py-1 text-sm'
  };

  const variantClasses = {
    default: 'bg-blue-100 text-blue-800',
    secondary: 'bg-gray-100 text-gray-800',
    destructive: 'bg-red-100 text-red-800',
    outline: 'border border-gray-200 text-gray-800',
    success: 'bg-green-100 text-green-800',
    error: 'bg-red-100 text-red-800',
    warning: 'bg-yellow-100 text-yellow-800',
    dot: 'w-2 h-2 rounded-full bg-blue-500 p-0',
    pill: 'bg-blue-100 text-blue-800 rounded-full'
  };

  const baseClasses = variant === 'dot'
    ? 'inline-block'
    : 'inline-flex items-center rounded-full font-medium';

  return (
    <span className={cn(
      baseClasses,
      variant === 'dot' ? variantClasses[variant] : [sizeClasses[size], variantClasses[variant]],
      className
    )}>
      {variant !== 'dot' && children}
    </span>
  );
};
