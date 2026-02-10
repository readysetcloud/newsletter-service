import React, { useState, useEffect } from 'react';
import { QuickNavigation, defaultSectionIcons } from './QuickNavigation';
import { CollapsibleSection } from './CollapsibleSection';
import { useScrollTracking } from '../../hooks/useScrollTracking';
import type { NavigationSection } from './QuickNavigation';

export const QuickNavigationExample: React.FC = () => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['engagement']));
  const [stickyNavVisible, setStickyNavVisible] = useState(false);

  const { activeSection, scrollToSection, registerSection } = useScrollTracking({
    threshold: 0.5,
    rootMargin: '-100px 0px -50% 0px',
    smoothScroll: true,
  });

  const sections: NavigationSection[] = [
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
    {
      id: 'deliverability',
      label: 'Deliverability',
      icon: defaultSectionIcons.deliverability,
      hasData: true,
    },
  ];

  useEffect(() => {
    const handleScroll = () => {
      setStickyNavVisible(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSectionToggle = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-4">Issue Detail Page</h1>
        <div className="bg-surface rounded-lg border p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Key Metrics</h2>
        </div>
      </div>
      <QuickNavigation
        sections={sections}
        activeSection={activeSection}
        onSectionClick={scrollToSection}
        isSticky={stickyNavVisible}
      />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div ref={(el) => registerSection('engagement', el)}>
          <CollapsibleSection
            id="engagement"
            title="Engagement Analytics"
            icon={defaultSectionIcons.engagement}
            isExpanded={expandedSections.has('engagement')}
            onToggle={handleSectionToggle}
          >
            <p>Content</p>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
};

export default QuickNavigationExample;
