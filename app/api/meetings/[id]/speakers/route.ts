import { NextResponse } from 'next/server';
import { getMeeting, setSpeakerMapping, getSpeakerMappings } from '@/lib/store';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { meeting } = await getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 });
  }

  const mappings = getSpeakerMappings(id);
  const mappingMap = new Map(mappings.map(m => [m.speakerId, m.memberId]));
  const projectMembers = meeting.projectSnapshot?.members || [];
  const memberMap = new Map(projectMembers.map(m => [m.id, m.name]));

  // Aggregate detected speakers from transcript segments
  const speakerStats = new Map<
    string,
    { segmentCount: number; totalDurationMs: number }
  >();

  for (const seg of meeting.transcriptSegments || []) {
    const spkId = seg.speakerId || (seg.speaker && /^SPEAKER_\d+$/i.test(seg.speaker) ? seg.speaker : null);
    if (spkId) {
      const stats = speakerStats.get(spkId) || { segmentCount: 0, totalDurationMs: 0 };
      stats.segmentCount += 1;
      if (seg.startMs !== null && seg.endMs !== null && seg.endMs >= seg.startMs) {
        stats.totalDurationMs += seg.endMs - seg.startMs;
      }
      speakerStats.set(spkId, stats);
    }
  }

  // Also include any speakers that have mappings even if not in current segments
  for (const m of mappings) {
    if (!speakerStats.has(m.speakerId)) {
      speakerStats.set(m.speakerId, { segmentCount: 0, totalDurationMs: 0 });
    }
  }

  const speakerList = Array.from(speakerStats.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([speakerId, stats]) => {
      const memberId = mappingMap.get(speakerId) || null;
      const memberName = memberId ? memberMap.get(memberId) || 'Unknown member' : null;
      return {
        speakerId,
        memberId,
        memberName,
        segmentCount: stats.segmentCount,
        totalDurationMs: stats.totalDurationMs
      };
    });

  return NextResponse.json({
    diarizationStatus: meeting.diarizationStatus || 'not_started',
    diarizationError: meeting.diarizationError || null,
    speakerCount: meeting.speakerCount ?? speakerList.length,
    speakers: speakerList
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { meeting } = await getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  const { speakerId, memberId } = body as { speakerId?: unknown; memberId?: unknown };
  if (typeof speakerId !== 'string' || !speakerId.trim()) {
    return NextResponse.json({ error: 'speakerId is required.' }, { status: 400 });
  }

  const normalizedSpeakerId = speakerId.trim().toUpperCase();
  const normalizedMemberId = typeof memberId === 'string' && memberId.trim() ? memberId.trim() : null;

  try {
    const updatedMappings = setSpeakerMapping(id, normalizedSpeakerId, normalizedMemberId);
    logger.info('Updated speaker mapping', {
      meetingId: id,
      speakerId: normalizedSpeakerId,
      memberId: normalizedMemberId
    });

    return NextResponse.json({
      success: true,
      speakerId: normalizedSpeakerId,
      memberId: normalizedMemberId,
      mappings: updatedMappings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update speaker mapping.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

