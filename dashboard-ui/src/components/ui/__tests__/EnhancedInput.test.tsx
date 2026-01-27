import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EnhancedInput } from '../EnhancedInput';

describe('EnhancedInput', () => {
  it('renders with basic props', () => {
    render(
      <EnhancedInput
        label="Test Input"
        placeholder="Enter text"
      />
    );

    expect(screen.getByLabelText('Test Input')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
  });

  it('shows validation states correctly', () => {
    const { rerender } = render(
      <EnhancedInput
        label="Test Input"
        validationState="idle"
        showValidationIcon={true}
      />
    );

    // Should not show validation icon in idle state
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    // Error state
    rerender(
      <EnhancedInput
        label="Test Input"
        validationState="error"
        error="This field is required"
        showValidationIcon={true}
      />
    );

    expect(screen.getByText('This field is required')).toBeInTheDocument();
    expect(screen.getByText('This field is required')).toHaveClass('text-error-600');

    // Success state
    rerender(
      <EnhancedInput
        label="Test Input"
        validationState="success"
        showValidationIcon={true}
        value="Valid input"
        onChange={() => {}}
      />
    );

    // Should show success styling
    const input = screen.getByDisplayValue('Valid input');
    expect(input).toHaveClass('border-success-300');
  });

  it('handles password toggle functionality', async () => {
    render(
      <EnhancedInput
        label="Password"
        type="password"
        showPasswordToggle={true}
        value="secret123"
        onChange={() => {}}
      />
    );

    const input = screen.getByLabelText('Password') as HTMLInputElement;
    const toggleButton = screen.getByRole('button');

    // Initially should be password type
    expect(input.type).toBe('password');

    // Click toggle button
    fireEvent.click(toggleButton);

    // Should change to text type
    expect(input.type).toBe('text');

    // Click again to hide
    fireEvent.click(toggleButton);
    expect(input.type).toBe('password');
  });

  it('shows password strength indicator', () => {
    render(
      <EnhancedInput
        label="Password"
        type="password"
        strengthIndicator={true}
        strengthRequirements={['At least 8 characters', 'Uppercase letter', 'Number']}
        value="Test123!"
        onChange={() => {}}
      />
    );

    // Should show strength indicator
    expect(screen.getByText('Password strength')).toBeInTheDocument();
    expect(screen.getByText('Requirements:')).toBeInTheDocument();
  });

  it('handles focus and blur events', async () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();

    render(
      <EnhancedInput
        label="Test Input"
        onFocus={onFocus}
        onBlur={onBlur}
      />
    );

    const input = screen.getByLabelText('Test Input');

    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalled();
  });

  it('shows helper text and warnings', () => {
    render(
      <EnhancedInput
        label="Test Input"
        helperText="This is helper text"
        warning="This is a warning"
      />
    );

    expect(screen.getByText('This is a warning')).toBeInTheDocument();
    expect(screen.getByText('This is a warning')).toHaveClass('text-warning-600');
  });

  it('handles disabled state', () => {
    render(
      <EnhancedInput
        label="Test Input"
        disabled={true}
      />
    );

    const input = screen.getByLabelText('Test Input');
    expect(input).toBeDisabled();
    expect(input).toHaveClass('disabled:bg-background');
  });

  it('shows validating state with spinner', () => {
    render(
      <EnhancedInput
        label="Test Input"
        validationState="validating"
        showValidationIcon={true}
        value="test"
        onChange={() => {}}
      />
    );

    // Should show loading spinner
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });
});
