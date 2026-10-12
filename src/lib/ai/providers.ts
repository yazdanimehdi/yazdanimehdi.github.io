/* eslint-disable @typescript-eslint/no-explicit-any -- provider responses are parsed defensively from unknown JSON */
import type { SecretName } from '../admin/secrets';

/** A provider call failed; the message is the provider's own, ready for a toast. */
export class AiError extends Error {}

export interface TextInput {
  system: string;
  prompt: string;
  maxTokens: number;
}
export interface ImageInput {
  prompt: string;
}
export interface ImageOutput {
  bytes: Uint8Array;
  contentType: string;
}

/** Current model ids (checked against each provider's docs, October 2026); the owner can change them on the AI screen. */
export const DEFAULT_MODELS = {
  text: { anthropic: 'claude-sonnet-5-5', openai: 'gpt-6-astra', google: 'gemini-3.8-flash' },
  image: { openai: 'gpt-image-2.5-flare', google: 'gemini-3.1-flash-image', higgsfield: 'higgsfield-ai/soul/standard' },
} as const;
export type TextProviderId = keyof typeof DEFAULT_MODELS.text;
export type ImageProviderId = keyof typeof DEFAULT_MODELS.image;

/** `key` is the provider's key; for providers with two (Higgsfield) the values joined by ':'. */
interface Provider<I, O> {
  label: string;
  keys: SecretName[];
  run: (key: string, model: string, input: I, fetchFn?: typeof fetch) => Promise<O>;
}

const TEXT_TIMEOUT = 90_000;
const IMAGE_TIMEOUT = 120_000;

/** One JSON request; a non-2xx answer or an unreachable host becomes an AiError naming the provider. */
async function request(
  label: string,
  fetchFn: typeof fetch,
  url: string,
  init: { headers: Record<string, string>; body?: unknown; timeout: number },
): Promise<any> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeout),
    });
  } catch (e) {
    throw new AiError(`${label} could not be reached: ${(e as Error).message}`);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    // not JSON: the raw text is the best message there is
  }
  if (res.ok && data) return data;
  const detail = Array.isArray(data?.detail) ? data.detail.map((d: any) => d?.msg).join('; ') : data?.detail;
  const message = [data?.error?.message, detail, data?.message, data?.error].find(
    (m): m is string => typeof m === 'string' && !!m.trim(),
  );
  const why = message?.trim() || text.trim().slice(0, 200) || res.statusText;
  if (res.status === 401 || res.status === 403) throw new AiError(`${label} rejected the key (${res.status}): ${why}`);
  throw new AiError(`${label} answered ${res.status}: ${why}`);
}

const nonEmpty = (label: string, text: unknown, why = ''): string => {
  if (typeof text === 'string' && text.trim()) return text;
  throw new AiError(`${label} returned no text${why ? ` (${why})` : ''}`);
};

const fromBase64 = (label: string, b64: unknown): Uint8Array => {
  if (typeof b64 !== 'string' || !b64) throw new AiError(`${label} returned no image`);
  return new Uint8Array(Buffer.from(b64, 'base64'));
};

async function openaiText(key: string, model: string, input: TextInput, fetchFn = fetch): Promise<string> {
  const data = await request('OpenAI', fetchFn, 'https://api.openai.com/v1/chat/completions', {
    headers: { Authorization: `Bearer ${key}` },
    body: {
      model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.prompt },
      ],
      // max_tokens is deprecated and refused by reasoning models; this one counts their reasoning too.
      max_completion_tokens: input.maxTokens,
    },
    timeout: TEXT_TIMEOUT,
  });
  const choice = data.choices?.[0];
  return nonEmpty('OpenAI', choice?.message?.content, choice?.finish_reason);
}

async function anthropicText(key: string, model: string, input: TextInput, fetchFn = fetch): Promise<string> {
  const data = await request('Anthropic', fetchFn, 'https://api.anthropic.com/v1/messages', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: {
      model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: 'user', content: input.prompt }],
    },
    timeout: TEXT_TIMEOUT,
  });
  // Thinking blocks may come first: keep only the text.
  const blocks: any[] = Array.isArray(data.content) ? data.content : [];
  const text = blocks
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('');
  return nonEmpty('Anthropic', text, data.stop_reason);
}

const gemini = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
const geminiParts = (data: any): any[] => {
  const parts = data.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts : [];
};

async function googleText(key: string, model: string, input: TextInput, fetchFn = fetch): Promise<string> {
  const data = await request('Google', fetchFn, gemini(model), {
    headers: { 'x-goog-api-key': key },
    body: {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
      generationConfig: { maxOutputTokens: input.maxTokens },
    },
    timeout: TEXT_TIMEOUT,
  });
  const text = geminiParts(data)
    .filter((p) => typeof p?.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  return nonEmpty('Google', text, data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason);
}

async function openaiImage(key: string, model: string, input: ImageInput, fetchFn = fetch): Promise<ImageOutput> {
  const data = await request('OpenAI', fetchFn, 'https://api.openai.com/v1/images/generations', {
    headers: { Authorization: `Bearer ${key}` },
    // JPEG at medium quality stays well under the 4 MB upload cap.
    body: { model, prompt: input.prompt, size: '1536x1024', quality: 'medium', output_format: 'jpeg' },
    timeout: IMAGE_TIMEOUT,
  });
  return { bytes: fromBase64('OpenAI', data.data?.[0]?.b64_json), contentType: 'image/jpeg' };
}

async function googleImage(key: string, model: string, input: ImageInput, fetchFn = fetch): Promise<ImageOutput> {
  const data = await request('Google', fetchFn, gemini(model), {
    headers: { 'x-goog-api-key': key },
    body: {
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } },
    },
    timeout: IMAGE_TIMEOUT,
  });
  const part = geminiParts(data).find((p) => p?.inlineData?.data || p?.inline_data?.data);
  const inline = part?.inlineData ?? part?.inline_data;
  if (!inline) {
    throw new AiError(
      `Google returned no image (${data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason ?? 'no reason given'})`,
    );
  }
  return { bytes: fromBase64('Google', inline.data), contentType: inline.mimeType ?? inline.mime_type ?? 'image/png' };
}

const HIGGSFIELD = 'https://api.higgsfield.ai';
const HIGGSFIELD_MODEL = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;
const HIGGSFIELD_FAILED: Record<string, string> = {
  failed: 'Higgsfield could not generate the image',
  nsfw: 'Higgsfield refused the prompt (flagged as NSFW)',
  canceled: 'Higgsfield canceled the request',
};

/** Submits, then polls the request until it is done. `poll` exists for tests. */
async function higgsfieldImage(
  key: string,
  model: string,
  input: ImageInput,
  fetchFn = fetch,
  poll = { everyMs: 2000, timeoutMs: IMAGE_TIMEOUT },
): Promise<ImageOutput> {
  // The model is a path on Higgsfield's host; this keeps it there.
  if (!HIGGSFIELD_MODEL.test(model)) throw new AiError(`"${model}" is not a Higgsfield model path`);
  const headers = { Authorization: `Key ${key}` };
  const submitted = await request('Higgsfield', fetchFn, `${HIGGSFIELD}/${model}`, {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    body: { prompt: input.prompt, aspect_ratio: '16:9', resolution: '1080p' },
    timeout: 30_000,
  });
  const id = submitted.request_id;
  if (typeof id !== 'string' || !id) throw new AiError('Higgsfield did not return a request id');
  const deadline = Date.now() + poll.timeoutMs;
  for (let status = submitted; ; ) {
    if (status.status === 'completed') {
      const url = status.images?.[0]?.url;
      if (typeof url !== 'string' || !url.startsWith('https://')) throw new AiError('Higgsfield returned no image URL');
      let res: Response;
      try {
        res = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        throw new AiError(`The Higgsfield image could not be downloaded: ${(e as Error).message}`);
      }
      if (!res.ok) throw new AiError(`The Higgsfield image could not be downloaded (${res.status})`);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? 'image/png',
      };
    }
    if (HIGGSFIELD_FAILED[status.status]) {
      const why = typeof status.error === 'string' ? `: ${status.error}` : '';
      throw new AiError(`${HIGGSFIELD_FAILED[status.status]}${why}`);
    }
    if (Date.now() >= deadline) throw new AiError(`Higgsfield did not finish within ${poll.timeoutMs / 1000} s`);
    await new Promise((r) => setTimeout(r, poll.everyMs));
    status = await request('Higgsfield', fetchFn, `${HIGGSFIELD}/requests/${encodeURIComponent(id)}/status`, {
      headers,
      timeout: 30_000,
    });
  }
}

export const TEXT_PROVIDERS: Record<TextProviderId, Provider<TextInput, string>> = {
  anthropic: { label: 'Anthropic', keys: ['ANTHROPIC_API_KEY'], run: anthropicText },
  openai: { label: 'OpenAI', keys: ['OPENAI_API_KEY'], run: openaiText },
  google: { label: 'Google Gemini', keys: ['GEMINI_API_KEY'], run: googleText },
};

export const IMAGE_PROVIDERS: Record<ImageProviderId, Provider<ImageInput, ImageOutput>> = {
  openai: { label: 'OpenAI', keys: ['OPENAI_API_KEY'], run: openaiImage },
  google: { label: 'Google Gemini', keys: ['GEMINI_API_KEY'], run: googleImage },
  higgsfield: {
    label: 'Higgsfield',
    keys: ['HIGGSFIELD_API_KEY', 'HIGGSFIELD_API_SECRET'],
    run: (key, model, input, fetchFn) => higgsfieldImage(key, model, input, fetchFn),
  },
};
export { higgsfieldImage };

export interface AiConfig {
  text: { provider: TextProviderId; model: string };
  image: { provider: ImageProviderId; model: string };
  papers: { autoPost: boolean; maxPostsPerRun: number };
}

/** config/ai.yml with every missing or unusable value replaced by its default. */
export function resolveAiConfig(raw: unknown): AiConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any;
  /** A known provider keeps its model (or the default); an unknown one falls back to `fallback` and its default. */
  const choose = <T extends string>(models: Record<T, string>, fallback: T, value: any) => {
    const known = typeof value?.provider === 'string' && Object.hasOwn(models, value.provider);
    const provider: T = known ? value.provider : fallback;
    const model =
      known && typeof value.model === 'string' && value.model.trim() ? value.model.trim() : models[provider];
    return { provider, model };
  };
  const max = Number(r.papers?.maxPostsPerRun);
  return {
    text: choose<TextProviderId>(DEFAULT_MODELS.text, 'anthropic', r.text),
    image: choose<ImageProviderId>(DEFAULT_MODELS.image, 'openai', r.image),
    papers: {
      autoPost: r.papers?.autoPost !== false,
      maxPostsPerRun: Number.isInteger(max) && max >= 0 ? max : 3,
    },
  };
}
