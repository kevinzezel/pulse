'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  X, Mic, Square, Send, CornerDownLeft, Loader, AlertTriangle, RotateCcw, Settings as SettingsIcon,
} from 'lucide-react';
import { useTranslation } from '@/providers/I18nProvider';
import { useIsMobile, useVisualViewportHeight } from '@/hooks/layout';
import { getIntelligenceConfig, transcribeVoiceAudio } from '@/services/api';

// Recording defaults — 16 kHz mono 16-bit PCM is the sweet spot for speech:
// small payload, well-supported by every speech model, and most browsers will
// happily downsample microphone input to it via AudioContext sampleRate.
const TARGET_SAMPLE_RATE = 16000;
// Keep the final inline WAV under the route's 8 MB limit:
// 16 kHz * 2 B * 60 s * 4 min ~= 7.7 MB.
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_RECORDING_SECONDS = 240;
const SOFT_WARN_SECONDS = 210;
// Mirror the client FastAPI send-text limit so we warn before the user hits it.
const SEND_TEXT_MAX_CHARS = 10000;

function encodeWavMono16(samples, sampleRate) {
  // samples: Float32Array in [-1, 1]
  const length = samples.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  function writeStr(offset, s) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  }

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);             // fmt chunk size
  view.setUint16(20, 1, true);              // PCM
  view.setUint16(22, 1, true);              // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono * 16-bit)
  view.setUint16(32, 2, true);              // block align
  view.setUint16(34, 16, true);             // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, length * 2, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    let s = samples[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    // 16-bit signed little endian
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

function flattenChunks(chunks, totalLength) {
  const out = new Float32Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

function resampleMono(samples, fromRate, toRate) {
  if (!Number.isFinite(fromRate) || fromRate <= 0 || fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const nextLength = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(nextLength);
  for (let i = 0; i < nextLength; i++) {
    const sourcePos = i * ratio;
    const left = Math.floor(sourcePos);
    const right = Math.min(left + 1, samples.length - 1);
    const frac = sourcePos - left;
    out[i] = samples[left] + (samples[right] - samples[left]) * frac;
  }
  return out;
}

function fmtMmss(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

function VoiceWaveform({ analyser, active }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser || !active) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    let rafId = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const dataArray = new Uint8Array(analyser.fftSize);
    // Resolve theme tokens against the live computed style so the waveform
    // tracks theme switches and doesn't get baked at mount time.
    function getColor(varName, fallback) {
      const root = document.documentElement;
      const v = getComputedStyle(root).getPropertyValue(varName).trim();
      return v ? `hsl(${v})` : fallback;
    }

    function draw() {
      analyser.getByteTimeDomainData(dataArray);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const baseline = h / 2;
      // Center guideline
      ctx.strokeStyle = getColor('--border', '#444');
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      ctx.moveTo(0, baseline);
      ctx.lineTo(w, baseline);
      ctx.stroke();

      // Waveform line
      ctx.strokeStyle = getColor('--primary', '#7c3aed');
      ctx.lineWidth = Math.max(2, 2 * dpr);
      ctx.beginPath();
      const slice = w / dataArray.length;
      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0; // 0..2
        const y = (v * h) / 2;
        const x = i * slice;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      rafId = requestAnimationFrame(draw);
    }
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [analyser, active]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block rounded"
      style={{ background: 'hsl(var(--card))' }}
    />
  );
}

export default function VoiceCommandModal({ sessionName, onSend, onClose }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const vvHeight = useVisualViewportHeight();

  // Phases:
  //   'checking' → fetching intelligence config
  //   'not-configured' → no Gemini key; show CTA
  //   'requesting' → asking for mic permission
  //   'recording' → live mic + waveform
  //   'transcribing' → audio uploaded, waiting on Gemini
  //   'review' → editable transcript, ready to send
  //   'sending' → sending text to terminal
  //   'error' → with a localized message + retry/back actions
  const [phase, setPhase] = useState('checking');
  const [errorKey, setErrorKey] = useState(null);
  const [errorParams, setErrorParams] = useState(null);
  const [errorOrigin, setErrorOrigin] = useState(null); // 'permission' | 'transcription' | 'send' | 'config'
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [analyser, setAnalyser] = useState(null);

  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const analyserRef = useRef(null);
  const chunksRef = useRef([]);
  const totalSamplesRef = useRef(0);
  const sampleRateRef = useRef(TARGET_SAMPLE_RATE);
  const tickRef = useRef(null);
  const startedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const transcriptRef = useRef('');
  const taRef = useRef(null);
  const phaseRef = useRef('checking');
  const finishingRef = useRef(false);
  const abortRef = useRef(null);

  const stopAndCleanupAudio = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    try { processorRef.current?.disconnect(); } catch {}
    try { sourceRef.current?.disconnect(); } catch {}
    try { analyserRef.current?.disconnect(); } catch {}
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      // Some browsers throw if close() is called twice — swallow it.
      audioCtxRef.current.close().catch(() => {});
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try { track.stop(); } catch {}
      }
    }
    processorRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current = null;
    streamRef.current = null;
    if (mountedRef.current) setAnalyser(null);
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => () => {
    mountedRef.current = false;
    abortRef.current?.abort();
    stopAndCleanupAudio();
  }, [stopAndCleanupAudio]);

  useEffect(() => {
    if (!mountedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getIntelligenceConfig();
        if (cancelled) return;
        const configured = !!data?.providers?.gemini?.configured;
        if (!configured) {
          setPhase('not-configured');
          return;
        }
        await beginRecording();
      } catch (err) {
        if (cancelled) return;
        setErrorOrigin('config');
        setErrorKey(err?.detail_key || 'errors.intelligence.gemini.config_load_failed');
        setErrorParams(err?.detail_params || null);
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function beginRecording() {
    if (typeof window === 'undefined') return;
    if (!navigator?.mediaDevices?.getUserMedia) {
      setErrorOrigin('permission');
      setErrorKey(window.isSecureContext === false
        ? 'errors.intelligence.voice.insecure_context'
        : 'errors.intelligence.voice.unsupported');
      setPhase('error');
      return;
    }
    setPhase('requesting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      setErrorOrigin('permission');
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        setErrorKey('errors.intelligence.voice.permission_denied');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setErrorKey('errors.intelligence.voice.no_device');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setErrorKey('errors.intelligence.voice.device_busy');
      } else {
        setErrorKey('errors.intelligence.voice.permission_failed');
        setErrorParams({ reason: err?.message || String(err) });
      }
      setPhase('error');
      return;
    }
    if (!mountedRef.current) {
      for (const track of stream.getTracks()) try { track.stop(); } catch {}
      return;
    }
    streamRef.current = stream;

    // Some browsers ignore the requested sampleRate (notably Safari < 16) and
    // clamp to the device default — read back what we actually got and use
    // that for the WAV header so the upload isn't time-stretched/squashed.
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      stopAndCleanupAudio();
      setErrorOrigin('permission');
      setErrorKey('errors.intelligence.voice.unsupported');
      setPhase('error');
      return;
    }
    let ctx;
    try {
      ctx = new Ctx({ sampleRate: TARGET_SAMPLE_RATE });
    } catch {
      ctx = new Ctx();
    }
    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {}
    audioCtxRef.current = ctx;
    sampleRateRef.current = ctx.sampleRate || TARGET_SAMPLE_RATE;

    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;

    const localAnalyser = ctx.createAnalyser();
    localAnalyser.fftSize = 1024;
    localAnalyser.smoothingTimeConstant = 0.7;
    source.connect(localAnalyser);
    analyserRef.current = localAnalyser;
    setAnalyser(localAnalyser);

    // ScriptProcessorNode is deprecated, but it's the only way to reliably
    // capture PCM in a single short file across all current browsers without
    // pulling in an AudioWorklet module. Buffer of 4096 keeps the callback
    // rate sane (~10 Hz at 44.1 kHz, ~4 Hz at 16 kHz).
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    chunksRef.current = [];
    totalSamplesRef.current = 0;

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      // Copy because the underlying buffer gets reused on the next callback.
      const copy = new Float32Array(input.length);
      copy.set(input);
      chunksRef.current.push(copy);
      totalSamplesRef.current += copy.length;
    };

    source.connect(processor);
    // Connect to destination at zero gain — required to get the processor
    // callback to fire in some browsers. We'd hear ourselves otherwise.
    const muteNode = ctx.createGain();
    muteNode.gain.value = 0;
    processor.connect(muteNode);
    muteNode.connect(ctx.destination);

    startedAtRef.current = performance.now();
    setSeconds(0);
    tickRef.current = setInterval(() => {
      const elapsed = (performance.now() - startedAtRef.current) / 1000;
      if (!mountedRef.current) return;
      setSeconds(elapsed);
      if (elapsed >= MAX_RECORDING_SECONDS) {
        // Auto-stop on hard cap so the upload stays under the inline limit.
        finishRecording();
      }
    }, 200);

    setPhase('recording');
  }

  async function finishRecording() {
    if (!mountedRef.current) return;
    if (phaseRef.current !== 'recording' || finishingRef.current) return;
    finishingRef.current = true;

    const samples = totalSamplesRef.current;
    const sampleRate = sampleRateRef.current || TARGET_SAMPLE_RATE;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    totalSamplesRef.current = 0;

    setPhase('transcribing');
    stopAndCleanupAudio();

    if (samples === 0) {
      setErrorOrigin('transcription');
      setErrorKey('errors.intelligence.voice.empty_audio');
      setPhase('error');
      finishingRef.current = false;
      return;
    }

    let blob;
    try {
      const flat = flattenChunks(chunks, samples);
      const resampled = resampleMono(flat, sampleRate, TARGET_SAMPLE_RATE);
      blob = encodeWavMono16(resampled, TARGET_SAMPLE_RATE);
    } catch (err) {
      setErrorOrigin('transcription');
      setErrorKey('errors.intelligence.voice.encode_failed');
      setErrorParams({ reason: err?.message || String(err) });
      setPhase('error');
      finishingRef.current = false;
      return;
    }

    if (blob.size > MAX_AUDIO_BYTES) {
      setErrorOrigin('transcription');
      setErrorKey('errors.intelligence.audio_too_large');
      setErrorParams({ max_mb: Math.floor(MAX_AUDIO_BYTES / (1024 * 1024)) });
      setPhase('error');
      finishingRef.current = false;
      return;
    }

    try {
      abortRef.current = new AbortController();
      const data = await transcribeVoiceAudio(blob, 'voice.wav', { signal: abortRef.current.signal });
      abortRef.current = null;
      if (!mountedRef.current) return;
      const text = (typeof data?.transcript === 'string' ? data.transcript : '').trim();
      if (!text) {
        setErrorOrigin('transcription');
        setErrorKey('errors.intelligence.gemini.empty_transcript');
        setErrorParams({ reason: 'no-text' });
        setPhase('error');
        finishingRef.current = false;
        return;
      }
      transcriptRef.current = text;
      setTranscript(text);
      setPhase('review');
      // Defer focus so the textarea exists before we touch it.
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(text.length, text.length);
        }
      });
    } catch (err) {
      abortRef.current = null;
      if (!mountedRef.current) return;
      if (err?.name === 'AbortError') return;
      setErrorOrigin('transcription');
      setErrorKey(err?.detail_key || 'errors.intelligence.gemini.upstream_failed');
      setErrorParams(err?.detail_params || { reason: err?.message || String(err) });
      setPhase('error');
    } finally {
      finishingRef.current = false;
    }
  }

  function handleStartOver() {
    setErrorKey(null);
    setErrorParams(null);
    setErrorOrigin(null);
    setTranscript('');
    transcriptRef.current = '';
    setSeconds(0);
    beginRecording();
  }

  async function submit(sendEnter) {
    if (phase === 'sending') return;
    const text = transcript;
    const trimmed = text.trim();
    if (!trimmed) return;
    setPhase('sending');
    let sent = false;
    try {
      sent = (await onSend(text, sendEnter)) === true;
    } finally {
      if (!sent && mountedRef.current) setPhase('review');
    }
  }

  // ----- Render helpers -----

  const titleLabel = sessionName
    ? `${t('voice.title')} — ${sessionName}`
    : t('voice.title');

  const tooLong = transcript.length > SEND_TEXT_MAX_CHARS;
  const closeDisabled = phase === 'sending';

  function Header() {
    return (
      <header
        className="relative flex items-center justify-center px-3 py-2 border-b flex-shrink-0"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <span className="text-sm font-medium text-foreground truncate">{titleLabel}</span>
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={t('common.cancel')}
          aria-label={t('common.cancel')}
        >
          <X size={16} />
        </button>
      </header>
    );
  }

  function MicHeroBadge() {
    return (
      <div className="w-12 h-12 rounded-full bg-primary/10 inline-flex items-center justify-center">
        <Mic size={22} className="text-primary" />
      </div>
    );
  }

  function NotConfiguredBody() {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-10 text-center">
        <MicHeroBadge />
        <h3 className="text-base font-semibold text-foreground">
          {t('voice.notConfigured.title')}
        </h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          {t('voice.notConfigured.body')}
        </p>
        <Link
          href="/settings?tab=intelligence"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <SettingsIcon size={14} />
          {t('voice.notConfigured.openSettings')}
        </Link>
      </div>
    );
  }

  function ErrorBody() {
    const message = errorKey ? t(errorKey, errorParams || undefined) : t('voice.error.generic');
    const allowRetry = errorOrigin === 'permission' || errorOrigin === 'transcription';
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-10 text-center">
        <div className="w-12 h-12 rounded-full bg-destructive/10 inline-flex items-center justify-center">
          <AlertTriangle size={22} className="text-destructive" />
        </div>
        <p className="text-sm text-foreground max-w-md whitespace-pre-line">{message}</p>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {allowRetry && (
            <button
              type="button"
              onClick={handleStartOver}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              <RotateCcw size={14} />
              {t('voice.error.retry')}
            </button>
          )}
          {errorOrigin === 'config' || errorOrigin === 'permission' ? (
            <Link
              href="/settings?tab=intelligence"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-foreground hover:bg-muted/40 text-sm font-medium"
            >
              <SettingsIcon size={14} />
              {t('voice.notConfigured.openSettings')}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-foreground hover:bg-muted/40 text-sm font-medium"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    );
  }

  function RecordingBody() {
    const warn = seconds >= SOFT_WARN_SECONDS;
    return (
      <div className="flex-1 min-h-0 flex flex-col gap-4 p-4">
        <div className="flex-1 min-h-[140px] rounded border" style={{ borderColor: 'hsl(var(--border))' }}>
          <VoiceWaveform analyser={analyser} active={phase === 'recording'} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative inline-flex items-center justify-center w-3 h-3">
              <span className="absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive" />
            </span>
            <span className="text-sm font-mono text-foreground">{fmtMmss(seconds)}</span>
            <span className="text-xs text-muted-foreground">/ {fmtMmss(MAX_RECORDING_SECONDS)}</span>
          </div>
          {warn && (
            <span className="text-xs text-destructive">
              {t('voice.recording.softLimit', { max: fmtMmss(MAX_RECORDING_SECONDS) })}
            </span>
          )}
        </div>
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={finishRecording}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-destructive text-destructive-foreground hover:opacity-90 text-sm font-semibold shadow-md"
          >
            <Square size={16} />
            {t('voice.recording.stop')}
          </button>
        </div>
        <p className="text-xs text-muted-foreground text-center">
          {t('voice.recording.hint')}
        </p>
      </div>
    );
  }

  function PendingBody({ messageKey }) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-10">
        <Loader size={28} className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{t(messageKey)}</p>
      </div>
    );
  }

  function ReviewBody() {
    const sending = phase === 'sending';
    return (
      <>
        {isMobile && (
          <div
            className="px-3 py-2 border-b flex-shrink-0"
            style={{ borderColor: 'hsl(var(--border))' }}
          >
            <ReviewActions sending={sending} />
          </div>
        )}
        <textarea
          ref={taRef}
          value={transcript}
          onChange={(e) => {
            setTranscript(e.target.value);
            transcriptRef.current = e.target.value;
          }}
          className="flex-1 p-4 resize-none bg-transparent outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground"
          placeholder={t('voice.review.placeholder')}
          disabled={sending}
        />
        <div
          className="px-3 py-2 border-t flex-shrink-0 flex items-center justify-between gap-2"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <span
            className={`text-xs ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {tooLong
              ? t('voice.review.tooLong', { max: SEND_TEXT_MAX_CHARS, length: transcript.length })
              : t('voice.review.charCount', { length: transcript.length, max: SEND_TEXT_MAX_CHARS })}
          </span>
          <button
            type="button"
            onClick={handleStartOver}
            disabled={sending}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RotateCcw size={12} />
            {t('voice.review.recordAgain')}
          </button>
        </div>
        {!isMobile && (
          <div
            className="px-3 py-2 border-t flex-shrink-0"
            style={{ borderColor: 'hsl(var(--border))' }}
          >
            <ReviewActions sending={sending} />
          </div>
        )}
      </>
    );
  }

  function ReviewActions({ sending }) {
    const blocked = sending || tooLong || !transcript.trim();
    return (
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={blocked}
          className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium border border-border text-foreground hover:bg-muted/40 transition-colors disabled:opacity-60"
        >
          {sending ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
          {t('voice.review.send')}
        </button>
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={blocked}
          className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium text-white bg-brand-gradient hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {sending ? <Loader size={14} className="animate-spin" /> : <CornerDownLeft size={14} />}
          {t('voice.review.sendEnter')}
        </button>
      </div>
    );
  }

  let bodyContent = null;
  if (phase === 'checking' || phase === 'requesting') {
    bodyContent = (
      <PendingBody
        messageKey={phase === 'checking' ? 'voice.checking' : 'voice.requestingPermission'}
      />
    );
  } else if (phase === 'not-configured') {
    bodyContent = <NotConfiguredBody />;
  } else if (phase === 'recording') {
    bodyContent = <RecordingBody />;
  } else if (phase === 'transcribing') {
    bodyContent = <PendingBody messageKey="voice.transcribing" />;
  } else if (phase === 'review' || phase === 'sending') {
    bodyContent = <ReviewBody />;
  } else if (phase === 'error') {
    bodyContent = <ErrorBody />;
  }

  if (isMobile) {
    return (
      <div
        className="fixed inset-x-0 top-0 z-50 flex flex-col"
        style={{
          height: vvHeight ? `${vvHeight}px` : '100dvh',
          background: 'hsl(var(--background))',
        }}
      >
        <Header />
        {bodyContent}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 px-4 py-2">
      <div
        className="bg-card border border-border rounded-lg w-full max-w-3xl flex flex-col h-[calc(100vh-1rem)] overflow-hidden"
      >
        <Header />
        {bodyContent}
      </div>
    </div>
  );
}
