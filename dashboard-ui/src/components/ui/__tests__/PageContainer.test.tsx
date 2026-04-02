import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PageContainer } from '../PageContainer';

describe('PageContainer', () => {
  it('renders children with max-width constraint', () => {
    const { container } = render(
      <PageContainer>
        <p>Page content</p>
      </PageContainer>
    );

    expect(screen.getByText('Page content')).toBeInTheDocument();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveClass('max-w-7xl', 'mx-auto', 'px-4', 'py-6');
  });

  it('renders title and action when provided', () => {
    render(
      <PageContainer title="Subscribers" action={<button>Create</button>}>
        <p>Content</p>
      </PageContainer>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Subscribers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('renders without title or action (no header row)', () => {
    const { container } = render(
      <PageContainer>
        <p>Just children</p>
      </PageContainer>
    );

    expect(screen.getByText('Just children')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    // No header row div with flex justify-between
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.querySelector('.flex.justify-between')).toBeNull();
  });

  it('renders header row when only title is provided', () => {
    render(
      <PageContainer title="Dashboard">
        <p>Content</p>
      </PageContainer>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders header row when only action is provided', () => {
    render(
      <PageContainer action={<button>Add New</button>}>
        <p>Content</p>
      </PageContainer>
    );

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add New' })).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <PageContainer className="mt-10">
        <p>Content</p>
      </PageContainer>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveClass('mt-10');
  });
});
