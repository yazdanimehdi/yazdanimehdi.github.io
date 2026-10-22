import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AiError,
  IMAGE_PROVIDERS,
  TEXT_PROVIDERS,
  higgsfieldImage,
  higgsfieldVideo,
  resolveAiConfig,
} from './providers';

type Reply = { status?: number; body: unknown; type?: string };

/** Answers each `METHOD url` with the next reply queued for it; records every request. */
function fakeFetch(replies: Record<string, Reply | Reply[]>, seen: Request[] = []) {
  const queues = Object.fromEntries(Object.entries(replies).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push(req);
    const queue = queues[`${req.method} ${req.url}`];
    const reply = queue?.length && queue.length > 1 ? queue.shift()! : queue?.[0];
    if (!reply) throw new Error(`unexpected ${req.method} ${req.url}`);
    const bytes = reply.body instanceof Uint8Array;
    return new Response(bytes ? (reply.body as Uint8Array).slice().buffer : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'Content-Type': reply.type ?? 'application/json' },
    });
  }) as typeof fetch;
}

const INPUT = { system: 'Be brief.', prompt: 'Say hi.', maxTokens: 100 };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const b64 = Buffer.from(JPEG).toString('base64');
const rejects = (p: Promise<unknown>, message: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof AiError, String(e));
    assert.match((e as Error).message, message);
    return true;
  });

test('openai text: chat completions with system + user and max_completion_tokens; errors name the key', async () => {
  const seen: Request[] = [];
  const url = 'POST https://api.openai.com/v1/chat/completions';
  const ok = fakeFetch(
    { [url]: { body: { choices: [{ message: { role: 'assistant', content: 'Hi.' }, finish_reason: 'stop' }] } } },
    seen,
  );
  assert.equal(await TEXT_PROVIDERS.openai.run('sk-1', 'gpt-6-astra', INPUT, ok), 'Hi.');
  assert.equal(seen[0].headers.get('authorization'), 'Bearer sk-1');
  assert.deepEqual(await seen[0].json(), {
    model: 'gpt-6-astra',
    messages: [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Say hi.' },
    ],
    max_completion_tokens: 100,
  });
  const bad = fakeFetch({
    [url]: { status: 401, body: { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } } },
  });
  await rejects(
    TEXT_PROVIDERS.openai.run('sk-1', 'm', INPUT, bad),
    /^OpenAI rejected the key \(401\): Incorrect API key/,
  );
  const empty = fakeFetch({ [url]: { body: { choices: [{ message: { content: null }, finish_reason: 'length' }] } } });
  await rejects(TEXT_PROVIDERS.openai.run('sk-1', 'm', INPUT, empty), /no text \(length\)/);
});

test('anthropic text: messages API headers and body; only text blocks are returned', async () => {
  const seen: Request[] = [];
  const url = 'POST https://api.anthropic.com/v1/messages';
  const ok = fakeFetch(
    {
      [url]: {
        body: {
          type: 'message',
          content: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'text', text: 'Hi' },
            { type: 'text', text: ' there.' },
          ],
          stop_reason: 'end_turn',
        },
      },
    },
    seen,
  );
  assert.equal(await TEXT_PROVIDERS.anthropic.run('ak', 'claude-sonnet-5-5', INPUT, ok), 'Hi there.');
  assert.equal(seen[0].headers.get('x-api-key'), 'ak');
  assert.equal(seen[0].headers.get('anthropic-version'), '2023-06-01');
  assert.deepEqual(await seen[0].json(), {
    model: 'claude-sonnet-5-5',
    max_tokens: 100,
    system: 'Be brief.',
    messages: [{ role: 'user', content: 'Say hi.' }],
  });
  const overloaded = fakeFetch({
    [url]: {
      status: 529,
      body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' }, request_id: 'req_1' },
    },
  });
  await rejects(TEXT_PROVIDERS.anthropic.run('ak', 'm', INPUT, overloaded), /^Anthropic answered 529: Overloaded$/);
});

test('google text: generateContent with systemInstruction; thought parts are skipped', async () => {
  const seen: Request[] = [];
  const url = 'POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';
  const ok = fakeFetch(
    {
      [url]: {
        body: {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'plan', thought: true }, { text: 'Hi.' }] },
              finishReason: 'STOP',
            },
          ],
        },
      },
    },
    seen,
  );
  assert.equal(await TEXT_PROVIDERS.google.run('gk', 'gemini-3.8-flash', INPUT, ok), 'Hi.');
  assert.equal(seen[0].headers.get('x-goog-api-key'), 'gk');
  assert.deepEqual(await seen[0].json(), {
    systemInstruction: { parts: [{ text: 'Be brief.' }] },
    contents: [{ role: 'user', parts: [{ text: 'Say hi.' }] }],
    generationConfig: { maxOutputTokens: 100 },
  });
  const bad = fakeFetch({
    [url]: {
      status: 400,
      body: {
        error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' },
      },
    },
  });
  await rejects(
    TEXT_PROVIDERS.google.run('gk', 'gemini-3.8-flash', INPUT, bad),
    /Google answered 400: API key not valid/,
  );
});

test('an unreachable provider is an AiError, not a crash', async () => {
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  await rejects(TEXT_PROVIDERS.anthropic.run('k', 'm', INPUT, down), /^Anthropic could not be reached: fetch failed$/);
});

test('openai image: landscape JPEG from b64_json', async () => {
  const seen: Request[] = [];
  const url = 'POST https://api.openai.com/v1/images/generations';
  const ok = fakeFetch({ [url]: { body: { created: 1, data: [{ b64_json: b64 }] } } }, seen);
  const out = await IMAGE_PROVIDERS.openai.run('sk', 'gpt-image-2.5-flare', { prompt: 'a lighthouse' }, ok);
  assert.deepEqual([...out.bytes], [...JPEG]);
  assert.equal(out.contentType, 'image/jpeg');
  assert.deepEqual(await seen[0].json(), {
    model: 'gpt-image-2.5-flare',
    prompt: 'a lighthouse',
    size: '1536x1024',
    quality: 'medium',
    output_format: 'jpeg',
  });
  const blocked = fakeFetch({
    [url]: { status: 400, body: { error: { message: 'Your request was rejected by the safety system.' } } },
  });
  await rejects(IMAGE_PROVIDERS.openai.run('sk', 'm', { prompt: 'x' }, blocked), /safety system/);
});

test('google image: the first inlineData part; a text-only answer is an error', async () => {
  const seen: Request[] = [];
  const url = 'POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent';
  const ok = fakeFetch(
    {
      [url]: {
        body: {
          candidates: [
            { content: { parts: [{ text: 'Here it is' }, { inlineData: { mimeType: 'image/jpeg', data: b64 } }] } },
          ],
        },
      },
    },
    seen,
  );
  const out = await IMAGE_PROVIDERS.google.run('gk', 'gemini-3.1-flash-image', { prompt: 'p' }, ok);
  assert.deepEqual([...out.bytes], [...JPEG]);
  assert.equal(out.contentType, 'image/jpeg');
  const sent = await seen[0].json();
  assert.deepEqual(sent.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } });
  const refused = fakeFetch({
    [url]: { body: { candidates: [{ content: { parts: [{ text: 'I cannot' }] }, finishReason: 'IMAGE_SAFETY' }] } },
  });
  await rejects(
    IMAGE_PROVIDERS.google.run('gk', 'gemini-3.1-flash-image', { prompt: 'p' }, refused),
    /no image \(IMAGE_SAFETY\)/,
  );
});

const HF = 'https://api.higgsfield.ai';
const fast = { everyMs: 0, timeoutMs: 5000 };

test('higgsfield: submit with Key auth and an idempotency key, poll to completed, download the https image', async () => {
  const seen: Request[] = [];
  const f = fakeFetch(
    {
      [`POST ${HF}/higgsfield-ai/soul/standard`]: {
        body: { status: 'queued', request_id: 'r1', status_url: `${HF}/requests/r1/status` },
      },
      [`GET ${HF}/requests/r1/status`]: [
        { body: { status: 'in_progress', request_id: 'r1' } },
        { body: { status: 'completed', request_id: 'r1', images: [{ url: 'https://cdn.higgsfield.ai/r1.jpg' }] } },
      ],
      'GET https://cdn.higgsfield.ai/r1.jpg': { body: JPEG, type: 'image/jpeg' },
    },
    seen,
  );
  const out = await higgsfieldImage('id:secret', 'higgsfield-ai/soul/standard', { prompt: 'p' }, f, fast);
  assert.deepEqual([...out.bytes], [...JPEG]);
  assert.equal(out.contentType, 'image/jpeg');
  assert.equal(out.url, 'https://cdn.higgsfield.ai/r1.jpg');
  assert.equal(seen[0].headers.get('authorization'), 'Key id:secret');
  assert.match(seen[0].headers.get('idempotency-key') ?? '', /^[0-9a-f-]{36}$/);
  assert.deepEqual(await seen[0].json(), { prompt: 'p', aspect_ratio: '16:9', resolution: '1080p' });
  assert.equal(seen.filter((r) => r.url.endsWith('/status')).length, 2);
});

test('higgsfield: failed and nsfw end the poll with an error; a non-https image URL is refused', async () => {
  const submit = { [`POST ${HF}/m`]: { body: { status: 'queued', request_id: 'r2' } } };
  const ending = (body: unknown) => fakeFetch({ ...submit, [`GET ${HF}/requests/r2/status`]: { body } });
  await rejects(
    higgsfieldImage('k', 'm', { prompt: 'p' }, ending({ status: 'nsfw', request_id: 'r2' }), fast),
    /refused the prompt \(flagged as NSFW\)/,
  );
  await rejects(
    higgsfieldImage('k', 'm', { prompt: 'p' }, ending({ status: 'failed', error: 'GPU fault' }), fast),
    /could not generate the image: GPU fault/,
  );
  await rejects(
    higgsfieldImage(
      'k',
      'm',
      { prompt: 'p' },
      ending({ status: 'completed', images: [{ url: 'http://x/a.jpg' }] }),
      fast,
    ),
    /no image URL/,
  );
  await rejects(
    higgsfieldImage('k', 'https://evil.test/x', { prompt: 'p' }, ending({}), fast),
    /not a Higgsfield model path/,
  );
});

test('higgsfield: gives up after the timeout', async () => {
  const f = fakeFetch({
    [`POST ${HF}/m`]: { body: { status: 'queued', request_id: 'r3' } },
    [`GET ${HF}/requests/r3/status`]: { body: { status: 'queued' } },
  });
  await rejects(higgsfieldImage('k', 'm', { prompt: 'p' }, f, { everyMs: 1, timeoutMs: 20 }), /did not finish/);
});

const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);

test('higgsfield video: image_url, 480p, 4 s, silent; poll to completed and download video.url', async () => {
  const seen: Request[] = [];
  const model = 'bytedance/seedance-2.5/image-to-video';
  const f = fakeFetch(
    {
      [`POST ${HF}/${model}`]: { body: { status: 'queued', request_id: 'v1' } },
      [`GET ${HF}/requests/v1/status`]: [
        { body: { status: 'in_progress', request_id: 'v1' } },
        { body: { status: 'completed', request_id: 'v1', video: { url: 'https://cdn.higgsfield.ai/v1.mp4' } } },
      ],
      'GET https://cdn.higgsfield.ai/v1.mp4': { body: MP4, type: 'video/mp4' },
    },
    seen,
  );
  const input = { prompt: 'slow drift', imageUrl: 'https://cdn.higgsfield.ai/r1.jpg' };
  assert.deepEqual([...(await higgsfieldVideo('id:secret', model, input, f, fast))], [...MP4]);
  assert.equal(seen[0].headers.get('authorization'), 'Key id:secret');
  assert.match(seen[0].headers.get('idempotency-key') ?? '', /^[0-9a-f-]{36}$/);
  assert.deepEqual(await seen[0].json(), {
    prompt: 'slow drift',
    image_url: 'https://cdn.higgsfield.ai/r1.jpg',
    resolution: '480p',
    duration: 4,
    generate_audio: false,
  });
  assert.equal(seen[1].headers.get('authorization'), 'Key id:secret');
  assert.equal(seen.filter((r) => r.url.endsWith('/status')).length, 2);
});

test('higgsfield video: failure statuses, a missing video URL and a failed download are errors', async () => {
  const input = { prompt: 'p', imageUrl: 'https://cdn.higgsfield.ai/r.jpg' };
  const submit = { [`POST ${HF}/m`]: { body: { status: 'queued', request_id: 'v2' } } };
  const ending = (body: unknown, more = {}) =>
    fakeFetch({ ...submit, [`GET ${HF}/requests/v2/status`]: { body }, ...more });
  await rejects(
    higgsfieldVideo('k', 'm', input, ending({ status: 'failed', error: 'GPU fault' }), fast),
    /^Higgsfield could not generate the video: GPU fault$/,
  );
  await rejects(higgsfieldVideo('k', 'm', input, ending({ status: 'nsfw' }), fast), /flagged as NSFW/);
  await rejects(higgsfieldVideo('k', 'm', input, ending({ status: 'canceled' }), fast), /canceled the request/);
  await rejects(
    higgsfieldVideo('k', 'm', input, ending({ status: 'completed', images: [{ url: 'https://x/a.jpg' }] }), fast),
    /no video URL/,
  );
  const gone = ending(
    { status: 'completed', video: { url: 'https://cdn.higgsfield.ai/v2.mp4' } },
    { 'GET https://cdn.higgsfield.ai/v2.mp4': { status: 404, body: {} } },
  );
  await rejects(higgsfieldVideo('k', 'm', input, gone, fast), /video could not be downloaded \(404\)/);
});

test('resolveAiConfig: defaults fill the gaps; an unknown provider falls back with its default model', () => {
  assert.deepEqual(resolveAiConfig(undefined), {
    text: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    image: { provider: 'openai', model: 'gpt-image-2.5-flare' },
    video: { model: 'bytedance/seedance-2.5/image-to-video' },
    papers: { autoPost: true, maxPostsPerRun: 3, schedule: { every: 'day' } },
  });
  assert.deepEqual(
    resolveAiConfig({
      text: { provider: 'google', model: '' },
      image: { provider: 'dall-e', model: 'x' },
      video: { model: '  ' },
      papers: { autoPost: false, maxPostsPerRun: 0, schedule: { every: 'day' } },
    }),
    {
      text: { provider: 'google', model: 'gemini-3.8-flash' },
      image: { provider: 'openai', model: 'gpt-image-2.5-flare' },
      video: { model: 'bytedance/seedance-2.5/image-to-video' },
      papers: { autoPost: false, maxPostsPerRun: 0, schedule: { every: 'day' } },
    },
  );
  assert.equal(resolveAiConfig({ papers: { maxPostsPerRun: -1 } }).papers.maxPostsPerRun, 3);
  assert.equal(
    resolveAiConfig({ video: { model: ' kling/v3/image-to-video ' } }).video.model,
    'kling/v3/image-to-video',
  );
});
