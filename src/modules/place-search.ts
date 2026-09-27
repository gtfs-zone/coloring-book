/**
 * Place search through Photon (komoot's OSM geocoder: no key, CORS allowed),
 * biased towards the map centre. Feeds `SearchController.getRemoteEntries`.
 */

import {
  neutralMarker,
  type SearchEntry,
} from 'interlocking/ui/search-controller';
import type { PageState } from '../types/page-state';

const PHOTON_URL = 'https://photon.komoot.io/api/';
const LIMIT = 5;

export interface PlacePayload {
  kind: 'place';
  lon: number;
  lat: number;
  /** [west, south, east, north], when Photon has one (cities, areas). */
  extent?: [number, number, number, number];
  name: string;
}

export type SearchPayload = { kind: 'entity'; state: PageState } | PlacePayload;

interface PhotonFeature {
  geometry: { type: string; coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    osm_value?: string;
    city?: string;
    country?: string;
    /** Photon order: [west, north, east, south]. */
    extent?: [number, number, number, number];
  };
}

function placeName(p: PhotonFeature['properties']): string {
  if (p.name) {
    return p.name;
  }
  return [p.street, p.housenumber].filter(Boolean).join(' ');
}

export async function searchPlaces(
  query: string,
  center: { lng: number; lat: number } | null,
  signal: AbortSignal
): Promise<SearchEntry<SearchPayload>[]> {
  const params = new URLSearchParams({ q: query, limit: String(LIMIT) });
  if (center) {
    params.set('lat', center.lat.toFixed(5));
    params.set('lon', center.lng.toFixed(5));
  }
  console.log(`[PlaceSearch] Querying "${query}"`);
  const response = await fetch(`${PHOTON_URL}?${params}`, { signal });
  if (!response.ok) {
    throw new Error(`Photon responded ${response.status}`);
  }
  const data = (await response.json()) as { features?: PhotonFeature[] };

  const entries: SearchEntry<SearchPayload>[] = [];
  for (const feature of data.features ?? []) {
    if (feature.geometry?.type !== 'Point') {
      continue;
    }
    const p = feature.properties;
    const name = placeName(p);
    if (!name) {
      continue;
    }
    const [lon, lat] = feature.geometry.coordinates;
    const kind = p.osm_value?.replace(/_/g, ' ');
    const where = [p.city !== name ? p.city : undefined, p.country]
      .filter(Boolean)
      .join(', ');
    entries.push({
      payload: {
        kind: 'place',
        lon,
        lat,
        extent: p.extent
          ? [p.extent[0], p.extent[3], p.extent[2], p.extent[1]]
          : undefined,
        name,
      },
      icon: neutralMarker(),
      primary: name,
      secondary: [kind, where].filter(Boolean).join(', ') || undefined,
      haystack: name,
    });
  }
  console.log(`[PlaceSearch] "${query}": ${entries.length} results`);
  return entries;
}
