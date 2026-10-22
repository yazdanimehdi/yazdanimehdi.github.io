import { SITE_MEDIA, assertAllowed, assertMediaPath, isMediaPath } from './paths';
import { adminSettings } from './settings';
import type { CommitResult, ContentStore, MediaFile, MediaFolder, UploadResult } from './store';

const IMAGE = /\.(png|jpe?g|webp|gif|avif|svg|ico)$/i;

/** The repo folder and URL prefix of a media folder. */
export function mediaFolder(folder: MediaFolder): { dir: string; url: string } {
  return folder === 'content' ? { dir: adminSettings().mediaFolder, url: adminSettings().publicFolder } : SITE_MEDIA;
}

/** The repo path of a PDF the site folder serves at `url` (`/images/…`), or null for any other URL. */
export function sitePdfPath(url: string): string | null {
  const prefix = `${SITE_MEDIA.url}/`;
  if (!url.startsWith(prefix)) return null;
  const path = `${SITE_MEDIA.dir}/${url.slice(prefix.length)}`;
  return /\.pdf$/i.test(path) && isMediaPath(path) ? path : null;
}

/** Media as files in the repo: the git-backed stores (GitHub, memory) share this. */
export async function listRepoMedia(store: ContentStore, folder: MediaFolder): Promise<MediaFile[]> {
  const { dir, url } = mediaFolder(folder);
  return (await store.list(dir))
    .filter((f) => IMAGE.test(f.path))
    .map((f) => ({ path: f.path, version: f.version, url: url + f.path.slice(dir.length) }));
}

export async function putRepoMedia(
  store: ContentStore,
  folder: MediaFolder,
  filename: string,
  base64: string,
): Promise<UploadResult> {
  const { dir, url: prefix } = mediaFolder(folder);
  const path = `${dir}/${filename}`;
  const url = `${prefix}/${filename}`;
  assertAllowed(path);
  // The name carries a content hash: the same image is already there, nothing to commit.
  const existing = (await store.list(dir)).find((f) => f.path === path);
  if (existing) return { path, url, version: existing.version, commit: null };
  const result = await store.commit([{ path, content: base64, encoding: 'base64' }], `Upload ${path}`, {
    [path]: null,
  });
  return { path, url, version: result.versions[path] ?? '', commit: { id: result.id, url: result.url } };
}

export async function deleteRepoMedia(store: ContentStore, path: string, version: string): Promise<CommitResult> {
  const file = assertMediaPath(path);
  return store.commit([{ path: file, content: null }], `Delete ${file}`, { [file]: version });
}
