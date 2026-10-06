import { describe, it, expect, beforeEach } from 'vitest';
import { registerJob, unregisterJob, cancelJob, isJobActive } from './job-manager';

describe('Job Manager & Cancellation', () => {
  const meetingId = 'test-meeting-123';

  beforeEach(() => {
    unregisterJob(meetingId);
  });

  it('registers and tracks active job status', () => {
    const controller = new AbortController();
    expect(isJobActive(meetingId)).toBe(false);

    registerJob(meetingId, controller);
    expect(isJobActive(meetingId)).toBe(true);

    unregisterJob(meetingId);
    expect(isJobActive(meetingId)).toBe(false);
  });

  it('cancels active job and triggers abort signal', () => {
    const controller = new AbortController();
    let aborted = false;
    controller.signal.addEventListener('abort', () => {
      aborted = true;
    });

    registerJob(meetingId, controller);
    expect(isJobActive(meetingId)).toBe(true);

    const cancelled = cancelJob(meetingId);
    expect(cancelled).toBe(true);
    expect(aborted).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(isJobActive(meetingId)).toBe(false);
  });

  it('returns false when cancelling non-existent job', () => {
    expect(cancelJob('non-existent-id')).toBe(false);
  });

  it('handles multiple jobs independently', () => {
    const m1 = 'meeting-1';
    const m2 = 'meeting-2';
    const c1 = new AbortController();
    const c2 = new AbortController();

    registerJob(m1, c1);
    registerJob(m2, c2);

    expect(isJobActive(m1)).toBe(true);
    expect(isJobActive(m2)).toBe(true);

    cancelJob(m1);
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(false);
    expect(isJobActive(m1)).toBe(false);
    expect(isJobActive(m2)).toBe(true);

    unregisterJob(m2);
    expect(isJobActive(m2)).toBe(false);
  });
});

describe('Stop API Route', () => {
  it('returns 404 when meeting does not exist', async () => {
    const { POST } = await import('../app/api/meetings/[id]/stop/route');
    const response = await POST(new Request('http://localhost/api/meetings/invalid-id/stop', { method: 'POST' }), {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' })
    });
    expect(response.status).toBe(404);
  });

  it('stops an active meeting processing job and updates database state', async () => {
    const { POST } = await import('../app/api/meetings/[id]/stop/route');
    const { saveMeeting, getMeeting } = await import('./store');
    const testMeetingId = '99999999-9999-4999-9999-999999999999';

    // Seed a processing meeting
    await saveMeeting({
      id: testMeetingId,
      title: 'Active Processing Meeting',
      meetingType: 'planning',
      status: 'analyzing',
      stage: 'Analyzing meeting and identifying tasks',
      error: null,
      progress: 60,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fileUrl: '',
      fileSize: 1024,
      originalFileName: 'test.wav',
      inputType: 'recording',
      projectId: null,
      projectSnapshot: null,
      transcript: 'Hello team',
      transcriptSegments: [],
      context: null,
      duration: null,
      summary: null,
      topics: [],
      decisions: [],
      openQuestions: [],
      diagnostic: 'Testing',
      speakerCount: 1,
      diarizationStatus: 'completed',
      diarizationError: null
    });

    const controller = new AbortController();
    registerJob(testMeetingId, controller);
    expect(isJobActive(testMeetingId)).toBe(true);

    const response = await POST(new Request(`http://localhost/api/meetings/${testMeetingId}/stop`, { method: 'POST' }), {
      params: Promise.resolve({ id: testMeetingId })
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);

    // Controller should have been aborted
    expect(controller.signal.aborted).toBe(true);
    expect(isJobActive(testMeetingId)).toBe(false);

    // Meeting in database should be updated to failed / Cancelled
    const { meeting } = await getMeeting(testMeetingId);
    expect(meeting).toBeDefined();
    expect(meeting?.status).toBe('failed');
    expect(meeting?.stage).toBe('Cancelled');
    expect(meeting?.error).toBe('Processing was stopped by user.');
  });
});

