import { NextResponse } from 'next/server';
import { getMeeting, saveMeeting } from '@/lib/store';
import { cancelJob } from '@/lib/job-manager';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { meeting } = await getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 });
  }

  const cancelled = cancelJob(id);

  if (['queued', 'transcribing', 'transcribed', 'analyzing', 'processing'].includes(meeting.status)) {
    meeting.status = 'failed';
    meeting.stage = 'Cancelled';
    meeting.diagnostic = null;
    meeting.error = 'Processing was stopped by user.';
    meeting.updatedAt = new Date().toISOString();
    await saveMeeting(meeting);
    logger.info('Meeting processing stopped via API', { meetingId: id, cancelledActiveJob: cancelled });
  }

  return NextResponse.json({ success: true, message: 'Processing stopped.' });
}
