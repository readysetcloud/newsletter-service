import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  ListsToggle,
  InsertThematicBreak,
  Separator,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { cn } from '../../utils/cn';

export interface MarkdownWysiwygEditorHandle {
  /** Insert markdown at the current cursor position (used by the snippet inserter). */
  insert: (markdown: string) => void;
}

export interface MarkdownWysiwygEditorProps {
  /** Current markdown value (used to seed the editor). */
  value: string;
  /** Called with the updated markdown whenever the document changes. */
  onChange: (markdown: string) => void;
  /** Called when the editor loses focus (mirrors textarea onBlur). */
  onBlur?: () => void;
  /** Disables editing (e.g. for published/scheduled issues). */
  disabled?: boolean;
  /** Placeholder text shown when the editor is empty. */
  placeholder?: string;
  /** id applied to the underlying contenteditable for label association. */
  id?: string;
}

/**
 * Observes the document's active theme (`data-theme` on <html>) so the editor
 * can switch between MDXEditor's light and dark styling in step with the app.
 */
const useDocumentTheme = (): 'light' | 'dark' => {
  const read = (): 'light' | 'dark' =>
    (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark')
      ? 'dark'
      : 'light';

  const [theme, setTheme] = useState<'light' | 'dark'>(read);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
};

/**
 * A WYSIWYG markdown editor built on MDXEditor. Authors edit rich text while the
 * value is stored as plain markdown, which is what the publish pipeline expects.
 *
 * MDXEditor is uncontrolled after mount: the `value` prop seeds the initial
 * document and external value changes (e.g. loading an issue for edit) are
 * pushed in through the imperative ref.
 */
export const MarkdownWysiwygEditor = forwardRef<
  MarkdownWysiwygEditorHandle,
  MarkdownWysiwygEditorProps
>(({
  value,
  onChange,
  onBlur,
  disabled = false,
  placeholder = 'Write your newsletter content…',
  id,
}, ref) => {
  const editorRef = useRef<MDXEditorMethods>(null);
  const theme = useDocumentTheme();

  useImperativeHandle(ref, () => ({
    insert: (markdown: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.insertMarkdown(markdown);
    },
  }));

  // Keep the editor in sync when the value is replaced from outside (initial
  // load, programmatic reset) without clobbering in-progress typing.
  useEffect(() => {
    const current = editorRef.current?.getMarkdown();
    if (editorRef.current && current !== undefined && current !== value) {
      editorRef.current.setMarkdown(value ?? '');
    }
  }, [value]);

  return (
    <div
      id={id}
      onBlur={onBlur}
      className={cn(
        'rounded-lg border border-border bg-background overflow-hidden',
        'focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent',
        disabled && 'opacity-50 pointer-events-none'
      )}
    >
      <MDXEditor
        ref={editorRef}
        markdown={value ?? ''}
        onChange={onChange}
        readOnly={disabled}
        placeholder={placeholder}
        contentEditableClassName="mdx-content min-h-[300px] prose prose-sm max-w-none"
        className={cn('mdx-editor', theme === 'dark' && 'dark-theme dark-editor')}
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles />
                <Separator />
                <BlockTypeSelect />
                <Separator />
                <ListsToggle />
                <Separator />
                <CreateLink />
                <InsertThematicBreak />
              </>
            ),
          }),
        ]}
      />
    </div>
  );
});

MarkdownWysiwygEditor.displayName = 'MarkdownWysiwygEditor';
