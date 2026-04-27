'use client';

import { ExternalLink, Image as ImageIcon, Link as LinkIcon, Play, Video } from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i;

function cleanUrl(raw) {
  return String(raw || '').replace(/[.,;:!?]+$/g, '');
}

function getYoutubeId(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || null;
    if (!host.endsWith('youtube.com')) return null;
    if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (['embed', 'shorts', 'live'].includes(parts[0])) return parts[1] || null;
  } catch {}
  return null;
}

export function extractTaskMedia(description) {
  const text = typeof description === 'string' ? description : '';
  const seen = new Set();
  const out = [];
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

export default function TaskMediaPreview({ description, compact = false }) {
  const { t } = useTranslation();
  const media = extractTaskMedia(description);
  const visible = compact ? media.slice(0, 1) : media;
  if (visible.length === 0) return null;

  return (
    <div className={compact ? 'mt-2' : 'mt-2 space-y-2'}>
      {!compact && (
        <div className="text-xs font-medium text-muted-foreground">{t('tasks.preview')}</div>
      )}
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
                  alt=""
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
            {item.type === 'link' && (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                <LinkIcon size={13} />
                <span className="min-w-0 flex-1 truncate">{item.url}</span>
                <ExternalLink size={12} className="shrink-0" />
              </div>
            )}
            {item.type !== 'link' && !compact && (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                {item.type === 'image' ? <ImageIcon size={13} /> : <Video size={13} />}
                <span className="min-w-0 flex-1 truncate">{item.url}</span>
                <ExternalLink size={12} className="shrink-0" />
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
