import { entryChange, readConfig, readEntry } from '../../../../../lib/admin/content';
import { HttpError, commitChanges, json, readBody, route } from '../../../../../lib/admin/http';
import { MediumError, crossPost, mediumPayload } from '../../../../../lib/admin/medium';
import { assertSlug } from '../../../../../lib/admin/paths';
import type { ContentStore } from '../../../../../lib/admin/store';
import { isPublished } from '../../../../../lib/utils';

export const prerender = false;

/**
 * Git mode: GitHub can serve the file from just before the editor's save (or not at all, for a brand-new post); wait
 * briefly for that save's version. Still missing after the wait → null (404).
 */
async function readEntryAt(
  store: ContentStore,
  slug: string,
  version: string | undefined,
  { tries = 3, delayMs = 500 } = {},
) {
  for (let i = 0; ; i++) {
    const entry = await readEntry(store, 'posts', slug);
    if (version === undefined || entry?.version === version) return entry;
    if (i === tries - 1) {
      if (!entry) return entry;
      throw new HttpError(409, 'The post is still saving; try again in a moment');
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

/** "Also publish to Medium" (token path) and its Retry: a Medium draft of a published post, linked in its front matter. */
export const POST = route(async (ctx, store) => {
  const slug = assertSlug(ctx.params.slug);
  const token = process.env.MEDIUM_TOKEN;
  if (!token) throw new HttpError(400, 'MEDIUM_TOKEN is not set: use "Import to Medium" instead');
  const { version } = await readBody<{ version?: unknown }>(ctx).catch(() => ({ version: undefined }));
  const entry = await readEntryAt(store, slug, typeof version === 'string' ? version : undefined);
  if (!entry) throw new HttpError(404, 'Not found');
  if (entry.readonly) throw new HttpError(409, `posts/${slug} is MDX and can only be edited in the repository`);
  if (entry.data.draft) throw new HttpError(400, 'Publish the post before sending it to Medium');
  if (!isPublished({ data: entry.data as { date: string } })) {
    const raw = String(entry.data.date);
    const day = Number.isNaN(Date.parse(raw)) ? raw : new Date(raw).toISOString().slice(0, 10);
    throw new HttpError(400, `Send this post to Medium once it is live (${day})`);
  }
  const existing = (entry.data.medium as { url?: string } | undefined)?.url;
  if (existing) throw new HttpError(409, `Already on Medium: ${existing}`, { url: existing });

  const site = await readConfig(store, 'site');
  const postUrl = `${String(site.data.siteUrl || ctx.url.origin).replace(/\/$/, '')}/blog/${slug}/`;
  let medium: { id: string; url: string };
  try {
    medium = await crossPost(token, mediumPayload(entry.data as { title: string }, entry.body, postUrl));
  } catch (e) {
    throw new HttpError(
      502,
      e instanceof MediumError ? e.message : `Medium could not be reached: ${(e as Error).message}`,
    );
  }
  try {
    // Inside the try: a schema error here still reports the URL of the draft Medium already accepted.
    const change = entryChange('posts', slug, { ...entry.data, medium }, entry.body);
    const commit = await commitChanges(store, [change], `Link posts/${slug} to Medium`, {
      [change.path]: entry.version,
    });
    return json({ medium, ...commit });
  } catch (e) {
    throw new HttpError(
      502,
      `Sent to Medium (${medium.url}), but saving the link failed: ${(e as Error).message}. Paste the link into "Medium URL".`,
      { url: medium.url },
    );
  }
});
