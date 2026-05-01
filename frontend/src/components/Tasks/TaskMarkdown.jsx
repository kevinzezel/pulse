'use client';

// Minimal Markdown renderer that handles only the safe subset Pulse uses in
// task descriptions: paragraphs, line breaks, `[text](url)`, `![alt](url)`,
// and bare URLs. Everything else is rendered as plain text -- a `<script>`
// tag, an `<img onerror=...>`, or any other HTML the user pastes into the
// description appears verbatim, never as live HTML.
//
// Why no library: pulling in `react-markdown` + a sanitizer is ~30 kB of
// runtime plus a transitive dep tree. The set of features we want is small
// enough to keep first-party.
//
// Implementation strategy: tokenize each line into "text" and "image" /
// "link" segments using regex, then emit React nodes. Critically, the
// "text" segments come straight from the input string, so React's default
// HTML escaping handles the safety. We never use dangerouslySetInnerHTML.

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const URL_RE = /https?:\/\/[^\s<>"')]+/g;

// True if the URL is safe to render as an image src or link href. Rejects
// `javascript:`, `data:`, and other potentially-executable schemes.
function isSafeUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Allow same-origin paths (e.g. /api/task-attachments/...), absolute http(s),
  // and mailto.
  if (trimmed.startsWith('/')) return !trimmed.startsWith('//');
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^mailto:/i.test(trimmed)) return true;
  return false;
}

function extractMarkdownImageUrls(source) {
  const text = typeof source === 'string' ? source : '';
  const urls = new Set();
  IMAGE_RE.lastIndex = 0;
  for (const m of text.matchAll(IMAGE_RE)) {
    const url = m[2];
    if (isSafeUrl(url)) urls.add(url);
  }
  return urls;
}

// Build segments for a single line: alternating text and inline elements.
// Order of regex application matters: image syntax is detected first so
// `![alt](url)` is not consumed by the link regex.
function tokenizeInline(line) {
  // Reset lastIndex on regex objects since we share them across calls.
  IMAGE_RE.lastIndex = 0;
  LINK_RE.lastIndex = 0;
  URL_RE.lastIndex = 0;

  const matches = [];
  for (const m of line.matchAll(IMAGE_RE)) {
    matches.push({ type: 'image', start: m.index, end: m.index + m[0].length, alt: m[1], url: m[2] });
  }
  // Skip link matches that overlap with image matches (image is `![...](...)`
  // and link is `[...](...)` -- the inner part of the image tokenizes as a link).
  for (const m of line.matchAll(LINK_RE)) {
    const start = m.index;
    const end = m.index + m[0].length;
    const overlaps = matches.some((x) => x.type === 'image' && x.start <= start && x.end >= end);
    if (overlaps) continue;
    matches.push({ type: 'link', start, end, text: m[1], url: m[2] });
  }
  for (const m of line.matchAll(URL_RE)) {
    const start = m.index;
    const end = m.index + m[0].length;
    const overlaps = matches.some((x) => x.start <= start && x.end >= end);
    if (overlaps) continue;
    matches.push({ type: 'url', start, end, url: m[0] });
  }
  matches.sort((a, b) => a.start - b.start);

  const out = [];
  let cursor = 0;
  for (const seg of matches) {
    if (seg.start > cursor) out.push({ type: 'text', text: line.slice(cursor, seg.start) });
    out.push(seg);
    cursor = seg.end;
  }
  if (cursor < line.length) out.push({ type: 'text', text: line.slice(cursor) });
  return out;
}

function renderSegment(seg, key) {
  if (seg.type === 'text') {
    // React escapes string children automatically -- no HTML evaluation.
    return seg.text;
  }
  if (seg.type === 'image') {
    if (!isSafeUrl(seg.url)) return seg.text || `![${seg.alt}](${seg.url})`;
    return (
      <img
        key={key}
        src={seg.url}
        alt={seg.alt || ''}
        loading="lazy"
        className="my-2 max-h-96 max-w-full rounded-md border"
        style={{ borderColor: 'hsl(var(--border))' }}
      />
    );
  }
  if (seg.type === 'link') {
    if (!isSafeUrl(seg.url)) return seg.text;
    return (
      <a
        key={key}
        href={seg.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline hover:opacity-80"
      >
        {seg.text}
      </a>
    );
  }
  if (seg.type === 'url') {
    if (!isSafeUrl(seg.url)) return seg.url;
    return (
      <a
        key={key}
        href={seg.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline hover:opacity-80"
      >
        {seg.url}
      </a>
    );
  }
  return null;
}

// Convert a paragraph (a block of consecutive non-empty lines) into a
// React fragment. Within a paragraph, individual newlines become <br/>.
function renderParagraph(block, paraKey) {
  const lines = block.split('\n');
  const children = [];
  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) children.push(<br key={`br-${paraKey}-${lineIdx}`} />);
    const segments = tokenizeInline(line);
    segments.forEach((seg, segIdx) => {
      const node = renderSegment(seg, `seg-${paraKey}-${lineIdx}-${segIdx}`);
      if (node !== null && node !== undefined && node !== '') children.push(node);
    });
  });
  return <p key={paraKey} className="leading-relaxed">{children}</p>;
}

export default function TaskMarkdown({ source, className = '' }) {
  const text = typeof source === 'string' ? source : '';
  if (!text.trim()) return null;
  // Split on blank lines (one or more newlines with optional whitespace).
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
  return (
    <div className={`space-y-3 text-sm text-foreground break-words ${className}`}>
      {blocks.map((block, i) => renderParagraph(block, `p-${i}`))}
    </div>
  );
}

// Exported for unit tests.
export { tokenizeInline, isSafeUrl, extractMarkdownImageUrls };
