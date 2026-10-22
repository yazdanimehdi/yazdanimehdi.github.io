import { json } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { getSql } from '../../../../lib/db';
import { approveAll } from '../../../../workflows/career-apply';

export const prerender = false;

/** "Approve all ready": each ready application is approved on its own → `{ approved: id[], skipped: { id, reason }[] }`. */
export const POST = careerRoute(async (_ctx, _store, user) => json(await approveAll(getSql(), user.login)));
