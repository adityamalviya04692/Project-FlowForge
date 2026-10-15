import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { sql, StandardSQL } from '@codemirror/lang-sql';
import { basicSetup, EditorView } from 'codemirror';

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-content': { fontFamily: 'var(--mono)' },
  '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
}, { dark: true });

/** Read-only, syntax-highlighted code. */
export default function CodeView({ code, lang }: { code: string; lang: 'sql' | 'python' | 'text' }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: code,
        extensions: [basicSetup, ...(lang === 'sql' ? [sql({ dialect: StandardSQL, upperCaseKeywords: true })] : lang === 'python' ? [python()] : []), EditorState.readOnly.of(true), EditorView.editable.of(false), theme],
      }),
    });
    return () => view.destroy();
  }, [code, lang]);
  return <div className="cm-host" ref={host} />;
}
