/** Exported names: JS and TS `export` statements, Python top-level `def` and `class`, Go capitalised `func` and `type`, Rust `pub` items. */
const EXPORTS = [
  /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|abstract\s+class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/,
  /^(?:async\s+)?def\s+([A-Za-z]\w*)|^class\s+([A-Za-z]\w*)/,
  /^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)|^type\s+([A-Z]\w*)/,
  /^\s*pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const|static)\s+([A-Za-z_]\w*)/,
];
const EXPORT_LIST = /^\s*export\s+(?:type\s+)?\{([^}]*)\}/;

/** The names a line of code exports, if any. */
export function exportNames(line: string): string[] {
  const list = EXPORT_LIST.exec(line);
  if (list)
    return list[1]!
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/).pop()!.replace(/^type\s+/, ''))
      .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default');
  return EXPORTS.flatMap((r) => r.exec(line)?.slice(1).filter(Boolean) ?? []) as string[];
}
