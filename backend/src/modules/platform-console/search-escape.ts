// Escapes LIKE metacharacters for the platform search functions, which use
// ESCAPE '\'. The backslash itself is escaped first-class in one pass.
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}
