/** Loading the static JSON files written by `etl export`. Every file is fetched at most once. */

import type { ElectionFile, Meta, UnitFile, UnitIndex } from './types';

const BASE = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<unknown>>();

function getJson<T>(path: string): Promise<T> {
  let request = cache.get(path);
  if (!request) {
    request = fetch(BASE + path).then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${path}`);
      return response.json();
    });
    request.catch(() => cache.delete(path)); // allow a retry after a failure
    cache.set(path, request);
  }
  return request as Promise<T>;
}

export const loadMeta = () => getJson<Meta>('data/meta.json');
export const loadUnitIndex = () => getJson<UnitIndex>('data/units/index.json');
export const loadUnit = (unitId: string) => getJson<UnitFile>(`data/units/${encodeURIComponent(unitId)}.json`);
export const loadElection = (electionId: string) =>
  getJson<ElectionFile>(`data/elections/${encodeURIComponent(electionId)}.json`);

/** Absolute URL of the PMTiles file (the pmtiles protocol needs one). */
export function tilesUrl(): string {
  return new URL(`${BASE}tiles/units.pmtiles`, document.baseURI).href;
}
