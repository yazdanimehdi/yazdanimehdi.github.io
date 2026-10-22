/* eslint-disable @typescript-eslint/no-explicit-any -- provider responses are parsed defensively from unknown JSON */
import type { SecretName } from '../admin/secrets';

/** A provider call failed; the message is the provider's own, ready for a toast. */
export class AiError extends Error {}

export interface TextInput {
  system: string;
  prompt: string;
  maxTokens: number;
  /** A PDF the model reads along with the prompt (the owner's own paper; at most 4 MB). */
  pdf?: { name: string; bytes: Uint8Array };
}
export interface ImageInput {
  prompt: string;
}
export interface ImageOutput {
  bytes: Uint8Array;
  contentType: string;
  /** Where the provider hosts the image, when it does (Higgsfield). */
  url?: string;
}

/** Current model ids (checked against each provider's docs, October 2026); the owner can change them on the AI screen. */
export const DEFAULT_MODELS = {
  text: { anthropic: 'claude-sonnet-5-5', openai: 'gpt-6-astra', google: 'gemini-3.8-flash' },
  image: { openai: 'gpt-image-2.5-flare', google: 'gemini-3.1-flash-image', higgsfield: 'higgsfield-ai/soul/standard' },
  video: { higgsfield: 'bytedance/seedance-2.5/image-to-video' },
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
// Image-to-video takes one to three minutes; the admin functions may run for 300 s.
const VIDEO_TIMEOUT = 240_000;

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

const pdf64 = (input: TextInput) => Buffer.from(input.pdf!.bytes).toString('base64');

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
        {
          role: 'user',
          content: input.pdf
            ? [
                {
                  type: 'file',
                  file: { filename: input.pdf.name, file_data: `data:application/pdf;base64,${pdf64(input)}` },
                },
                { type: 'text', text: input.prompt },
              ]
            : input.prompt,
        },
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
      messages: [
        {
          role: 'user',
          content: input.pdf
            ? [
                { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf64(input) } },
                { type: 'text', text: input.prompt },
              ]
            : input.prompt,
        },
      ],
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
      contents: [
        {
          role: 'user',
          parts: [
            ...(input.pdf ? [{ inline_data: { mime_type: 'application/pdf', data: pdf64(input) } }] : []),
            { text: input.prompt },
          ],
        },
      ],
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
const HIGGSFIELD_FAILED: Record<string, (kind: HiggsfieldKind) => string> = {
  failed: (kind) => `Higgsfield could not generate the ${kind}`,
  nsfw: () => 'Higgsfield refused the prompt (flagged as NSFW)',
  canceled: () => 'Higgsfield canceled the request',
};
/** Where each kind of request's completed status carries its result, and how long it may take. */
const HIGGSFIELD_RESULT = {
  image: { url: (status: any) => status.images?.[0]?.url, timeoutMs: IMAGE_TIMEOUT },
  video: { url: (status: any) => status.video?.url, timeoutMs: VIDEO_TIMEOUT },
};
type HiggsfieldKind = keyof typeof HIGGSFIELD_RESULT;
type Poll = { everyMs: number; timeoutMs: number };

/** Submits, polls the request until it is done, then downloads the result from Higgsfield's CDN. */
async function higgsfield(
  key: string,
  model: string,
  body: Record<string, unknown>,
  kind: HiggsfieldKind,
  fetchFn: typeof fetch,
  poll: Poll = { everyMs: 2000, timeoutMs: HIGGSFIELD_RESULT[kind].timeoutMs },
): Promise<ImageOutput & { url: string }> {
  // The model is a path on Higgsfield's host; this keeps it there.
  if (!HIGGSFIELD_MODEL.test(model)) throw new AiError(`"${model}" is not a Higgsfield model path`);
  const headers = { Authorization: `Key ${key}` };
  const submitted = await request('Higgsfield', fetchFn, `${HIGGSFIELD}/${model}`, {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    body,
    timeout: 30_000,
  });
  const id = submitted.request_id;
  if (typeof id !== 'string' || !id) throw new AiError('Higgsfield did not return a request id');
  const deadline = Date.now() + poll.timeoutMs;
  for (let status = submitted; ; ) {
    if (status.status === 'completed') {
      const url = HIGGSFIELD_RESULT[kind].url(status);
      if (typeof url !== 'string' || !url.startsWith('https://')) {
        throw new AiError(`Higgsfield returned no ${kind} URL`);
      }
      let res: Response;
      try {
        res = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        throw new AiError(`The Higgsfield ${kind} could not be downloaded: ${(e as Error).message}`);
      }
      if (!res.ok) throw new AiError(`The Higgsfield ${kind} could not be downloaded (${res.status})`);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? 'image/png',
        url,
      };
    }
    if (HIGGSFIELD_FAILED[status.status]) {
      const why = typeof status.error === 'string' ? `: ${status.error}` : '';
      throw new AiError(`${HIGGSFIELD_FAILED[status.status](kind)}${why}`);
    }
    if (Date.now() >= deadline) throw new AiError(`Higgsfield did not finish within ${poll.timeoutMs / 1000} s`);
    await new Promise((r) => setTimeout(r, poll.everyMs));
    status = await request('Higgsfield', fetchFn, `${HIGGSFIELD}/requests/${encodeURIComponent(id)}/status`, {
      headers,
      timeout: 30_000,
    });
  }
}

/** Also returns the image's URL on Higgsfield's CDN, which image-to-video takes as its input. `poll` exists for tests. */
const higgsfieldImage = (key: string, model: string, input: ImageInput, fetchFn = fetch, poll?: Poll) =>
  higgsfield(key, model, { prompt: input.prompt, aspect_ratio: '16:9', resolution: '1080p' }, 'image', fetchFn, poll);

/** A short, silent MP4 animating the image at `imageUrl`. `poll` exists for tests. */
async function higgsfieldVideo(
  key: string,
  model: string,
  input: { prompt: string; imageUrl: string },
  fetchFn = fetch,
  poll?: Poll,
): Promise<Uint8Array> {
  const body = {
    prompt: input.prompt,
    image_url: input.imageUrl,
    resolution: '480p',
    duration: 4,
    generate_audio: false,
  };
  return (await higgsfield(key, model, body, 'video', fetchFn, poll)).bytes;
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
export { higgsfieldImage, higgsfieldVideo };

/** How often the papers sync runs; the daily cron and the GitHub Action both run daily and skip unless due. */
export type PapersSchedule = { every: 'off' | 'day' | 'week' | 'month'; weekday?: number; monthday?: number };

function resolveSchedule(raw: any): PapersSchedule {
  const every = ['off', 'day', 'week', 'month'].includes(raw?.every) ? raw.every : 'day';
  const weekday = Number.isInteger(raw?.weekday) && raw.weekday >= 0 && raw.weekday <= 6 ? raw.weekday : 1;
  const monthday = Number.isInteger(raw?.monthday) && raw.monthday >= 1 && raw.monthday <= 28 ? raw.monthday : 1;
  return every === 'week' ? { every, weekday } : every === 'month' ? { every, monthday } : { every };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "weekly on Monday": the schedule in words (jobs detail, admin copy). */
export function scheduleLabel(s: PapersSchedule): string {
  if (s.every === 'off') return 'off';
  if (s.every === 'week') return `weekly on ${DAYS[s.weekday ?? 1]}`;
  if (s.every === 'month') return `monthly on day ${s.monthday ?? 1}`;
  return 'daily';
}

export interface AiConfig {
  text: { provider: TextProviderId; model: string };
  image: { provider: ImageProviderId; model: string };
  /** Generate GIF always animates with Higgsfield. */
  video: { model: string };
  papers: { autoPost: boolean; maxPostsPerRun: number; schedule: PapersSchedule };
}

/** config/ai.yml with every missing or unusable value replaced by its default. */
export function resolveAiConfig(raw: unknown): AiConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any;
  const model = (value: any, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
  /** A known provider keeps its model (or the default); an unknown one falls back to `fallback` and its default. */
  const choose = <T extends string>(models: Record<T, string>, fallback: T, value: any) => {
    const known = typeof value?.provider === 'string' && Object.hasOwn(models, value.provider);
    const provider: T = known ? value.provider : fallback;
    return { provider, model: known ? model(value.model, models[provider]) : models[provider] };
  };
  const max = Number(r.papers?.maxPostsPerRun);
  return {
    text: choose<TextProviderId>(DEFAULT_MODELS.text, 'anthropic', r.text),
    image: choose<ImageProviderId>(DEFAULT_MODELS.image, 'openai', r.image),
    video: { model: model(r.video?.model, DEFAULT_MODELS.video.higgsfield) },
    papers: {
      autoPost: r.papers?.autoPost !== false,
      maxPostsPerRun: Number.isInteger(max) && max >= 0 ? max : 3,
      schedule: resolveSchedule(r.papers?.schedule),
    },
  };
}
