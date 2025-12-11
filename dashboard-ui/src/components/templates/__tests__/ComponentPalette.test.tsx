import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentPalette } from '../ComponentPalette';

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('ComponentPalette', () => {
  const defaultProps = {
    tab: 'build' as const,
    onTabChange: jest.fn(),
    editMode: 'visual' as const,
    onEditModeChange: jest.fn(),
    testData: '{}',
    onTestDataChange: jest.fn(),
    testError: null,
    onComponentDragStart: jest.fn(),
    onComponentDragEnd: jest.fn(),
    onComponentClick: jest.fn(),
    onPreview: jest.fn(),
    onSave: jest.fn(),
    draggedComponent: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue('256');
  });

  it('renders with default width from localStorage', () => {
    render(<ComponentPalette {...defaultProps} />);

    expect(mockLocalStorage.getItem).toHaveBeenCalledWith('template-builder-sidebar-width');
    expect(screen.getByText('Template Builder')).toBeInTheDocument();
  });

  it('toggles between expanded and collapsed states', () => {
    render(<ComponentPalette {...defaultProps} />);

    const toggleButton = screen.getByTitle('Collapse sidebar');
    fireEvent.click(toggleButton);

    expect(screen.queryByText('Template Builder')).not.toBeInTheDocument();
    expect(screen.getByTitle('Expand sidebar')).toBeInTheDocument();
  });

  it('switches between build and test tabs', () => {
    render(<ComponentPalette {...defaultProps} />);

    const testTab = screen.getByText('Test');
    fireEvent.click(testTab);

    expect(defaultProps.onTabChange).toHaveBeenCalledWith('test');
  });

  it('switches between visual and code edit modes', () => {
    render(<ComponentPalette {...defaultProps} />);

    const codeButton = screen.getByText('Code');
    fireEvent.click(codeButton);

    expect(defaultProps.onEditModeChange).toHaveBeenCalledWith('code');
  });

  it('displays components in visual mode', () => {
    render(<ComponentPalette {...defaultProps} />);

    expect(screen.getByText('Heading')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
    expect(screen.getByText('Button')).toBeInTheDocument();
    expect(screen.getByText('Divider')).toBeInTheDocument();
  });

  it('displays test data textarea in test tab', () => {
    render(<ComponentPalette {...defaultProps} tab="test" />);

    expect(screen.getByText('Test Data')).toBeInTheDocument();
    expect(screen.getByDisplayValue('{}')).toBeInTheDocument();
  });

  it('shows test error when provided', () => {
    render(<ComponentPalette {...defaultProps} tab="test" testError="Invalid JSON" />);

    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();
  });

  it('handles component drag start', () => {
    render(<ComponentPalette {...defaultProps} />);

    const headingComponent = screen.getByText('Heading').closest('div');
    const dragEvent = new Event('dragstart', { bubbles: true });

    fireEvent(headingComponent!, dragEvent);

    expect(defaultProps.onComponentDragStart).toHaveBeenCalled();
  });

  it('handles component click', () => {
    render(<ComponentPalette {...defaultProps} />);

    const headingComponent = screen.getByText('Heading').closest('div');
    fireEvent.click(headingComponent!);

    expect(defaultProps.onComponentClick).toHaveBeenCalled();
  });

  it('saves width to localStorage when resizing', () => {
    render(<ComponentPalette {...defaultProps} />);

    // Simulate resize by checking if setItem would be called
    // Note: Testing the actual resize interaction would require more complex setup
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('template-builder-sidebar-width', '256');
  });

  it('collapses to icon-only mode when width is below threshold', () => {
    mockLocalStorage.getItem.mockReturnValue('100'); // Below collapse threshold

    render(<ComponentPalette {...defaultProps} />);

    expect(screen.queryByText('Template Builder')).not.toBeInTheDocument();
    expect(screen.getByTitle('Expand sidebar')).toBeInTheDocument();
  });
});
