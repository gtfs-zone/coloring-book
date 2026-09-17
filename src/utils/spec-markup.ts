/**
 * Renderer for the verbatim GTFS reference description strings stored in
 * `src/gtfs-spec/files/`.
 *
 * Those strings are copied byte for byte out of the reference, so they carry the
 * reference's markup: `<br>`, backticked code, markdown links to reference
 * anchors, bold and italic runs, `<hr>`, bullet lists, one embedded `<table>`,
 * and three images. Everything else is escaped, so this renderer stays safe even
 * though its only inputs are compile-time constants.
 */

import { escapeHtml } from 'interlocking/util/escape-html';
import twoLegSvg from '../assets/gtfs-spec/2-leg.svg';
import threeLegSvg from '../assets/gtfs-spec/3-leg.svg';
import inliningSvg from '../assets/gtfs-spec/inlining.svg';

const SPEC_REFERENCE_URL = 'https://gtfs.org/documentation/schedule/reference/';

/** Images the reference embeds, keyed by the basename it uses. */
const SPEC_IMAGES: Record<string, string> = {
  '2-leg.svg': twoLegSvg,
  '3-leg.svg': threeLegSvg,
  'inlining.svg': inliningSvg,
};

const BLOCK_TAGS = new Set(['table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr']);

/** Extra classes applied to the passthrough tags, so they inherit app styling. */
const TAG_CLASSES: Record<string, string> = {
  table: 'table table-xs w-full my-2 border border-base-content/20',
  th: 'font-semibold',
  hr: 'my-2 border-base-content/20',
};

/**
 * One pass over the string, alternating between markup tokens and plain text.
 * Order matters: images before links, `**` before `*`.
 */
const TOKEN_SOURCE =
  '!\\[[^\\]]*\\]\\(([^)]*)\\)|<img\\s[^>]*src="([^"]*)"[^>]*>|`([^`]+)`|\\[([^\\]]*)\\]\\(([^)]+)\\)|\\*\\*([^*]+)\\*\\*|\\*([^*\\n]+)\\*|<(/?)([a-zA-Z]+)(?:\\s[^>]*)?>|&nbsp;';

function renderImage(src: string): string {
  const basename = src.split('/').pop() ?? '';
  const url = SPEC_IMAGES[basename];
  if (!url) {
    console.warn('[SpecMarkup] no vendored asset for image', src);
    return '';
  }
  // The reference diagrams are black line art on a transparent background, so
  // they vanish on the dark themes. The white plate is cheaper than forking the
  // SVGs and keeps them verbatim.
  return `<span class="block my-2 rounded bg-white p-2"><img src="${escapeHtml(url)}" alt="" class="mx-auto block max-w-full h-auto" loading="lazy"></span>`;
}

function renderLink(text: string, target: string): string {
  const label = escapeHtml(text);
  if (/^https?:/i.test(target)) {
    return `<a class="link link-primary" href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }
  if (target.startsWith('#')) {
    return `<a class="link link-primary" href="${escapeHtml(SPEC_REFERENCE_URL + target)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }
  return label;
}

function renderTag(closing: string, rawName: string): string {
  const name = rawName.toLowerCase();
  if (name === 'br') {
    return '<br>';
  }
  if (!BLOCK_TAGS.has(name)) {
    return '';
  }
  if (closing) {
    return `</${name}>`;
  }
  const classes = TAG_CLASSES[name];
  return classes ? `<${name} class="${classes}">` : `<${name}>`;
}

/** Render a single line: inline markup only, no block structure. */
function renderInline(line: string): string {
  let out = '';
  let last = 0;
  // A fresh regex per call: renderInline recurses through bold and italic runs,
  // and a shared global regex would have its lastIndex clobbered by the inner call.
  const token = new RegExp(TOKEN_SOURCE, 'g');
  let match: RegExpExecArray | null;
  while ((match = token.exec(line)) !== null) {
    out += escapeHtml(line.slice(last, match.index));
    last = match.index + match[0].length;
    const [
      whole,
      mdImage,
      htmlImage,
      code,
      linkText,
      linkTarget,
      bold,
      italic,
      closing,
      tagName,
    ] = match;
    if (mdImage !== undefined) {
      out += renderImage(mdImage);
    } else if (htmlImage !== undefined) {
      out += renderImage(htmlImage);
    } else if (code !== undefined) {
      out += `<code class="text-xs px-1 rounded bg-base-content/10">${escapeHtml(code)}</code>`;
    } else if (linkText !== undefined) {
      out += renderLink(linkText, linkTarget);
    } else if (bold !== undefined) {
      out += `<strong>${renderInline(bold)}</strong>`;
    } else if (italic !== undefined) {
      out += `<em>${renderInline(italic)}</em>`;
    } else if (tagName !== undefined) {
      out += renderTag(closing, tagName);
    } else if (whole === '&nbsp;') {
      out += '&nbsp;';
    }
  }
  out += escapeHtml(line.slice(last));
  return out;
}

// The reference writes one bullet in stop_times.txt with a non-breaking space
// after the dash, so the separator has to admit `&nbsp;` as well as whitespace.
const BULLET = /^\s*[-*](?:\s|&nbsp;)+/;

/**
 * Render a verbatim reference description as HTML.
 *
 * `<br>` is folded into the line structure first, so the bullet lists the
 * reference writes as `<br>- item` come out as real lists, the same as the ones
 * it writes across separate lines.
 */
export function renderSpecDescription(description: string): string {
  if (!description) {
    return '';
  }
  const lines = description.replace(/<br\s*\/?>/gi, '\n').split('\n');

  const blocks: string[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push(`<div>${paragraph.join('<br>')}</div>`);
      paragraph = [];
    }
  };
  const flushBullets = (): void => {
    if (bullets.length > 0) {
      blocks.push(
        `<ul class="list-disc list-outside pl-4 space-y-0.5">${bullets.join('')}</ul>`
      );
      bullets = [];
    }
  };

  for (const line of lines) {
    if (BULLET.test(line)) {
      flushParagraph();
      bullets.push(`<li>${renderInline(line.replace(BULLET, ''))}</li>`);
      continue;
    }
    flushBullets();
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    paragraph.push(renderInline(line));
  }
  flushBullets();
  flushParagraph();

  return `<div class="space-y-2">${blocks.join('')}</div>`;
}

/**
 * Flatten a verbatim reference description to a single line of plain text, for
 * `title=` attributes and picker subtitles. The result is unescaped text: the
 * caller escapes it for whatever context it lands in.
 */
export function renderSpecDescriptionPlain(description: string): string {
  if (!description) {
    return '';
  }
  return description
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
