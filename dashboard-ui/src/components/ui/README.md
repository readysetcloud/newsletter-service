# UI Component Library

This directory contains a comprehensive set of reusable UI components built with React, TypeScript, and Tailwind CSS. The components follow modern design patterns and provide consistent styling across the application.

## Components Overview

### Form Components

#### Button
A versatile button component with mul variants and states.

```tsx
import { Button } from './components/ui';

// Basic usage
<Button onClick={handleClick}>Click me</Button>

// With variants
<Button variant="primary">Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="destructive">Destructive</Button>

// With sizes
<Button size="sm">Small</Button>
<Button size="md">Medium</Button>
<Button size="lg">Large</Button>

// With loading state
<Button isLoading>Loading...</Button>
```

#### Input
A flexible input component with label, error handling, and icon support.

```tsx
import { Input } from './components/ui';

<Input
  label="Email Address"
  type="email"
  placeholder="Enter your email"
  error={errors.email}
  helperText="We'll never share your email"
  leftIcon={<EmailIcon />}
  rightIcon={<CheckIcon />}
/>
```

#### TextArea
A textarea component with validation styling.

```tsx
import { TextArea } from './components/ui';

<TextArea
  label="Message"
  placeholder="Enter your message"
  rows={4}
  error={errors.message}
  helperText="Maximum 500 characters"
/>
```

#### Select
A select dropdown component with customizable options.

```tsx
import { Select } from './components/ui';

const options = [
  { value: 'option1', label: 'Option 1' },
  { value: 'option2', label: 'Option 2' },
  { value: 'option3', label: 'Option 3', disabled: true }
];

<Select
  label="Choose an option"
  options={options}
  placeholder="Select..."
  error={errors.selection}
/>
```

### Layout Components

#### Card
A flexible card component with header, content, and footer sections.

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './components/ui';

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Card description text</CardDescription>
  </CardHeader>
  <CardContent>
    <p>Card content goes here</p>
  </CardContent>
  <CardFooter>
    <Button>Action</Button>
  </CardFooter>
</Card>
```

#### Modal
A modal dialog component with overlay and keyboard navigation.

```tsx
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from './components/ui';

<Modal
  isOpen={isOpen}
  onClose={handleClose}
  size="md"
  closeOnOverlayClick={true}
  closeOnEscape={true}
>
  <ModalHeader onClose={handleClose}>
    <ModalTitle>Modal Title</ModalTitle>
  </ModalHeader>
  <ModalContent>
    <p>Modal content</p>
  </ModalContent>
  <ModalFooter>
    <Button variant="outline" onClick={handleClose}>Cancel</Button>
    <Button onClick={handleConfirm}>Confirm</Button>
  </ModalFooter>
</Modal>
```

#### Layout
A responsive layout component with header, sidebar, and main content areas.

```tsx
import { Layout, Navigation, NavigationItem } from './components/ui';

const header = (
  <div className="flex justify-between items-center">
    <h1>App Title</h1>
    <Button>Profile</Button>
  </div>
);

const sidebar = (
  <Navigation>
    <NavigationItem active icon={<DashboardIcon />}>
      Dashboard
    </NavigationItem>
    <NavigationItem icon={<SettingsIcon />}>
      Settings
    </NavigationItem>
  </Navigation>
);

<Layout header={header} sidebar={sidebar}>
  <div>Main content</div>
</Layout>
```

### Feedback Components

#### Loading
Loading indicators with multiple variants and sizes.

```tsx
import { Loading, LoadingSkeleton, LoadingPage } from './components/ui';

// Spinner loading
<Loading variant="spinner" size="lg" text="Loading..." />

// Dots loading
<Loading variant="dots" size="md" />

// Pulse loading
<Loading variant="pulse" size="sm" />

// Skeleton loading
<LoadingSkeleton lines={3} avatar />

// Full page loading
<LoadingPage text="Loading application..." />
```

#### Toast Notifications
A toast notification system with context provider.

```tsx
import { ToastProvider, useToast } from './components/ui';

// Wrap your app with ToastProvider
<ToastProvider maxToasts={5}>
  <App />
</ToastProvider>

// Use in components
const { addToast } = useToast();

const showToast = () => {
  addToast({
    type: 'success',
    title: 'Success!',
    message: 'Operation completed successfully.',
    duration: 5000,
    action: {
      label: 'Undo',
      onClick: handleUndo
    }
  });
};
```

## Styling and Theming

All components use Tailwind CSS for styling and follow a consistent design system:

### Colors
- **Primary**: Blue (#3B82F6) for main actions
- **Secondary**: Slate (#64748B) for secondary elements
- **Success**: Green (#10B981) for positive feedback
- **Warning**: Amber (#F59E0B) for warnings
- **Error**: Red (#EF4444) for errors

### Typography
- **Font Family**: Inter for excellent readability
- **Font Weights**: 400 (normal), 500 (medium), 600 (semibold), 700 (bold)

### Spacing
- Components use consistent spacing with Tailwind's spacing scale
- Form elements have proper touch targets (minimum 44px)

## Accessibility

All components are built with accessibility in mind:

- Proper ARIA labels and roles
- Keyboard navigation support
- Focus management
- Screen reader compatibility
- Color contrast compliance (WCAG 2.1 AA)

## Responsive Design

Components are mobile-first and responsive:

- Touch-friendly interactions on mobile
- Adaptive layouts for different screen sizes
- Proper breakpoints for tablet and desktop

## Usage Examples

See `ComponentShowcase.tsx` for a comprehensive example of all components working together.

## Dependencies

The component library requires:

- React 18+
- TypeScript
- Tailwind CSS
- clsx (for conditional classes)
- tailwind-merge (for class merging)

## Best Practices

1. **Consistent Styling**: Use the provided variants and sizes rather than custom classes
2. **Error Handling**: Always provide meaningful error messages for form components
3. **Loading States**: Use loading indicators for async operations
4. **Accessibility**: Include proper labels and ARIA attributes
5. **Responsive Design**: Test components on different screen sizes
6. **Toast Notifications**: Use appropriate toast types for different scenarios
