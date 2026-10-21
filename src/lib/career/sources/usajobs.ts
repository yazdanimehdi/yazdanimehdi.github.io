import type { RawPosting } from '../types';
import type { Source } from './index';
import { fetchInit, locationsOf, MAX_POSTINGS, queryOf, requireSecret, scrubbed } from './query';
import { getJson, SourceError } from './http';

interface Item {
  MatchedObjectId: string;
  MatchedObjectDescriptor: {
    PositionTitle: string;
    PositionURI: string;
    ApplyURI?: string[];
    PositionLocationDisplay?: string;
    OrganizationName?: string;
    DepartmentName?: string;
    QualificationSummary?: string;
    PositionRemuneration?: { MinimumRange?: string; MaximumRange?: string; RateIntervalCode?: string }[];
    PublicationStartDate?: string;
    UserArea?: { Details?: { JobSummary?: string; MajorDuties?: string[] } };
  };
}

const PERIODS = { PA: 'year', PH: 'hour' } as const;

export const usajobs: Source = {
  id: 'usajobs',
  label: 'USAJobs',
  needs: ['USAJOBS_API_KEY'],
  defaultOn: false,
  async search(ctx) {
    const key = await requireSecret(ctx, 'USAJOBS_API_KEY');
    const email = ctx.prefs.sources.usajobs?.options?.email?.trim();
    if (!email) throw new SourceError('USAJobs needs a contact email in its source options');
    const out: RawPosting[] = [];
    for (const where of locationsOf(ctx.prefs)) {
      const params = new URLSearchParams({ Keyword: queryOf(ctx.prefs), ResultsPerPage: '50' });
      if (where) params.set('LocationName', where);
      const res = (await scrubbed([key], () =>
        getJson(
          `https://data.usajobs.gov/api/search?${params}`,
          fetchInit(ctx, { 'Authorization-Key': key, 'User-Agent': email }),
        ),
      )) as { SearchResult: { SearchResultItems: Item[] } };
      for (const { MatchedObjectId, MatchedObjectDescriptor: d } of res.SearchResult.SearchResultItems) {
        const pay = d.PositionRemuneration?.[0];
        const period = PERIODS[pay?.RateIntervalCode as keyof typeof PERIODS];
        const details = d.UserArea?.Details;
        out.push({
          source: 'usajobs',
          externalId: MatchedObjectId,
          company: d.OrganizationName || d.DepartmentName || '',
          title: d.PositionTitle,
          location: d.PositionLocationDisplay,
          url: d.PositionURI,
          applyUrl: d.ApplyURI?.[0],
          description: [details?.JobSummary, details?.MajorDuties?.join('\n'), d.QualificationSummary]
            .filter(Boolean)
            .join('\n\n'),
          format: 'text',
          postedAt: d.PublicationStartDate,
          salary: period
            ? {
                min: Number(pay?.MinimumRange) || undefined,
                max: Number(pay?.MaximumRange) || undefined,
                currency: 'USD',
                period,
              }
            : undefined,
        });
      }
    }
    return out.slice(0, MAX_POSTINGS);
  },
};
