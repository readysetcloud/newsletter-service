# QuickNavigation Component

## Overview

The `QuickNavigation` component provides a sticky navigation bar for the Issue Detail Page redesign. It allows users to quickly jump between different sections of the page with smooth scrolling and automatic active section highlighting.

## Features

- **Sticky Behavior**: Becomes sticky after scrolling past the key metrics section
- **Active Section Highlighting**: Automatically highlights the currently visible section
- **Smooth Scrolling**: Smoothly scrolls to sections when navigation links are clicked
- **Mobile Responsive**: Converts to a dropdown menu on mobile devices
- **Accessibility**: Full keyboard navigation and ARIA support
- **Data-Aware**: Only shows sections that have data available

## Components

### QuickNavigation

Main navigation component with sticky behavior.

**Props:**
- `sections`: Array of navigation sections to display
- `activeSection`: Currently active section ID
- `onSectionClick`: Callback when a section is clicked
- `isSticky`: Whether the navigation should be sticky
- `className`: Optional additional CSS classes

### useScrollTracking Hook

Custom hook for tracking scroll position and managing section visibility using Intersection Observer.

**Features:**
- Tracks which section is currently in viewport
- Provides smooth scrolling to sections
- Handles section registration and cleanup
- Prevents active section updates during programmatic scrolling

**API:**
```typescript
const {
  activeSection,      // Currently active section ID
  scrollToSection,    // Function to scroll to a section
  registerSection,    // Register a section for tracking
  unregisterSection   // Unregister a section
} = useScrollTracking({
  threshold: 0.5,
  rootMargin: '-100px 0px -50% 0px',
  smoothScroll: true
});
```

## Usage Example

```tsx
import { QuickNavigation, defaultSectionIcons } from './components/issues/QuickNavigation';
import { useScrollTracking } from './hooks/useScrollTracking';

function IssueDetailPage() {
  const [stickyNavVisible, setStickyNavVisible] = useState(false);

  const { activeSection, scrollToSection, registerSection } = useScrollTracking({
    threshold: 0.5,
    rootMargin: '-100px 0px -50% 0px',
  });

  const sections = [
    {
      id: 'engagement',
      label: 'Engagement Analytics',
      icon: defaultSectionIcons.engagement,
      hasData: true,
    },
    {
      id: 'audience',
      label: 'Audience Insights',
      icon: defaultSectionIcons.audience,
      hasData: true,
    },
  ];

  // Track scroll for sticky behavior
  useEffect(() => {
    const handleScroll = () => {
      setStickyNavVisible(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div>
      {/* Key Metrics Section */}
      <div>...</div>

      {/* Quick Navigation */}
      <QuickNavigation
        sections={sections}
        activeSection={activeSection}
        onSectionClick={scrollToSection}
        isSticky={stickyNavVisible}
      />

      {/* Content Sections */}
      <div ref={(el) => registerSection('engagement', el)}>
        <CollapsibleSection id="engagement" title="Engagement Analytics">
          {/* Content */}
        </CollapsibleSection>
      </div>

      <div ref={(el) => registerSection('audience', el)}>
        <CollapsibleSection id="audience" title="Audience Insights">
          {/* Content */}
        </CollapsibleSection>
      </div>
    </div>
  );
}
```

## Default Section Icons

The component exports default icons for common sections:

```typescript
import { defaultSectionIcons } from './components/issues/QuickNavigation';

// Available icons:
// - defaultSectionIcons.engagement (TrendingUp)
// - defaultSectionIcons.audience (Users)
// - defaultSectionIcons.deliverability (Shield)
// - defaultSectionIcons.content (FileText)
```

## Accessibility

- Full keyboard navigation support (Tab, Enter, Space, Escape)
- ARIA labels and roles for screen readers
- Focus management and visual focus indicators
- Semantic HTML structure

## Mobile Behavior

On mobile devices (< 640px):
- Navigation converts to a dropdown menu
- Shows currently active section in the dropdown button
- Dropdown closes on selection or outside click
- Supports Escape key to close dropdown

## Desktop Behavior

On desktop devices (≥ 640px):
- Horizontal navigation bar with all sections visible
- Active section highlighted with background color
- Smooth hover effects
- Sticky positioning after scrolling past threshold

## Styling

The component uses Tailwind CSS classes and follows the existing design system:
- Primary colors for active states
- Muted colors for inactive states
- Smooth transitions for all interactive elements
- Responsive spacing and sizing

## Requirements Validated

This implementation validates the following requirements from the design document:

- **Requirement 7.1**: Sticky navigation or quick-jump menu for accessing different sections
- **Requirement 7.2**: Highlights current section in navigation when scrolling
- **Requirement 7.3**: Provides smooth scrolling when jumping to sections via navigation

## Files Created

1. `dashboard-ui/src/components/issues/QuickNavigation.tsx` - Main component
2. `dashboard-ui/src/hooks/useScrollTracking.ts` - Scroll tracking hook
3. `dashboard-ui/src/components/issues/QuickNavigation.example.tsx` - Usage example
4. `dashboard-ui/src/components/issues/QuickNavigation.README.md` - This documentation

## Next Steps

To integrate this component into the Issue Detail Page:

1. Import the component and hook
2. Define your sections with appropriate icons and data availability
3. Set up scroll tracking for sticky behavior
4. Register each section using the `registerSection` function
5. Pass the sections, active section, and click handler to QuickNavigation

See `QuickNavigation.example.tsx` for a complete working example.
