// Shared setup for the apply tests: pglite, a Postgres store with a CV, fake Blob, fake AI and a fake apply sandbox
// that answers each runner call from the input.json it was given.
import { mock } from 'node:test';
import type { CommandResult, NetworkPolicy, SandboxApi, SandboxHandle } from '../../admin/editor';
import { setStoreForTests } from '../../admin/get-store';
import { PostgresStore } from '../../admin/postgres-store';
import { setSqlForTests } from '../../db';
import { migrate } from '../../db-migrate';
import { pgliteSql } from '../../pglite-sql';
import { setBlobForTests } from '../files';
import { updatePosting, upsertPostings, writeCareer } from '../db';
import { setApplySandboxForTests } from './sandbox';
import type { ApplyField, Application, RunnerInput, RunnerResult } from './types';

export const FLAGS = {
  hiddenBlocks: [],
  hiddenUrls: [],
  invisible: { zero_width: 0, bidi: 0, format: 0, bom: 0 },
  invisibleFlagged: 0,
  instructionLines: [],
  mixedScript: [],
  warn: false,
};

const f = (id: string, label: string, kind: ApplyField['kind'], extra: Partial<ApplyField> = {}): ApplyField => ({
  id,
  label,
  kind,
  required: true,
  value: '',
  source: kind === 'file' ? 'file' : 'owner',
  ...extra,
});

/** A form as the runner reads it: the CV knows the names and email, the AI answers "Why us?". */
export const FORM: ApplyField[] = [
  f('first_name', 'First Name', 'text'),
  f('last_name', 'Last Name', 'text'),
  f('email', 'Email', 'email'),
  f('resume', 'Resume/CV', 'file'),
  f('cover_letter', 'Cover Letter', 'file', { required: false }),
  f('why', 'Why us?', 'textarea', { required: false }),
];

export const AI_VALUES = JSON.stringify({ values: [{ id: 'why', value: 'The engines.', confident: true }] });

export interface FakeSandbox {
  api: SandboxApi;
  /** Every runner input, in order. */
  inputs: RunnerInput[];
  /** Files written into the VM, by path. */
  written: Map<string, Buffer>;
  scripts: { script: string; args: string[]; env?: Record<string, string> }[];
  policies: NetworkPolicy[];
  created: number;
  stops: number;
  respond: (input: RunnerInput) => RunnerResult | 'lost';
}

export function fakeSandbox(respond: FakeSandbox['respond']): FakeSandbox {
  const fake: FakeSandbox = {
    inputs: [],
    written: new Map(),
    scripts: [],
    policies: [],
    created: 0,
    stops: 0,
    respond,
    api: null as never,
  };
  let exists = false;
  const handle: SandboxHandle = {
    status: 'running',
    async run(script, args = [], opts = {}): Promise<CommandResult> {
      fake.scripts.push({ script, args, env: opts.env });
      if (!script.includes('runner.mjs')) return { exitCode: 0, stdout: '', stderr: '' };
      const input = JSON.parse(fake.written.get(args[0])!.toString()) as RunnerInput;
      fake.inputs.push(input);
      const out = fake.respond(input);
      if (out === 'lost') throw new Error('Vercel Sandbox: a command failed: the session timed out');
      return { exitCode: 0, stdout: `${JSON.stringify(out)}\n`, stderr: '' };
    },
    spawn: async () => {},
    readFile: async (path) => (path.endsWith('.png') ? Buffer.from(`png ${path}`) : Buffer.from(`%PDF ${path}`)),
    writeFiles: async (files) => files.forEach((x) => fake.written.set(x.path, x.content)),
    domain: () => '',
    setNetworkPolicy: async (p) => void fake.policies.push(p),
    extendTimeout: async () => {},
    stop: async () => void fake.stops++,
    delete: async () => {},
    setTags: async () => {},
  };
  fake.api = {
    get: async () => (exists ? handle : null),
    create: async (_name, opts) => {
      exists = true;
      fake.created++;
      fake.policies.push(opts.networkPolicy);
      return handle;
    },
  };
  return fake;
}

/** What the runner returns for a mode on FORM, with the values typed in for fill and submit. */
export function ok(input: RunnerInput, extra: Partial<RunnerResult> = {}): RunnerResult {
  const typed = new Map((input.values ?? []).map((v) => [v.id, v.value]));
  const fields = FORM.map((x) => ({ ...x, value: typed.get(x.id) ?? '' }));
  const shots =
    input.mode === 'fill'
      ? [`${input.out}/filled-1.png`]
      : input.mode === 'submit'
        ? [`${input.out}/confirmation.png`]
        : [];
  const letterPdf = input.mode === 'fill' && input.letterHtml ? `${input.out}/letter.pdf` : undefined;
  return {
    ok: true,
    url: input.url,
    fields,
    shots,
    ...(letterPdf ? { letterPdf } : {}),
    ...(input.mode === 'submit' ? { confirmed: true } : {}),
    ...extra,
  };
}

export type TestSql = ReturnType<typeof pgliteSql>;

export interface Kit {
  sql: TestSql;
  blobs: string[];
  aiCalls: () => number;
}

const savedKey = process.env.ANTHROPIC_API_KEY;

export async function setUp(): Promise<Kit> {
  const sql = pgliteSql();
  await migrate(sql);
  setSqlForTests(sql);
  setStoreForTests(
    (author) =>
      new PostgresStore(sql, author, { purge: async () => {}, put: async () => ({ url: '' }), del: async () => {} }),
  );
  await sql`insert into documents (path, content) values
    ('config/cv.yml', ${"cv:\n  name: 'Ada Lovelace'\n  email: 'ada@example.com'\n  sections:\n    skills:\n      - label: Python\n        details: daily\n"})`;
  await writeCareer(sql, { prefs: {} }, 'test');
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const blobs: string[] = [];
  setBlobForTests({
    put: async (pathname) => (blobs.push(pathname), { url: `https://blob.test/${pathname}` }),
    del: async () => {},
  });
  let ai = 0;
  mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith('https://api.anthropic.com/')) {
      ai++;
      return Response.json({ content: [{ type: 'text', text: AI_VALUES }] });
    }
    if (url.startsWith('https://blob.test/')) return new Response(`%PDF ${url}`);
    return new Response('missing', { status: 404 });
  });
  return { sql, blobs, aiCalls: () => ai };
}

export function tearDown(): void {
  mock.restoreAll();
  setSqlForTests(null);
  setStoreForTests(null);
  setBlobForTests(null);
  setApplySandboxForTests(null);
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
}

let n = 0;
/** A drafted posting with a tailored CV and letter; `application` is set as given. */
export async function posting(sql: TestSql, application: Application | null = null, cv = true): Promise<number> {
  const key = `k${++n}`;
  await upsertPostings(sql, [
    {
      source: 's',
      externalId: key,
      company: 'Acme',
      title: 'Dev',
      url: `https://jobs.test/${key}`,
      applyUrl: `https://jobs.test/${key}/apply`,
      description: 'We build engines.',
      format: 'text',
      key,
      text: 'We build engines.',
      flags: FLAGS,
    },
  ]);
  const [{ id }] = await sql<{ id: number }>`select id from career_postings where key = ${key}`;
  await updatePosting(sql, Number(id), {
    status: 'drafted',
    letter: 'Dear team,\n\nI <b>build</b> engines.',
    ...(cv ? { cvPdfUrl: 'https://blob.test/career/cv.pdf' } : {}),
    application,
  });
  return Number(id);
}

/** An application as the pre-fill leaves it, ready for approval. */
export function readyApp(extra: Partial<Application> = {}): Application {
  return {
    state: 'ready',
    at: new Date().toISOString(),
    url: 'https://jobs.test/form',
    fields: FORM.map((x) => ({
      ...x,
      value: x.kind === 'file' ? '' : x.id === 'why' ? 'The engines.' : `v-${x.id}`,
      source: x.kind === 'file' ? 'file' : 'cv',
    })),
    shots: ['https://blob.test/career/1/filled-1.png'],
    letterPdf: 'https://blob.test/career/1/letter.pdf',
    cvPdf: 'https://blob.test/career/cv.pdf',
    ...extra,
  };
}

export const approvedApp = (extra: Partial<Application> = {}): Application => {
  const app = readyApp(extra);
  return { ...app, state: 'approved', approved: { at: app.at, by: 'ada', fields: app.fields }, ...extra };
};
