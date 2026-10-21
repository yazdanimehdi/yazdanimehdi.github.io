import { json } from '../../../../lib/admin/http';
import { careerRoute } from '../../../../lib/career/route';
import { SOURCES } from '../../../../lib/career/sources';
import { SUGGESTED_FEEDS } from '../../../../lib/career/sources/rss';

export const prerender = false;

/** What the settings screen needs to list sources (metadata only) and offer feeds. */
export const GET = careerRoute(async () =>
  json({
    sources: Object.values(SOURCES).map(({ id, label, needs, defaultOn, warning }) => ({
      id,
      label,
      needs: needs ?? [],
      defaultOn,
      warning: warning ?? null,
    })),
    suggestedFeeds: SUGGESTED_FEEDS,
  }),
);
