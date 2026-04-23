import { useMemo, useState } from 'react';

// Generic file list with list/tree modes. Used by both the sidebar Changes
// section and the right-pane DiffPanel file lists so they share behavior.
//
// Props:
//   files         — array of { path, ...meta }
//   mode          — 'list' | 'tree'
//   isSelected    — (file) => bool
//   onSelect      — (file) => void
//   rowClass      — className applied to each file row (caller supplies
//                   existing style, e.g. "change-row" or "file-item")
//   renderRow     — (file, { label }) => row inner JSX; `label` is the path
//                   (list) or the leaf filename (tree)
// Tree layout: chevron/spacer hug the left edge so the root is furthest left,
// and each level of depth pushes the row right by TREE_INDENT. The file row's
// spacer has the same width as a directory chevron, so directory names and
// file names at the same depth align vertically.
const TREE_BASE_PADDING = 6;
const TREE_INDENT = 12;

export default function FileList({
  files, mode, isSelected, onSelect, rowClass, renderRow,
}) {
  if (mode === 'tree') {
    return (
      <TreeView
        files={files}
        isSelected={isSelected}
        onSelect={onSelect}
        rowClass={rowClass}
        renderRow={renderRow}
      />
    );
  }
  return (
    <>
      {files.map(f => (
        <FileRow
          key={f.path}
          file={f}
          label={f.path}
          depth={0}
          tree={false}
          selected={isSelected?.(f)}
          onSelect={onSelect}
          rowClass={rowClass}
          renderRow={renderRow}
        />
      ))}
    </>
  );
}

function FileRow({ file, label, depth, tree, selected, onSelect, rowClass, renderRow }) {
  const style = tree
    ? { paddingLeft: TREE_BASE_PADDING + depth * TREE_INDENT }
    : undefined;
  return (
    <div
      className={`${rowClass} ${selected ? 'selected' : ''}`}
      style={style}
      onClick={() => onSelect?.(file)}
      title={file.path}
    >
      {tree && <span className="file-tree-spacer" aria-hidden="true" />}
      {renderRow(file, { label })}
    </div>
  );
}

function DirRow({ label, depth, open, onToggle }) {
  const style = { paddingLeft: TREE_BASE_PADDING + depth * TREE_INDENT };
  return (
    <div className="file-tree-dir" style={style} onClick={onToggle}>
      <span className="chevron">{open ? '▾' : '▸'}</span>
      <span className="name">{label}</span>
    </div>
  );
}

function TreeView({ files, isSelected, onSelect, rowClass, renderRow }) {
  const root = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState(() => new Set());

  function toggle(path) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  return <>{renderNode(root, 0)}</>;

  function renderNode(node, depth) {
    const out = [];
    for (const child of sortedEntries(node)) {
      if (child.file) {
        out.push(
          <FileRow
            key={child.path}
            file={child.file}
            label={child.name}
            depth={depth}
            tree={true}
            selected={isSelected?.(child.file)}
            onSelect={onSelect}
            rowClass={rowClass}
            renderRow={renderRow}
          />,
        );
        continue;
      }
      // Directory: walk single-child directory chain and merge names.
      let cur = child;
      let label = cur.name;
      while (true) {
        const kids = sortedEntries(cur);
        if (kids.length === 1 && !kids[0].file) {
          cur = kids[0];
          label += '/' + cur.name;
        } else break;
      }
      const open = !collapsed.has(cur.path);
      out.push(
        <DirRow
          key={cur.path}
          label={label}
          depth={depth}
          open={open}
          onToggle={() => toggle(cur.path)}
        />,
      );
      if (open) out.push(...renderNode(cur, depth + 1));
    }
    return out;
  }
}

function buildTree(files) {
  const root = { name: '', path: '', children: new Map(), file: null };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const childPath = node.path ? `${node.path}/${part}` : part;
      if (isLast) {
        node.children.set(part, { name: part, path: childPath, children: new Map(), file: f });
      } else {
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, path: childPath, children: new Map(), file: null });
        }
        node = node.children.get(part);
      }
    }
  }
  return root;
}

function sortedEntries(node) {
  return [...node.children.values()].sort((a, b) => {
    const aDir = !a.file;
    const bDir = !b.file;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
