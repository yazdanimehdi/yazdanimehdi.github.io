import {
  IMAGE_PROVIDERS,
  TEXT_PROVIDERS,
  resolveAiConfig,
  type AiConfig,
  type ImageOutput,
  type TextInput,
} from '../ai/providers';
import { readConfig } from './content';
import { prepareUpload } from './media';
import { requireSecret, secretsDb, type SecretName } from './secrets';
import type { ContentStore, UploadResult } from './store';

export async function readAiConfig(store: ContentStore): Promise<AiConfig> {
  return resolveAiConfig((await readConfig(store, 'ai')).data);
}

/** The provider's key, or its keys joined by ':' (Higgsfield's id and secret); a missing one is a 400. */
async function providerKey(store: ContentStore, keys: SecretName[]): Promise<string> {
  const sql = secretsDb(store);
  return (await Promise.all(keys.map((name) => requireSecret(sql, name)))).join(':');
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

/** A generated image through the same checks as an upload (type sniff, 4 MB cap, content-hash name), into the content folder. */
export async function saveImage(store: ContentStore, name: string, image: ImageOutput): Promise<UploadResult> {
  const { filename, base64, contentType } = prepareUpload(name, image.bytes);
  return store.putMedia('content', filename, base64, contentType);
}
