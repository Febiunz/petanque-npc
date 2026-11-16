import provenance from './provenance.json' with { type: 'json' };

export const OFFICIAL_SOURCE = 'nlpetanque';

export function isOfficialResult(result) {
  return !!result && (result.officialSource === OFFICIAL_SOURCE
    || !!provenance.pools[result.divisieId]?.matches.some((source) =>
      source.matchId === (result.matchId || result.fixtureId)));
}
