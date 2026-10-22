import { z } from 'astro/zod';
import { json, readBody } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { askChat } from '../../../../lib/reading/chat';
import { TARGET, targetOf } from '../../../../lib/reading/library';
import { listChat } from '../../../../lib/reading/room-db';

export const prerender = false;

const Query = z.strictObject({
  paper: z
    .string()
    .regex(/^\d{1,9}$/)
    .transform(Number)
    .optional(),
  notebook: z
    .string()
    .regex(/^\d{1,9}$/)
    .transform(Number)
    .optional(),
});
const Body = z.strictObject({ ...TARGET, question: z.string() });

/** `?paper=` or `?notebook=` → `{ messages }`, oldest first. */
export const GET = careerRoute(async (ctx) => {
  const target = targetOf(Query.parse(Object.fromEntries(ctx.url.searchParams)));
  return json({ messages: await listChat(getSql(), target) });
});

/** `{ paper | notebook, question }` → `{ question, answer }`: one grounded AI call in the request. */
export const POST = careerRoute(async (ctx, store) => {
  const { question, ...target } = Body.parse(await readBody(ctx));
  return json(await askChat(getSql(), store, targetOf(target), question));
});
