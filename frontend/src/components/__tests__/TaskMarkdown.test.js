import { describe, it, expect } from 'vitest';
import { tokenizeInline, isSafeUrl, extractMarkdownImageUrls } from '../Tasks/TaskMarkdown.jsx';
import TaskMarkdown from '../Tasks/TaskMarkdown.jsx';

// React component tests run by invoking the component as a plain function
// and walking the element tree -- same trick used by ServerBootGateModal.

function flatten(node, acc = []) {
  if (node == null || typeof node === 'boolean') return acc;
  if (typeof node === 'string' || typeof node === 'number') {
    acc.push({ type: 'text', value: String(node) });
    return acc;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => flatten(child, acc));
    return acc;
  }
  if (typeof node !== 'object') return acc;
  acc.push({ type: node.type, props: node.props });
  if (node.props && node.props.children !== undefined) {
    flatten(node.props.children, acc);
  }
  return acc;
}

describe('tokenizeInline', () => {
  it('treats plain text as a single text token', () => {
    expect(tokenizeInline('hello world')).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('extracts a markdown link', () => {
    const out = tokenizeInline('see [docs](https://example.com) for more');
    expect(out.find((s) => s.type === 'link')).toMatchObject({ text: 'docs', url: 'https://example.com' });
  });

  it('extracts a markdown image', () => {
    const out = tokenizeInline('![photo](https://example.com/p.png)');
    expect(out.find((s) => s.type === 'image')).toMatchObject({ alt: 'photo', url: 'https://example.com/p.png' });
  });

  it('does not double-match: the image syntax is not also tokenized as a link', () => {
    const out = tokenizeInline('![cat](https://x/c.png)');
    expect(out.filter((s) => s.type === 'link')).toHaveLength(0);
    expect(out.filter((s) => s.type === 'image')).toHaveLength(1);
  });

  it('renders bare URLs as url tokens', () => {
    const out = tokenizeInline('see https://example.com here');
    expect(out.find((s) => s.type === 'url')).toMatchObject({ url: 'https://example.com' });
  });
});

describe('isSafeUrl', () => {
  it('accepts http(s)', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('http://example.com')).toBe(true);
  });
  it('accepts same-origin paths', () => {
    expect(isSafeUrl('/api/task-attachments/att-1/content?project_id=p1')).toBe(true);
  });
  it('rejects javascript:', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
  });
  it('rejects data:', () => {
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });
  it('rejects protocol-relative URLs', () => {
    expect(isSafeUrl('//evil.com/x')).toBe(false);
  });
});

describe('extractMarkdownImageUrls', () => {
  it('returns safe markdown image URLs in insertion order', () => {
    const urls = extractMarkdownImageUrls([
      'Foto:',
      '![first](/api/task-attachments/att-1/content?project_id=p1)',
      '![second](https://example.com/second.png)',
    ].join('\n'));

    expect(Array.from(urls)).toEqual([
      '/api/task-attachments/att-1/content?project_id=p1',
      'https://example.com/second.png',
    ]);
  });

  it('skips unsafe image URLs so they are not treated as rendered inline media', () => {
    const urls = extractMarkdownImageUrls('![bad](javascript:alert(1))');

    expect(Array.from(urls)).toEqual([]);
  });
});

describe('TaskMarkdown component', () => {
  it('renders nothing for empty input', () => {
    expect(TaskMarkdown({ source: '' })).toBeNull();
    expect(TaskMarkdown({ source: '   ' })).toBeNull();
    expect(TaskMarkdown({ source: undefined })).toBeNull();
  });

  it('does not render raw HTML -- script tags appear as text', () => {
    const tree = TaskMarkdown({ source: '<script>alert(1)</script>' });
    const flat = flatten(tree);
    // Make sure no element has type === 'script'.
    expect(flat.find((n) => n.type === 'script')).toBeUndefined();
    // The literal string is in a text node.
    const text = flat.filter((n) => n.type === 'text').map((n) => n.value).join('');
    expect(text).toContain('<script>alert(1)</script>');
  });

  it('renders a markdown image as an <img>', () => {
    const tree = TaskMarkdown({ source: '![cat](https://x/c.png)' });
    const flat = flatten(tree);
    const img = flat.find((n) => n.type === 'img');
    expect(img).toBeDefined();
    expect(img.props.src).toBe('https://x/c.png');
    expect(img.props.alt).toBe('cat');
  });

  it('renders a markdown link as <a target="_blank" rel="noopener noreferrer">', () => {
    const tree = TaskMarkdown({ source: '[docs](https://example.com)' });
    const flat = flatten(tree);
    const a = flat.find((n) => n.type === 'a');
    expect(a).toBeDefined();
    expect(a.props.href).toBe('https://example.com');
    expect(a.props.target).toBe('_blank');
    expect(a.props.rel).toContain('noopener');
  });

  it('drops the href on a javascript: link but keeps the text', () => {
    const tree = TaskMarkdown({ source: '[click](javascript:alert(1))' });
    const flat = flatten(tree);
    expect(flat.find((n) => n.type === 'a')).toBeUndefined();
    const text = flat.filter((n) => n.type === 'text').map((n) => n.value).join('');
    expect(text).toContain('click');
  });

  it('splits paragraphs on blank lines', () => {
    const tree = TaskMarkdown({ source: 'first\n\nsecond' });
    const flat = flatten(tree);
    expect(flat.filter((n) => n.type === 'p')).toHaveLength(2);
  });

  it('renders single newlines as <br>', () => {
    const tree = TaskMarkdown({ source: 'line one\nline two' });
    const flat = flatten(tree);
    expect(flat.find((n) => n.type === 'br')).toBeDefined();
  });
});
