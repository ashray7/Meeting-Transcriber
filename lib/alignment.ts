import { randomUUID } from 'node:crypto';
import { DiarizationSegment, TranscriptSegment } from './types';

export interface RawWhisperSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface AlignedSegment {
  id?: string;
  meetingId?: string;
  sequence: number;
  startMs: number;
  endMs: number;
  speakerId: string | null;
  speakerConfidence: number | null;
  speaker: string | null;
  text: string;
}

interface SpeakerOverlap {
  speakerId: string;
  overlapMs: number;
  firstStartMs: number;
  lastEndMs: number;
  confidence: number | null;
}

/**
 * Finds candidate split indices in text (preferring sentences, then phrases, then words).
 */
function findBestSplitIndex(text: string, targetRatio: number): number {
  if (text.length <= 1) return 0;
  const targetIndex = Math.floor(text.length * targetRatio);

  // 1. Check for sentence boundaries (. ! ?)
  const sentenceRegex = /[.!?]\s+/g;
  let match: RegExpExecArray | null;
  let bestSentenceIdx = -1;
  let bestSentenceDist = Infinity;

  while ((match = sentenceRegex.exec(text)) !== null) {
    const splitPoint = match.index + match[0].length;
    const dist = Math.abs(splitPoint - targetIndex);
    if (dist < bestSentenceDist) {
      bestSentenceDist = dist;
      bestSentenceIdx = splitPoint;
    }
  }

  // If a sentence break is reasonably close (within 35% of text length), use it
  if (bestSentenceIdx > 0 && bestSentenceDist < text.length * 0.35) {
    return bestSentenceIdx;
  }

  // 2. Check for clause boundaries (, ; :)
  const clauseRegex = /[,;:]\s+/g;
  let bestClauseIdx = -1;
  let bestClauseDist = Infinity;

  while ((match = clauseRegex.exec(text)) !== null) {
    const splitPoint = match.index + match[0].length;
    const dist = Math.abs(splitPoint - targetIndex);
    if (dist < bestClauseDist) {
      bestClauseDist = dist;
      bestClauseIdx = splitPoint;
    }
  }

  if (bestClauseIdx > 0 && bestClauseDist < text.length * 0.25) {
    return bestClauseIdx;
  }

  // 3. Fallback: closest word boundary (whitespace)
  const words = text.split(/(\s+)/);
  let accumulated = 0;
  let bestWordIdx = -1;
  let bestWordDist = Infinity;

  for (let i = 0; i < words.length; i++) {
    accumulated += words[i].length;
    if (i % 2 === 1) {
      // this is a whitespace token
      const dist = Math.abs(accumulated - targetIndex);
      if (dist < bestWordDist) {
        bestWordDist = dist;
        bestWordIdx = accumulated;
      }
    }
  }

  if (bestWordIdx > 0) {
    return bestWordIdx;
  }

  return targetIndex;
}

/**
 * Aligns Whisper transcription segments with pyannote diarization timestamps.
 * If a Whisper segment overlaps multiple distinct speaker turns, it splits the text
 * cleanly at punctuation or word boundaries to preserve speech attribution without modifying wording.
 */
export function alignWhisperWithDiarization(
  whisperSegments: RawWhisperSegment[],
  diarizationSegments: DiarizationSegment[],
  meetingId?: string
): AlignedSegment[] {
  if (!whisperSegments.length) return [];

  // If no diarization is available, return raw segments with null speakerId
  if (!diarizationSegments || !diarizationSegments.length) {
    return whisperSegments.map((w, index) => ({
      id: randomUUID(),
      meetingId,
      sequence: index,
      startMs: w.startMs,
      endMs: w.endMs,
      speakerId: null,
      speakerConfidence: null,
      speaker: null,
      text: w.text.trim()
    }));
  }

  const sortedDiarization = [...diarizationSegments].sort((a, b) => a.start - b.start);
  const aligned: AlignedSegment[] = [];

  for (const whisper of whisperSegments) {
    const wStart = whisper.startMs;
    const wEnd = Math.max(whisper.endMs, wStart + 100);
    const wDuration = wEnd - wStart;
    const text = whisper.text.trim();

    if (!text) continue;

    // Find all diarization segments overlapping with this Whisper segment
    const overlaps: SpeakerOverlap[] = [];
    const speakerMap = new Map<string, SpeakerOverlap>();

    for (const d of sortedDiarization) {
      const dStartMs = Math.round(d.start * 1000);
      const dEndMs = Math.round(d.end * 1000);

      const overlapStart = Math.max(wStart, dStartMs);
      const overlapEnd = Math.min(wEnd, dEndMs);
      const overlapDuration = overlapEnd - overlapStart;

      // Only count if there is significant overlap (at least 50ms)
      if (overlapDuration >= 50) {
        let existing = speakerMap.get(d.speakerId);
        if (!existing) {
          existing = {
            speakerId: d.speakerId,
            overlapMs: 0,
            firstStartMs: overlapStart,
            lastEndMs: overlapEnd,
            confidence: d.confidence ?? null
          };
          speakerMap.set(d.speakerId, existing);
          overlaps.push(existing);
        }
        existing.overlapMs += overlapDuration;
        existing.firstStartMs = Math.min(existing.firstStartMs, overlapStart);
        existing.lastEndMs = Math.max(existing.lastEndMs, overlapEnd);
      }
    }

    // Case 1: No speaker overlap found
    if (!overlaps.length) {
      aligned.push({
        id: randomUUID(),
        sequence: aligned.length,
        startMs: wStart,
        endMs: wEnd,
        speakerId: null,
        speakerConfidence: null,
        speaker: null,
        text
      });
      continue;
    }

    // Case 2: Exactly 1 speaker or 1 overwhelming dominant speaker (>85% of speech and others <300ms)
    overlaps.sort((a, b) => b.overlapMs - a.overlapMs);
    const dominant = overlaps[0];
    const isSingleDominant =
      overlaps.length === 1 ||
      (dominant.overlapMs / wDuration >= 0.85 &&
        overlaps.slice(1).every(o => o.overlapMs < 300));

    if (isSingleDominant) {
      const confidence = dominant.confidence ?? Math.min(1.0, dominant.overlapMs / wDuration);
      aligned.push({
        id: randomUUID(),
        sequence: aligned.length,
        startMs: wStart,
        endMs: wEnd,
        speakerId: dominant.speakerId,
        speakerConfidence: Number(confidence.toFixed(2)),
        speaker: dominant.speakerId,
        text
      });
      continue;
    }

    // Case 3: Multiple distinct speakers with substantial overlap in this Whisper segment!
    // Sort chronologically by first start time
    const chronologicalSpeakers = [...overlaps].sort((a, b) => a.firstStartMs - b.firstStartMs);

    // Calculate transition points within the segment
    const transitions: Array<{ speakerId: string; startMs: number; endMs: number; splitTimeMs: number }> = [];

    for (let i = 0; i < chronologicalSpeakers.length; i++) {
      const current = chronologicalSpeakers[i];
      const next = chronologicalSpeakers[i + 1];

      const segStart = i === 0 ? wStart : Math.max(wStart, current.firstStartMs);
      const segEnd = next
        ? Math.round((current.lastEndMs + next.firstStartMs) / 2)
        : wEnd;

      transitions.push({
        speakerId: current.speakerId,
        startMs: segStart,
        endMs: Math.min(wEnd, Math.max(segStart + 50, segEnd)),
        splitTimeMs: segEnd
      });
    }

    // Split text across the transitions
    let remainingText = text;
    let currentStartMs = wStart;

    for (let i = 0; i < transitions.length; i++) {
      const trans = transitions[i];
      const isLast = i === transitions.length - 1;

      if (isLast || !remainingText) {
        if (remainingText.trim()) {
          aligned.push({
            id: randomUUID(),
            sequence: aligned.length,
            startMs: currentStartMs,
            endMs: wEnd,
            speakerId: trans.speakerId,
            speakerConfidence: 0.9,
            speaker: trans.speakerId,
            text: remainingText.trim()
          });
        }
        break;
      }

      // Compute split ratio for remaining text
      const remainingDuration = wEnd - currentStartMs;
      const thisSegmentDuration = trans.endMs - currentStartMs;
      const ratio = remainingDuration > 0 ? Math.min(0.9, Math.max(0.1, thisSegmentDuration / remainingDuration)) : 0.5;

      const splitIndex = findBestSplitIndex(remainingText, ratio);
      const chunkText = remainingText.slice(0, splitIndex).trim();
      remainingText = remainingText.slice(splitIndex).trim();

      if (chunkText) {
        aligned.push({
          id: randomUUID(),
          sequence: aligned.length,
          startMs: currentStartMs,
          endMs: trans.endMs,
          speakerId: trans.speakerId,
          speakerConfidence: 0.9,
          speaker: trans.speakerId,
          text: chunkText
        });
      }
      currentStartMs = trans.endMs;
    }
  }

  // Re-sequence and return
  return aligned.map((seg, idx) => ({
    ...seg,
    sequence: idx,
    id: seg.id || randomUUID(),
    ...(meetingId ? { meetingId } : {})
  }));
}

/**
 * Formats milliseconds into [MM:SS] or [MM:SS.s] string.
 */
export function formatTimestamp(ms: number | null): string {
  if (ms === null || ms === undefined || ms < 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Formats aligned transcript segments into a standard speaker-aware transcript document.
 * Example:
 * [00:00 - 00:04] SPEAKER_00:
 * Okay, let's discuss the payment issue.
 */
export function formatSpeakerAwareTranscript(
  segments: AlignedSegment[] | TranscriptSegment[],
  speakerMappings?: Record<string, string>
): string {
  if (!segments.length) return '';

  return segments
    .map(seg => {
      const timeStr =
        seg.startMs !== null && seg.endMs !== null
          ? `[${formatTimestamp(seg.startMs)} - ${formatTimestamp(seg.endMs)}]`
          : seg.startMs !== null
          ? `[${formatTimestamp(seg.startMs)}]`
          : '';

      const speakerId = seg.speakerId || seg.speaker;
      let speakerLabel = '';

      if (speakerId) {
        const mappedName = speakerMappings?.[speakerId];
        if (mappedName) {
          speakerLabel = `${mappedName} (${speakerId}):\n`;
        } else {
          speakerLabel = `${speakerId}:\n`;
        }
      }

      const prefix = timeStr ? `${timeStr} ` : '';
      return `${prefix}${speakerLabel}${seg.text.trim()}`;
    })
    .join('\n\n');
}
