import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VisualBuilder } from '../VisualBuilder';
import { createEmptyVisualConfig } from '@/utils/templateConverter';
import type { Snippet } from '@/types/template';

// Mock the UI components
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div data-testid="card-content">{children}</div>
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  )
}));

vi.mock('@/components/ui/Input', () => ({
  Input: (props: any) => <input {...props} />
}));

vi.mock('@/components/ui/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />
}));

vi.mock('@/components/ui/Select', () => ({
  Select: ({ options, value, onChange, ...props }: any) => (
    <select value={value} onChange={onChange} {...props}>
      {options?.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}));

vi.mock('@/utils/cn', () => ({
  cn: (...classes: string[]) => classes.filter(Boolean).join(' ')
}));

const mockSnippets: Snippet[] = [
  {
    id: 'snippet-1',
    tenantId: 'tenant-1',
    name: 'test-snippet',
    description: 'Test snippet',
    type: 'snippet',
    parameters: [
      {
        name: 'title',
        type: 'string',
        required: true,
        description: 'The title'
      }
    ],
    s3Key: 'snippets/tenant-1/snippet-1.hbs',
    s3VersionId: 'v1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    version: 1,
    isActive: true
  }
];

describe('VisualBuilder', () => {
  it('renders empty state correctly', () => {
    const config = createEmptyVisualConfig();
    const onChange = vi.fn();

    render(
      <VisualBuilder
        config={config}
        onChange={onChange}
        snippets={mockSnippets}
      />
    );

    expect(screen.getByText('Start Building Your Template')).toBeInTheDocument();
    expect(screen.getByText('Drag components from the palette to begin creating your template.')).toBeInTheDocument();
  });

  it('renders component palette', () => {
    const config = createEmptyVisualConfig();
    const onChange = vi.fn();

    render(
      <VisualBuilder
        config={config}
        onChange={onChange}
        snippets={mockSnippets}
      />
    );

    expect(screen.getByText('Text Block')).toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
    expect(screen.getByText('Button')).toBeInTheDocument();
    expect(screen.getByText('Snippet')).toBeInTheDocument();
  });

  it('shows properties panel when no component is selected', () => {
    const config = createEmptyVisualConfig();
    const onChange = vi.fn();

    render(
      <VisualBuilder
        config={config}
        onChange={onChange}
        snippets={mockSnippets}
      />
    );

    expect(screen.getByText('Properties')).toBeInTheDocument();
    expect(screen.getByText('Select a component to edit its properties')).toBeInTheDocument();
  });

  it('renders components when config has components', () => {
    const config = {
      components: [
        {
          id: 'comp-1',
          type: 'text' as const,
          properties: {
            content: 'Hello World',
            fontSize: '16px',
            color: '#000000'
          }
        }
      ],
      globalStyles: {}
    };
    const onChange = vi.fn();

    render(
      <VisualBuilder
        config={config}
        onChange={onChange}
        snippets={mockSnippets}
      />
    );

    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });
});
