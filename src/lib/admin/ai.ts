import { toAnimatedWebp } from '../ai/animate';
import { MOTION_PROMPT } from '../ai/prompts';
import {
  DEFAULT_MODELS,
  IMAGE_PROVIDERS,
  TEXT_PROVIDERS,
  higgsfieldImage,
  higgsfieldVideo,
  resolveAiConfig,
  type AiConfig,
  type ImageOutput,
  type TextInput,
} from '../ai/providers';
import { readConfig } from './content';
import { prepareUpload } from './media';
import type { Sql } from '../db';
import { getSecret, missingKey, requireSecret, secretsDb, type SecretName } from './secrets';
import type { ContentStore, UploadResult } from './store';

export async function readAiConfig(store: ContentStore): Promise<AiConfig> {
  return resolveAiConfig((await readConfig(store, 'ai')).data);
}

/** The provider's key, or its keys joined by ':' (Higgsfield's id and secret); a missing one is a 400. */
async function providerKey(store: ContentStore, keys: SecretName[]): Promise<string> {
  const sql = secretsDb(store);
  return (await Promise.all(keys.map((name) => requireSecret(sql, name)))).join(':');
}

/** Why the AI can't run (no key for the configured text provider), or null. Checked before `useAiCall`. */
export async function missingAiKey(sql: Sql, ai: AiConfig): Promise<string | null> {
  for (const name of TEXT_PROVIDERS[ai.text.provider].keys)
    if (!(await getSecret(sql, name))) return missingKey(name).message;
  return null;
}

/** Runs the configured text provider. */
export async function generateText(
  store: ContentStore,
  config: AiConfig,
  input: TextInput,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const provider = TEXT_PROVIDERS[config.text.provider];
  return provider.run(await providerKey(store, provider.keys), config.text.model, input, fetchFn);
}

/** Runs the configured image provider. */
export async function generateImage(
  store: ContentStore,
  config: AiConfig,
  prompt: string,
  fetchFn: typeof fetch = fetch,
): Promise<ImageOutput> {
  const provider = IMAGE_PROVIDERS[config.image.provider];
  return provider.run(await providerKey(store, provider.keys), config.image.model, { prompt }, fetchFn);
}

/**
 * A Higgsfield still, animated by Higgsfield image-to-video, as an animated WebP. Always Higgsfield, whichever image
 * provider is chosen: image-to-video takes the still's URL on Higgsfield's CDN.
 */
export async function generateAnimation(
  store: ContentStore,
  config: AiConfig,
  prompt: string,
  fetchFn: typeof fetch = fetch,
): Promise<ImageOutput> {
  const key = await providerKey(store, IMAGE_PROVIDERS.higgsfield.keys);
  const model = config.image.provider === 'higgsfield' ? config.image.model : DEFAULT_MODELS.image.higgsfield;
  // Both waits fit the function's 300 s with room for downloads and ffmpeg.
  const still = await higgsfieldImage(key, model, { prompt }, fetchFn, { everyMs: 2000, timeoutMs: 60_000 });
  const video = await higgsfieldVideo(
    key,
    config.video.model,
    { prompt: MOTION_PROMPT, imageUrl: still.url },
    fetchFn,
    {
      everyMs: 2000,
      timeoutMs: 200_000,
    },
  );
  return { bytes: await toAnimatedWebp(video), contentType: 'image/webp' };
}

/** A generated image through the same checks as an upload (type sniff, 4 MB cap, content-hash name), into the content folder. */
export async function saveImage(store: ContentStore, name: string, image: ImageOutput): Promise<UploadResult> {
  const { filename, base64, contentType } = prepareUpload(name, image.bytes);
  return store.putMedia('content', filename, base64, contentType);
}
