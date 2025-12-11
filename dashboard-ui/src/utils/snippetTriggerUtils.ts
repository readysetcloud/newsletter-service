import type { Snippet } from '@/types/template';

export interface SnippetTrigger {
  trigger: string;
  snippet: Snippet;
  description?: string;
}

export interface TriggerMatch {
  trigger: string;
  snippet: Snippet;
  startPosition: number;
  endPosition: number;
  query: string;
}

export class SnippetTriggerUtils {
  private static readonly TRIGGER_PREFIX = '/';
  private static readonly TRIGGER_PATTERN = /\/([a-zA-Z0-9_-]+)$/;

  /**
   * Generate triggers for snippets
   */
  static generateTriggers(snippets: Snippet[]): SnippetTrigger[] {
    return snippets.map(snippet => ({
      trigger: `${this.TRIGGER_PREFIX}${snippet.name}`,
      snippet,
      description: snippet.description
    }));
  }

  /**
   * Check if text contains a trigger pattern at the cursor position
   */
  static findTriggerAtPosition(
    text: string,
    cursorPosition: number
  ): { trigger: string; startPosition: number; endPosition: number } | null {
    // Look backwards from cursor position to find trigger pattern
    const textBeforeCursor = text.substring(0, cursorPosition);
    const match = textBeforeCursor.match(this.TRIGGER_PATTERN);

    if (match) {
      const triggerText = match[0];
      const startPosition = cursorPosition - triggerText.length;

      return {
        trigger: triggerText,
        startPosition,
        endPosition: cursorPosition
      };
    }

    return null;
  }

  /**
   * Find matching snippets for a trigger query
   */
  static findMatchingSnippets(
    query: string,
    snippets: Snippet[],
    maxResults: number = 10
  ): TriggerMatch[] {
    if (!query.startsWith(this.TRIGGER_PREFIX)) {
      return [];
    }

    const searchTerm = query.substring(1).toLowerCase(); // Remove the '/' prefix
    const matches: TriggerMatch[] = [];

    for (const snippet of snippets) {
      const snippetName = snippet.name.toLowerCase();
      const snippetDescription = (snippet.description || '').toLowerCase();

      // Exact name match (highest priority)
      if (snippetName === searchTerm) {
        matches.unshift({
          trigger: `${this.TRIGGER_PREFIX}${snippet.name}`,
          snippet,
          startPosition: 0,
          endPosition: query.length,
          query
        });
        continue;
      }

      // Name starts with search term
      if (snippetName.startsWith(searchTerm)) {
        matches.push({
          trigger: `${this.TRIGGER_PREFIX}${snippet.name}`,
          snippet,
          startPosition: 0,
          endPosition: query.length,
          query
        });
        continue;
      }

      // Name contains search term
      if (snippetName.includes(searchTerm)) {
        matches.push({
          trigger: `${this.TRIGGER_PREFIX}${snippet.name}`,
          snippet,
          startPosition: 0,
          endPosition: query.length,
          query
        });
        continue;
      }

      // Description contains search term
      if (searchTerm.length >= 2 && snippetDescription.includes(searchTerm)) {
        matches.push({
          trigger: `${this.TRIGGER_PREFIX}${snippet.name}`,
          snippet,
          startPosition: 0,
          endPosition: query.length,
          query
        });
      }
    }

    // Sort by relevance (exact matches first, then by name length)
    matches.sort((a, b) => {
      const aName = a.snippet.name.toLowerCase();
      const bName = b.snippet.name.toLowerCase();

      // Exact matches first
      if (aName === searchTerm && bName !== searchTerm) return -1;
      if (bName === searchTerm && aName !== searchTerm) return 1;

      // Then by name length (shorter names are more relevant)
      if (aName.length !== bName.length) {
        return aName.length - bName.length;
      }

      // Finally alphabetical
      return aName.localeCompare(bName);
    });

    return matches.slice(0, maxResults);
  }

  /**
   * Replace trigger with snippet syntax
   */
  static replaceTriggerWithSnippet(
    text: string,
    triggerMatch: { startPosition: number; endPosition: number },
    snippet: Snippet,
    parameters: Record<string, any> = {}
  ): { newText: string; cursorPosition: number } {
    const beforeTrigger = text.substring(0, triggerMatch.startPosition);
    const afterTrigger = text.substring(triggerMatch.endPosition);

    // Generate snippet syntax
    let snippetSyntax = `{{> ${snippet.name}`;

    if (snippet.parameters && snippet.parameters.length > 0) {
      const paramStrings = snippet.parameters.map(param => {
        const value = parameters[param.name] !== undefined
          ? parameters[param.name]
          : param.defaultValue;

        if (value !== undefined) {
          return `${param.name}="${value}"`;
        }
        return null;
      }).filter(Boolean);

      if (paramStrings.length > 0) {
        snippetSyntax += ` ${paramStrings.join(' ')}`;
      }
    }

    snippetSyntax += '}}';

    const newText = beforeTrigger + snippetSyntax + afterTrigger;
    const cursorPosition = beforeTrigger.length + snippetSyntax.length;

    return { newText, cursorPosition };
  }

  /**
   * Check if a character should trigger snippet suggestions
   */
  static shouldTriggerSuggestions(char: string, previousChar?: string): boolean {
    // Trigger on '/' at word boundary or start of line
    if (char === this.TRIGGER_PREFIX) {
      return !previousChar || /\s/.test(previousChar);
    }

    return false;
  }

  /**
   * Extract trigger context from text at position
   */
  static getTriggerContext(
    text: string,
    position: number
  ): {
    isInTrigger: boolean;
    triggerText: string;
    triggerStart: number;
    triggerEnd: number;
  } {
    const triggerMatch = this.findTriggerAtPosition(text, position);

    if (triggerMatch) {
      return {
        isInTrigger: true,
        triggerText: triggerMatch.trigger,
        triggerStart: triggerMatch.startPosition,
        triggerEnd: triggerMatch.endPosition
      };
    }

    return {
      isInTrigger: false,
      triggerText: '',
      triggerStart: -1,
      triggerEnd: -1
    };
  }

  /**
   * Validate trigger format
   */
  static isValidTrigger(trigger: string): boolean {
    return this.TRIGGER_PATTERN.test(trigger);
  }

  /**
   * Get trigger help text
   */
  static getTriggerHelpText(): string {
    return `Type "${this.TRIGGER_PREFIX}" followed by a snippet name for quick insertion (e.g., "${this.TRIGGER_PREFIX}header")`;
  }

  /**
   * Format trigger for display
   */
  static formatTriggerForDisplay(trigger: string): string {
    return trigger.startsWith(this.TRIGGER_PREFIX) ? trigger : `${this.TRIGGER_PREFIX}${trigger}`;
  }
}

export default SnippetTriggerUtils;
