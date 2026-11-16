// Bun inlines `import x from './file.md' with { type: 'text' }` as a string.
declare module '*.md' {
  const text: string;
  export default text;
}
