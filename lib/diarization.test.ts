import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from './storage';
import {
  alignWhisperWithDiarization,
  formatSpeakerAwareTranscript,
  formatTimestamp,
  RawWhisperSegment
} from './alignment';
import { DiarizationSegment, Meeting, ProjectProfile } from './types';
import { ProjectProfileInput } from './validation';

let root: string;
let store: SqliteStorage;

function sampleProfile(): ProjectProfileInput & { id: string } {
  const projectId = randomUUID();
  const areaId = randomUUID();
  const surfaceId = randomUUID();
  const componentId = randomUUID();
  const taskId = randomUUID();
  const memberId1 = randomUUID();
  const memberId2 = randomUUID();

  return {
    id: projectId,
    name: 'Payments Engine',
    description: 'Core billing and payments infrastructure',
    instructions: 'Always link tasks to explicit evidence.',
    glossary: {},
    taskTypes: [{ id: taskId, name: 'Bug', description: 'Defect fix', position: 0 }],
    surfaces: [
      {
        id: surfaceId,
        name: 'Backend',
        description: 'Payment API services',
        components: [{ id: componentId, name: 'Webhooks', description: 'Callback receiver' }]
      }
    ],
    workAreas: [{ id: areaId, name: 'Backend', description: 'Server-side systems' }],
    members: [
      {
        id: memberId1,
        name: 'Alice Johnson',
        role: 'Tech Lead',
        skills: ['Python', 'Architecture'],
        responsibilities: ['Webhooks'],
        areaIds: [areaId],
        componentIds: [componentId],
        aliases: ['Alice'],
        email: null,
        externalId: null,
        active: true
      },
      {
        id: memberId2,
        name: 'Bob Smith',
        role: 'Infrastructure Engineer',
        skills: ['Kubernetes', 'DevOps'],
        responsibilities: ['Deployment'],
        areaIds: [areaId],
        componentIds: [componentId],
        aliases: ['Bob'],
        email: null,
        externalId: null,
        active: true
      }
    ],
    assignmentRules: [],
    documents: []
  };
}

function createSampleMeeting(id: string, project: ProjectProfile): Meeting {
  return {
    id,
    inputType: 'recording',
    title: 'Standup & Triage',
    meetingType: 'Standup',
    context: null,
    projectId: project.id,
    projectSnapshot: {
      id: project.id,
      name: project.name,
      description: project.description,
      instructions: project.instructions,
      glossary: project.glossary,
      taskTypes: project.taskTypes,
      surfaces: project.surfaces,
      workAreas: project.workAreas,
      members: project.members,
      assignmentRules: project.assignmentRules,
      documents: project.documents
    },
    originalFileName: 'standup.m4a',
    fileUrl: '/uploads/standup.m4a',
    fileSize: 1024 * 1024,
    duration: 60,
    status: 'transcribed',
    stage: 'complete',
    progress: 100,
    error: null,
    diagnostic: null,
    transcript: '',
    transcriptSegments: [],
    summary: null,
    topics: [],
    decisions: [],
    diarizationStatus: 'not_started',
    diarizationError: null,
    speakerCount: null,
    speakerMappings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'diarization-test-'));
  store = new SqliteStorage(path.join(root, 'app.sqlite'), {
    dataDir: root,
    legacyDataDir: path.join(root, 'legacy')
  });
});

afterEach(async () => {
  store.close();
  await rm(root, { recursive: true, force: true });
});

describe('Speaker Diarization & Alignment', () => {
  describe('Timestamp formatting helpers', () => {
    it('formats milliseconds into [MM:SS] accurately', () => {
      expect(formatTimestamp(0)).toBe('00:00');
      expect(formatTimestamp(4500)).toBe('00:04');
      expect(formatTimestamp(65000)).toBe('01:05');
      expect(formatTimestamp(3661000)).toBe('61:01');
      expect(formatTimestamp(null)).toBe('00:00');
    });
  });

  describe('Whisper & Diarization Alignment', () => {
    it('aligns single speaker turn with exact anonymous speaker ID', () => {
      const whisper: RawWhisperSegment[] = [
        { startMs: 0, endMs: 4000, text: 'We need to migrate the database schema.' }
      ];
      const diarization: DiarizationSegment[] = [
        { start: 0.0, end: 4.2, speakerId: 'SPEAKER_00', confidence: 0.95 }
      ];

      const aligned = alignWhisperWithDiarization(whisper, diarization);

      expect(aligned).toHaveLength(1);
      expect(aligned[0].speakerId).toBe('SPEAKER_00');
      expect(aligned[0].speaker).toBe('SPEAKER_00');
      expect(aligned[0].startMs).toBe(0);
      expect(aligned[0].endMs).toBe(4000);
      expect(aligned[0].text).toBe('We need to migrate the database schema.');
    });

    it('splits multi-speaker turn cleanly at punctuation boundary without modifying text', () => {
      const whisper: RawWhisperSegment[] = [
        {
          startMs: 0,
          endMs: 10000,
          text: 'I will handle the webhook retries. Sounds good, make sure to test it.'
        }
      ];
      const diarization: DiarizationSegment[] = [
        { start: 0.0, end: 4.5, speakerId: 'SPEAKER_00', confidence: 0.92 },
        { start: 4.6, end: 10.0, speakerId: 'SPEAKER_01', confidence: 0.88 }
      ];

      const aligned = alignWhisperWithDiarization(whisper, diarization);

      expect(aligned).toHaveLength(2);
      expect(aligned[0].speakerId).toBe('SPEAKER_00');
      expect(aligned[0].text).toBe('I will handle the webhook retries.');
      expect(aligned[1].speakerId).toBe('SPEAKER_01');
      expect(aligned[1].text).toBe('Sounds good, make sure to test it.');

      // Verify no words were lost or corrupted
      const joinedOriginal = whisper[0].text.replace(/\s+/g, ' ');
      const joinedAligned = `${aligned[0].text} ${aligned[1].text}`.replace(/\s+/g, ' ');
      expect(joinedAligned).toBe(joinedOriginal);
    });

    it('handles multiple distinct speakers across sequential turns', () => {
      const whisper: RawWhisperSegment[] = [
        { startMs: 0, endMs: 3000, text: 'First speaker turn here.' },
        { startMs: 3200, endMs: 6000, text: 'Second speaker chiming in.' },
        { startMs: 6200, endMs: 9000, text: 'Third speaker concluding the point.' }
      ];
      const diarization: DiarizationSegment[] = [
        { start: 0.0, end: 3.1, speakerId: 'SPEAKER_00', confidence: 0.9 },
        { start: 3.2, end: 6.0, speakerId: 'SPEAKER_01', confidence: 0.9 },
        { start: 6.1, end: 9.2, speakerId: 'SPEAKER_02', confidence: 0.9 }
      ];

      const aligned = alignWhisperWithDiarization(whisper, diarization);

      expect(aligned).toHaveLength(3);
      expect(aligned[0].speakerId).toBe('SPEAKER_00');
      expect(aligned[1].speakerId).toBe('SPEAKER_01');
      expect(aligned[2].speakerId).toBe('SPEAKER_02');
      expect(aligned.map(a => a.sequence)).toEqual([0, 1, 2]);
    });

    it('handles overlapping speech by assigning dominant speaker by temporal duration', () => {
      const whisper: RawWhisperSegment[] = [
        { startMs: 1000, endMs: 7000, text: 'Long monologue explaining the architecture.' }
      ];
      // SPEAKER_00 speaks for almost entire 6s, SPEAKER_01 interjects with brief 200ms sound
      const diarization: DiarizationSegment[] = [
        { start: 1.0, end: 7.0, speakerId: 'SPEAKER_00', confidence: 0.95 },
        { start: 3.0, end: 3.2, speakerId: 'SPEAKER_01', confidence: 0.6 }
      ];

      const aligned = alignWhisperWithDiarization(whisper, diarization);

      expect(aligned).toHaveLength(1);
      expect(aligned[0].speakerId).toBe('SPEAKER_00');
      expect(aligned[0].text).toBe('Long monologue explaining the architecture.');
    });

    it('falls back gracefully when diarization is unavailable or empty', () => {
      const whisper: RawWhisperSegment[] = [
        { startMs: 0, endMs: 3000, text: 'Audio transcribed without diarization.' },
        { startMs: 3500, endMs: 6000, text: 'Second segment without diarization.' }
      ];

      const aligned = alignWhisperWithDiarization(whisper, []);

      expect(aligned).toHaveLength(2);
      expect(aligned[0].speakerId).toBeNull();
      expect(aligned[0].speaker).toBeNull();
      expect(aligned[0].text).toBe('Audio transcribed without diarization.');
      expect(aligned[1].speakerId).toBeNull();
      expect(aligned[1].text).toBe('Second segment without diarization.');
    });

    it('formats speaker-aware transcript with timestamps and mapped names', () => {
      const segments = [
        {
          id: 'seg-1',
          sequence: 0,
          startMs: 0,
          endMs: 4000,
          speakerId: 'SPEAKER_00',
          speakerConfidence: 0.95,
          speaker: 'SPEAKER_00',
          text: 'Hello everyone.'
        },
        {
          id: 'seg-2',
          sequence: 1,
          startMs: 4500,
          endMs: 8000,
          speakerId: 'SPEAKER_01',
          speakerConfidence: 0.9,
          speaker: 'SPEAKER_01',
          text: 'Hi Alice, let us begin.'
        }
      ];

      // Format without mappings
      const unmapped = formatSpeakerAwareTranscript(segments);
      expect(unmapped).toContain('[00:00 - 00:04] SPEAKER_00:\nHello everyone.');
      expect(unmapped).toContain('[00:04 - 00:08] SPEAKER_01:\nHi Alice, let us begin.');

      // Format with mappings
      const mapped = formatSpeakerAwareTranscript(segments, { SPEAKER_00: 'Alice Johnson' });
      expect(mapped).toContain('[00:00 - 00:04] Alice Johnson (SPEAKER_00):\nHello everyone.');
      expect(mapped).toContain('[00:04 - 00:08] SPEAKER_01:\nHi Alice, let us begin.');
    });
  });

  describe('Storage, User Speaker Mapping & Project Isolation', () => {
    it('persists diarization metadata and segments with anonymous speaker IDs', async () => {
      const profile = await store.saveProject(sampleProfile());
      const m = createSampleMeeting(randomUUID(), profile);
      m.diarizationStatus = 'completed';
      m.speakerCount = 2;
      m.transcriptSegments = [
        {
          id: randomUUID(),
          meetingId: m.id,
          sequence: 0,
          startMs: 0,
          endMs: 3000,
          speaker: 'SPEAKER_00',
          speakerId: 'SPEAKER_00',
          speakerConfidence: 0.95,
          text: 'Shall we deploy to staging?'
        },
        {
          id: randomUUID(),
          meetingId: m.id,
          sequence: 1,
          startMs: 3500,
          endMs: 6000,
          speaker: 'SPEAKER_01',
          speakerId: 'SPEAKER_01',
          speakerConfidence: 0.92,
          text: 'Yes, go ahead.'
        }
      ];

      await store.saveMeeting(m);
      const loaded = (await store.getMeeting(m.id)).meeting;

      expect(loaded?.diarizationStatus).toBe('completed');
      expect(loaded?.speakerCount).toBe(2);
      expect(loaded?.transcriptSegments).toHaveLength(2);
      expect(loaded?.transcriptSegments[0].speakerId).toBe('SPEAKER_00');
      expect(loaded?.transcriptSegments[0].speaker).toBe('SPEAKER_00');
      expect(loaded?.transcriptSegments[1].speakerId).toBe('SPEAKER_01');
    });

    it('allows explicit user mapping of anonymous speaker to active project member', async () => {
      const profile = await store.saveProject(sampleProfile());
      const alice = profile.members[0];
      const m = createSampleMeeting(randomUUID(), profile);
      m.transcriptSegments = [
        {
          id: randomUUID(),
          meetingId: m.id,
          sequence: 0,
          startMs: 0,
          endMs: 3000,
          speaker: 'SPEAKER_00',
          speakerId: 'SPEAKER_00',
          speakerConfidence: 0.95,
          text: 'Reviewing the PR.'
        }
      ];

      await store.saveMeeting(m);

      // Set user mapping: SPEAKER_00 -> Alice Johnson
      const mappings = store.setSpeakerMapping(m.id, 'SPEAKER_00', alice.id);
      expect(mappings).toEqual([{ speakerId: 'SPEAKER_00', memberId: alice.id }]);

      // Verify meeting transcript segments display updated name with speaker ID
      const loaded = (await store.getMeeting(m.id)).meeting;
      expect(loaded?.transcriptSegments[0].speaker).toBe('Alice Johnson (SPEAKER_00)');
      expect(loaded?.transcriptSegments[0].speakerId).toBe('SPEAKER_00');
    });

    it('rejects mapping a speaker to a member ID that does not belong to the project', async () => {
      const profile = await store.saveProject(sampleProfile());
      const m = createSampleMeeting(randomUUID(), profile);
      await store.saveMeeting(m);

      expect(() => {
        store.setSpeakerMapping(m.id, 'SPEAKER_00', 'non-existent-member-id');
      }).toThrow(/Selected member does not belong to this project/);
    });

    it('allows clearing an existing speaker mapping back to anonymous ID', async () => {
      const profile = await store.saveProject(sampleProfile());
      const alice = profile.members[0];
      const m = createSampleMeeting(randomUUID(), profile);
      m.transcriptSegments = [
        {
          id: randomUUID(),
          meetingId: m.id,
          sequence: 0,
          startMs: 0,
          endMs: 3000,
          speaker: 'SPEAKER_00',
          speakerId: 'SPEAKER_00',
          speakerConfidence: 0.95,
          text: 'PR review done.'
        }
      ];
      await store.saveMeeting(m);

      // Map to Alice
      store.setSpeakerMapping(m.id, 'SPEAKER_00', alice.id);
      let loaded = (await store.getMeeting(m.id)).meeting;
      expect(loaded?.transcriptSegments[0].speaker).toBe('Alice Johnson (SPEAKER_00)');

      // Clear mapping
      store.setSpeakerMapping(m.id, 'SPEAKER_00', null);
      loaded = (await store.getMeeting(m.id)).meeting;
      expect(loaded?.transcriptSegments[0].speaker).toBe('SPEAKER_00');
      expect(loaded?.speakerMappings).toEqual([]);
    });

    it('ensures speaker mappings are strictly isolated between meetings', async () => {
      const profile = await store.saveProject(sampleProfile());
      const alice = profile.members[0];
      const bob = profile.members[1];

      const meetingA = createSampleMeeting(randomUUID(), profile);
      meetingA.transcriptSegments = [
        {
          id: randomUUID(),
          meetingId: meetingA.id,
          sequence: 0,
          startMs: 0,
          endMs: 2000,
          speaker: 'SPEAKER_00',
          speakerId: 'SPEAKER_00',
          speakerConfidence: 0.9,
          text: 'Meeting A text.'
        }
      ];

      const meetingB = createSampleMeeting(randomUUID(), profile);
      meetingB.transcriptSegments = [
        {
          id: randomUUID(),
          meetingId: meetingB.id,
          sequence: 0,
          startMs: 0,
          endMs: 2000,
          speaker: 'SPEAKER_00',
          speakerId: 'SPEAKER_00',
          speakerConfidence: 0.9,
          text: 'Meeting B text.'
        }
      ];

      await store.saveMeeting(meetingA);
      await store.saveMeeting(meetingB);

      // Map SPEAKER_00 in Meeting A to Alice
      store.setSpeakerMapping(meetingA.id, 'SPEAKER_00', alice.id);

      // Map SPEAKER_00 in Meeting B to Bob
      store.setSpeakerMapping(meetingB.id, 'SPEAKER_00', bob.id);

      const loadedA = (await store.getMeeting(meetingA.id)).meeting;
      const loadedB = (await store.getMeeting(meetingB.id)).meeting;

      expect(loadedA?.transcriptSegments[0].speaker).toBe('Alice Johnson (SPEAKER_00)');
      expect(loadedB?.transcriptSegments[0].speaker).toBe('Bob Smith (SPEAKER_00)');
      expect(store.getSpeakerMappings(meetingA.id)[0].memberId).toBe(alice.id);
      expect(store.getSpeakerMappings(meetingB.id)[0].memberId).toBe(bob.id);
    });

    it('never automatically infers speaker identity from task assignee or context', async () => {
      const profile = await store.saveProject(sampleProfile());
      const alice = profile.members[0];
      const m = createSampleMeeting(randomUUID(), profile);
      m.transcriptSegments = [
        {
          id: randomUUID(),
          meetingId: m.id,
          sequence: 0,
          startMs: 0,
          endMs: 3000,
          speaker: 'SPEAKER_00',
          speakerId: 'SPEAKER_00',
          speakerConfidence: 0.95,
          text: 'Alice, could you please fix the webhook timeout bug by Friday?'
        },
        {
          id: randomUUID(),
          meetingId: m.id,
          sequence: 1,
          startMs: 3500,
          endMs: 5000,
          speaker: 'SPEAKER_01',
          speakerId: 'SPEAKER_01',
          speakerConfidence: 0.92,
          text: 'Sure, I will take care of it.'
        }
      ];
      await store.saveMeeting(m);

      // Create a task candidate where assignee is resolved to Alice
      await store.saveTask({
        id: randomUUID(),
        meetingId: m.id,
        title: 'Fix webhook timeout bug',
        description: 'Resolve timeout issue in webhooks callback',
        type: 'Bug',
        surface: 'Backend',
        area: 'Backend',
        component: 'Webhooks',
        projectReferences: [],
        referenceVersionIds: [],
        priority: 'high',
        assignee: alice.id,
        assigneeName: alice.name,
        assignmentEvidence: 'explicit',
        assignmentSource: 'meeting',
        assignmentNeedsReview: false,
        assignmentReason: 'Directly assigned to Alice in meeting',
        deadline: '2026-10-10',
        context: 'Standup discussion',
        sourceTimestamp: '00:00',
        acceptanceCriteria: ['Webhooks timeout resolved'],
        evidence: [],
        sourceQuote: 'Alice, could you please fix the webhook timeout bug',
        confidence: 0.95,
        status: 'detected',
        rejectionReason: null,
        createdTicketId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Verify that speaker mappings were NOT automatically inferred or populated
      const mappings = store.getSpeakerMappings(m.id);
      expect(mappings).toEqual([]);

      const loaded = (await store.getMeeting(m.id)).meeting;
      expect(loaded?.transcriptSegments[0].speaker).toBe('SPEAKER_00');
      expect(loaded?.transcriptSegments[1].speaker).toBe('SPEAKER_01');
      expect(loaded?.speakerMappings).toEqual([]);
    });
  });
});
