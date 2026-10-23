// The owner's research as the scorer reads it: research.yml areas and the publications collection, through the store.
import { listEntries, readConfig } from '../admin/content';
import type { PostgresStore } from '../admin/postgres-store';
import type { ReadingPrefs } from './settings';

const MAX_PAPERS = 40;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export async function readProfile(store: PostgresStore): Promise<{
  areas: { title: string; description: string; tags: string[] }[];
  pubs: { title: string; topic?: string; abstract?: string }[];
}> {
  const [research, entries] = await Promise.all([readConfig(store, 'research'), listEntries(store, 'publications')]);
  const areas = (Array.isArray(research.data.areas) ? research.data.areas : []).flatMap(
    (a: Record<string, unknown>) => {
      const title = str(a?.title);
      if (!title) return [];
      const tags = Array.isArray(a.tags) ? a.tags.flatMap((t) => str(t) ?? []) : [];
      return [{ title, description: str(a.description) ?? '', tags }];
    },
  );
  const pubs = entries.flatMap(({ data }) => {
    const title = str(data.title);
    return title ? [{ title, topic: str(data.topic), abstract: str(data.abstract) }] : [];
  });
  return { areas, pubs };
}

/** Field, keywords, research areas, then at most 40 of the owner's paper titles. */
export function profileText(prefs: ReadingPrefs, profile: Awaited<ReturnType<typeof readProfile>>): string {
  return [
    prefs.field && `Field: ${prefs.field}`,
    prefs.keywords.length && `Keywords: ${prefs.keywords.join(', ')}`,
    profile.areas.length &&
      `Research areas:\n${profile.areas.map((a) => `- ${a.title}${a.description ? `: ${a.description}` : ''}`).join('\n')}`,
    profile.pubs.length &&
      `The owner's papers:\n${profile.pubs
        .slice(0, MAX_PAPERS)
        .map((p) => `- ${p.title}`)
        .join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
