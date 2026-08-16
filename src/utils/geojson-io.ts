/**
 * geojson.io round-trip for on-demand zone geometry.
 *
 * Zones are edited externally rather than with an on-map draw tool: the app
 * hands geojson.io the current FeatureCollection through an encoded URL, and
 * the user pastes the edited URL (or raw GeoJSON) back in.
 *
 * The URL payload is base64url(gzip(JSON text)) with the padding stripped,
 * prefixed with `gz:`. geojson.io also still emits an uncompressed
 * `data:application/json,<percent-encoded>` form for small collections, so both
 * are decoded on the way back in.
 */

const GZ_PREFIX = 'gz:';
const JSON_PREFIX = 'data:application/json,';

async function readAll(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }
  const blob = new Blob(chunks as BlobPart[]);
  return new Uint8Array(await blob.arrayBuffer());
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  void writer.write(new TextEncoder().encode(text));
  void writer.close();
  return readAll(stream.readable);
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  return new TextDecoder().decode(await readAll(stream.readable));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Build the geojson.io URL that opens this FeatureCollection for editing. */
export async function encodeGeojsonIoUrl(
  collection: GeoJSON.FeatureCollection
): Promise<string> {
  const payload = toBase64Url(await gzip(JSON.stringify(collection)));
  return `https://geojson.io/?data=${GZ_PREFIX}${payload}`;
}

/**
 * Pull the `data` parameter out of a geojson.io URL. geojson.io has shipped it
 * on both the query string and the hash, so both are checked.
 */
function extractDataParam(url: URL): string | null {
  const fromQuery = url.searchParams.get('data');
  if (fromQuery) {
    return fromQuery;
  }
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  return new URLSearchParams(hash).get('data');
}

/**
 * True when this text is an http(s) URL carrying an inline `data` payload, i.e.
 * it can be decoded here and must not be fetched. Callers use this to route a
 * paste between "decode locally" and "parse as JSON" / "fetch it".
 */
export function isEncodedGeojsonIoUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }
  try {
    return extractDataParam(new URL(trimmed)) !== null;
  } catch {
    return false;
  }
}

/** Decode a `data` parameter value into its JSON text. */
async function decodeDataParam(data: string): Promise<string> {
  if (data.startsWith(GZ_PREFIX)) {
    try {
      return await gunzip(fromBase64Url(data.slice(GZ_PREFIX.length)));
    } catch (error) {
      throw new Error(
        `Could not decompress the geojson.io payload: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (data.startsWith(JSON_PREFIX)) {
    return decodeURIComponent(data.slice(JSON_PREFIX.length));
  }
  throw new Error(
    `Unsupported geojson.io payload encoding: expected a "${GZ_PREFIX}" or "${JSON_PREFIX}" prefix.`
  );
}

/**
 * Accept either a geojson.io URL or raw pasted GeoJSON and return the
 * FeatureCollection it carries. Throws with a message naming the failure mode:
 * silently falling back to "no features" would look like a successful edit that
 * wiped every zone.
 */
export async function parseGeojsonIoInput(
  text: string
): Promise<GeoJSON.FeatureCollection> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Nothing pasted.');
  }

  let json: string;
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error('That does not parse as a URL.');
    }
    const data = extractDataParam(url);
    if (!data) {
      throw new Error(
        'This geojson.io URL carries no `data` parameter. Draw something first, or paste the GeoJSON itself.'
      );
    }
    json = await decodeDataParam(data);
  } else {
    json = trimmed;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const collection = parsed as Partial<GeoJSON.FeatureCollection>;
  if (collection?.type !== 'FeatureCollection') {
    throw new Error(
      `Expected a GeoJSON FeatureCollection, got ${JSON.stringify((collection as { type?: unknown })?.type ?? null)}.`
    );
  }
  if (!Array.isArray(collection.features)) {
    throw new Error('FeatureCollection has no features array.');
  }

  return collection as GeoJSON.FeatureCollection;
}
