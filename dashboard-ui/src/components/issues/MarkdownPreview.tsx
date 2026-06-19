import React from 'react';
import { cn } from '../../utils/cn';
import { formatMarkdown } from '../../utils/markdown';

/**
 * Props for the MarkdownPreview component
 */
export interface MarkdownPreviewProps {
  /** The markdown content to render as formatted HTML */
  content: string;
  /** Optional additional CSS classes to apply to the preview container */
  className?: string;
}

/**
 * Component that renders markdown content as formatted HTML
 * Supports headings, bold, italic, links, lists, blockquotes, and inline code
 * Uses a simple regex-based parser for basic markdown formatting
 */
export const MarkdownPreview: React.FC<MarkdownPreviewProps> = React.memo(({ content, className }) => {
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none',
        'text-foreground',
        '[&_h1]:text-foreground [&_h2]:text-foreground [&_h3]:text-foreground',
        '[&_p]:text-foreground [&_li]:text-foreground',
        className
      )}
      dangerouslySetInnerHTML={{ __html: formatMarkdown(content) }}
    />
  );
});

MarkdownPreview.displayName = 'MarkdownPreview';
