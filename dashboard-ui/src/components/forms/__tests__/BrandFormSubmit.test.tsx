import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrandForm } from '../BrandForm';
import { ToastProvider } from '../../ui/Toast';

// BrandIdInput fires a debounced availability check; keep it deterministic.
vi.mock('../../../services/brandService', () => ({
  checkBrandIdAvailability: vi
    .fn()
    .mockResolvedValue({ available: true, brandId: 'mycompany', suggestions: [] }),
}));

const renderCreateForm = (onSubmit = vi.fn()) =>
  render(
    <ToastProvider>
      <BrandForm
        onSubmit={onSubmit}
        submitButtonText="Complete Brand Setup"
        showCancelButton={false}
      />
    </ToastProvider>
  );

describe('BrandForm submit gating (onboarding / create mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the submit button enabled so the user is never stuck', () => {
    renderCreateForm();
    expect(
      screen.getByRole('button', { name: /complete brand setup/i })
    ).not.toBeDisabled();
  });

  it('submits when the required fields are valid', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderCreateForm(onSubmit);

    fireEvent.change(screen.getByPlaceholderText(/enter your brand name/i), {
      target: { value: 'My Company' },
    });
    // Brand ID auto-generates from the name; wait for it to populate.
    await waitFor(() =>
      expect(screen.getByLabelText('Brand ID *')).toHaveValue('mycompany')
    );
    fireEvent.change(screen.getByLabelText('Industry *'), {
      target: { value: 'technology' },
    });

    fireEvent.click(screen.getByRole('button', { name: /complete brand setup/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('blocks submit and surfaces a focused error when a required field is missing', async () => {
    const onSubmit = vi.fn();
    renderCreateForm(onSubmit);

    // Fill only the brand name; leave the required industry unselected.
    fireEvent.change(screen.getByPlaceholderText(/enter your brand name/i), {
      target: { value: 'My Company' },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Brand ID *')).toHaveValue('mycompany')
    );

    fireEvent.click(screen.getByRole('button', { name: /complete brand setup/i }));

    expect(await screen.findByText(/industry is required/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
