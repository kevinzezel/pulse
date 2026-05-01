'use client';

import { ExternalLink, FileText, Image as ImageIcon, Link as LinkIcon, Play, Video } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import TaskMarkdown, { extractMarkdownImageUrls } from './TaskMarkdown';

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
// Same-origin attachment URL produced by /api/task-attachments/:id/content.
// Matches the path portion only -- the description Markdown stores it as a
// relative URL so it works on dev (HTTP) and prod (HTTPS) without rewrites.
const ATTACHMENT_URL_RE = /\/api\/task-attachments\/[^\s<>"')]+\/content[^\s<>"')]*/gi;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i;

function cleanUrl(raw) {
  return String(raw || '').replace(/[.,;:!?]+$/g, '');
}

function getYoutubeId(url) {
  try {
    const parsed = new URL(url, 'http://localhost');
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || null;
    if (!host.endsWith('youtube.com')) return null;
    if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (['embed', 'shorts', 'live'].includes(parts[0])) return parts[1] || null;
  } catch {}
  return null;
}

// Walk the description text + the raw attachments[] field (when supplied) and
// produce a normalized list of preview items. URLs already known to be
// attachments via the content-API path are deduplicated against the
// attachments list so the same image isn't shown twice when the user pastes
// an image -- the paste handler inserts both a Markdown link and the
// attachment metadata.
export function extractTaskMedia(description, attachments = []) {
  const text = typeof description === 'string' ? description : '';
  const seen = new Set();
  const out = [];

  // 1. Native attachments first -- these always win over a description-only
  //    URL so the rendered shape stays consistent across re-saves.
  for (const att of attachments || []) {
    if (!att?.url || seen.has(att.url)) continue;
    seen.add(att.url);
    if (att.kind === 'image') {
      out.push({ type: 'image', url: att.url, name: att.name, size: att.size, attachment: true });
    } else {
      out.push({ type: 'document', url: att.url, name: att.name, size: att.size, mime: att.mime, attachment: true });
    }
  }

  // 2. Any URL in the description that points at our content route also
  //    resolves to a preview (image/document) -- this catches Markdown that
  //    a user might type by hand referencing the same attachment id.
  for (const match of text.matchAll(ATTACHMENT_URL_RE)) {
    const url = cleanUrl(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ type: 'image', url, attachment: true });
  }

  // 3. Generic URL fallback: images, videos, YouTube embeds, plain links.
  for (const match of text.matchAll(URL_RE)) {
    const url = cleanUrl(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const youtubeId = getYoutubeId(url);
    if (youtubeId) {
      out.push({
        type: 'youtube',
        url,
        thumb: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`,
      });
    } else if (IMAGE_EXT_RE.test(url)) {
      out.push({ type: 'image', url });
    } else if (VIDEO_EXT_RE.test(url)) {
      out.push({ type: 'video', url });
    } else {
      out.push({ type: 'link', url });
    }
  }
  return out;
}

function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskMediaPreview({ description, attachments = [], compact = false }) {
  const { t } = useTranslation();
  const source = typeof description === 'string' ? description : '';
  const embeddedImageUrls = extractMarkdownImageUrls(source);
  const media = extractTaskMedia(description, attachments);
  const displayMedia = compact
    ? media
    : media.filter((item) => !(item.type === 'image' && embeddedImageUrls.has(item.url)));
  const visible = compact ? displayMedia.slice(0, 1) : displayMedia;
  const showMarkdownPreview = !compact && embeddedImageUrls.size > 0;
  if (!showMarkdownPreview && visible.length === 0) return null;

  return (
    <div className={compact ? 'mt-2' : 'mt-2 space-y-2'}>
      {!compact && (
        <div className="text-xs font-medium text-muted-foreground">{t('tasks.preview')}</div>
      )}
      {showMarkdownPreview && (
        <div className="max-h-80 overflow-auto rounded-md border border-border bg-muted/10 p-3">
          <TaskMarkdown source={source} />
        </div>
      )}
      {visible.length > 0 && (
        <div className={compact ? '' : 'grid gap-2 sm:grid-cols-2'}>
          {visible.map((item) => (
            <a
              key={item.url}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block overflow-hidden rounded-md border bg-muted/20 hover:border-primary/50 transition-colors"
              style={{ borderColor: 'hsl(var(--border))' }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {item.type === 'image' && (
                <div className={compact ? 'h-24' : 'h-36'}>
                  <img
                    src={item.url}
                    alt={item.name || ''}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              {item.type === 'youtube' && (
                <div className={`relative ${compact ? 'h-24' : 'h-36'}`}>
                  <img
                    src={item.thumb}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ background: 'hsl(var(--overlay) / 0.35)' }}
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-primary shadow">
                      <Play size={17} fill="currentColor" />
                    </span>
                  </div>
                </div>
              )}
              {item.type === 'video' && (
                <div className={compact ? 'h-24 bg-muted/30' : 'bg-muted/30'}>
                  {compact ? (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <Video size={22} />
                    </div>
                  ) : (
                    <video src={item.url} controls className="max-h-56 w-full" />
                  )}
                </div>
              )}
              {item.type === 'document' && (
                <div className={`flex items-center gap-2 px-2 ${compact ? 'h-24' : 'py-3'}`}>
                  <span className={`flex flex-shrink-0 items-center justify-center rounded bg-muted text-muted-foreground ${compact ? 'h-12 w-12' : 'h-10 w-10'}`}>
                    <FileText size={compact ? 18 : 16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground" title={item.name}>{item.name || item.url}</div>
                    {!compact && item.size > 0 && (
                      <div className="text-[10px] text-muted-foreground">{formatBytes(item.size)}</div>
                    )}
                  </div>
                </div>
              )}
              {item.type === 'link' && (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                  <LinkIcon size={13} />
                  <span className="min-w-0 flex-1 truncate">{item.url}</span>
                  <ExternalLink size={12} className="shrink-0" />
                </div>
              )}
              {item.type === 'image' && !compact && (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                  <ImageIcon size={13} />
                  <span className="min-w-0 flex-1 truncate">{item.name || item.url}</span>
                  {item.size > 0 && <span className="shrink-0">{formatBytes(item.size)}</span>}
                  <ExternalLink size={12} className="shrink-0" />
                </div>
              )}
              {item.type === 'video' && !compact && (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                  <Video size={13} />
                  <span className="min-w-0 flex-1 truncate">{item.url}</span>
                  <ExternalLink size={12} className="shrink-0" />
                </div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
