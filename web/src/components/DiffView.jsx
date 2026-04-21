export default function DiffView({ title, meta, diff, empty, untracked, content, binary }) {
  if (binary) {
    return (
      <div className="diff-pane">
        <DiffHeader title={title} meta={meta} />
        <div className="diff-empty">二进制文件，不显示差异。</div>
      </div>
    );
  }

  if (untracked) {
    return (
      <div className="diff-pane">
        <DiffHeader title={title} meta={`${meta || ''} · untracked`.trim()} />
        <div className="diff-content">
          {(content || '').split('\n').map((line, i) => (
            <span key={i} className="diff-line add">+ {line}</span>
          ))}
        </div>
      </div>
    );
  }

  if (!diff || !diff.trim()) {
    return (
      <div className="diff-pane">
        <DiffHeader title={title} meta={meta} />
        <div className="diff-empty">{empty || '无差异'}</div>
      </div>
    );
  }

  return (
    <div className="diff-pane">
      <DiffHeader title={title} meta={meta} />
      <DiffLines text={diff} />
    </div>
  );
}

export function DiffLines({ text }) {
  const lines = (text || '').split('\n').map((line, i) => {
    let cls = '';
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) cls = 'file';
    else if (line.startsWith('@@')) cls = 'hunk';
    else if (line.startsWith('+')) cls = 'add';
    else if (line.startsWith('-')) cls = 'del';
    return <span key={i} className={`diff-line ${cls}`}>{line || ' '}</span>;
  });
  return <div className="diff-content">{lines}</div>;
}

function DiffHeader({ title, meta }) {
  if (!title && !meta) return null;
  return (
    <div className="diff-header">
      {title && <div className="title">{title}</div>}
      {meta && <div className="meta">{meta}</div>}
    </div>
  );
}
