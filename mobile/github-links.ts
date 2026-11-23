export function githubLink(repo: string, commit?: string, path?: string, line?: number): string | undefined {
  const validPart = (part: string) => /^[\w.@+-]+$/.test(part) && part !== '.' && part !== '..';
  const names = repo.split('/');
  if (names.length !== 2 || names.some(part => !validPart(part))) return;
  const base = 'https://github.com/' + names.map(encodeURIComponent).join('/');
  if (!commit) return path === undefined && line === undefined ? base : undefined;
  if (!/^[a-f0-9]{40}$/.test(commit)) return;
  if (path === undefined) return line === undefined ? base + '/commit/' + commit : undefined;
  const parts = path.split('/');
  if (parts.some(part => !validPart(part)) || (line !== undefined && (!Number.isSafeInteger(line) || line < 1))) return;
  return base + '/blob/' + commit + '/' + parts.map(encodeURIComponent).join('/') + (line ? '#L' + line : '');
}
