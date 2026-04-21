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
    const lines = (content || '').split('\n');
    return (
      <div className="diff-pane">
        <DiffHeader title={title} meta={`${meta || ''} · untracked`.trim()} />
        <div className="diff-content">
          {lines.map((line, i) => (
            <div key={i} className="diff-line add">
              <span className="ln ln-old" />
              <span className="ln ln-new">{i + 1}</span>
              <span className="code">+ {line || ' '}</span>
            </div>
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

const HUNK_RE = /@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

export function DiffLines({ text }) {
  const rawLines = (text || '').split('\n');
  let oldNo = 0;
  let newNo = 0;
  const rendered = rawLines.map((line, i) => {
    let cls = '';
    let oldLabel = '';
    let newLabel = '';
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      cls = 'file';
    } else if (line.startsWith('@@')) {
      cls = 'hunk';
      const m = HUNK_RE.exec(line);
      if (m) {
        oldNo = parseInt(m[1], 10);
        newNo = parseInt(m[2], 10);
      }
    } else if (line.startsWith('+')) {
      cls = 'add';
      newLabel = String(newNo++);
    } else if (line.startsWith('-')) {
      cls = 'del';
      oldLabel = String(oldNo++);
    } else if (line.length === 0 && i === rawLines.length - 1) {
      // 末尾 diff 文本通常以换行结尾，split 后尾部多出一个空串，忽略
      return null;
    } else {
      oldLabel = String(oldNo++);
      newLabel = String(newNo++);
    }
    return (
      <div key={i} className={`diff-line ${cls}`}>
        <span className="ln ln-old">{oldLabel}</span>
        <span className="ln ln-new">{newLabel}</span>
        <span className="code">{line || ' '}</span>
      </div>
    );
  });
  return <div className="diff-content">{rendered}</div>;
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
