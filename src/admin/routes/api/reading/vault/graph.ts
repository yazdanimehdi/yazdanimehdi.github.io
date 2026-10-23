import { json } from '../../../../../lib/admin/http';
import { careerRoute } from '../../../../../lib/career/route';
import { getSql } from '../../../../../lib/db';
import { graph } from '../../../../../lib/reading/vault-db';

export const prerender = false;

/** `{ nodes, edges, total }`: the most-linked notes and the links between them. */
export const GET = careerRoute(async () => json(await graph(getSql())));
