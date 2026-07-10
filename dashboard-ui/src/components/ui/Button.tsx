import React from 'react';
import { Button as RscButton, type ButtonVariant } from '@readysetcloud/ui';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children: React.ReactNode;
}

// Legacy variant names mapped onto the shared design system.
const variantMap: Record<NonNullable<ButtonProps['variant']>, ButtonVariant> = {
  primary: 'primary',
  secondary: 'secondary',
  outline: 'secondary',
  ghost: 'ghost',
  destructive: 'error',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', isLoading = false, type = 'submit', ...props }, ref) => {
    // type defaults to 'submit' to match the plain <button> this replaced —
    // several forms rely on implicit submit.
    return (
      <RscButton
        ref={ref}
        variant={variantMap[variant]}
        loading={isLoading}
        type={type}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
