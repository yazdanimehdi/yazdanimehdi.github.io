/** Publish's commit message when the admin leaves it empty; the screen prefills the same text. */
export function defaultCommitMessage(requests: string[]): string {
  const first = requests[0]?.replace(/\s+/g, ' ').trim() || 'changes';
  return `Site editor: ${first.length > 72 ? `${first.slice(0, 71)}…` : first}`;
}
