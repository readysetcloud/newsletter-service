/* eslint-disable react/prop-types */
import React from 'react';
import { cn } from '../../utils/cn';

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
  const formatMarkdown = (text: string): string => {
    let formatted = text;

    formatted = formatted.replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-6 mb-3 text-foreground">$1</h3>');
    formatted = formatted.replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-8 mb-4 text-foreground">$1</h2>');
    formatted = formatted.replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-8 mb-4 text-foreground">$1</h1>');

    formatted = formatted.replace(/\*\*\*(.+?)\*\*\*/g, '<strong class="font-bold"><em class="italic">$1</em></strong>');
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold">$1</strong>');
    formatted = formatted.replace(/\*(.+?)\*/g, '<em class="italic">$1</em>');

    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary-600 hover:text-primary-700 underline decoration-primary-300 hover:decoration-primary-500 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded" target="_blank" rel="noopener noreferrer">$1</a>');

    formatted = formatted.replace(/^- (.+)$/gim, '<li class="ml-4 text-foreground">$1</li>');
    formatted = formatted.replace(/(<li.*<\/li>)/s, '<ul class="list-disc space-y-2 my-4 pl-4">$1</ul>');

    formatted = formatted.replace(/^> (.+)$/gim, '<blockquote class="border-l-4 border-primary-500 pl-4 py-2 italic my-4 text-muted-foreground bg-muted/30 rounded-r">$1</blockquote>');

    formatted = formatted.replace(/`([^`]+)`/g, '<code class="bg-muted px-2 py-0.5 rounded text-sm font-mono text-foreground border border-border">$1</code>');

    formatted = formatted.replace(/\n\n/g, '</p><p class="mb-4 text-foreground leading-relaxed">');
    formatted = `<p class="mb-4 text-foreground leading-relaxed">${formatted}</p>`;

    return formatted;
  };

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
