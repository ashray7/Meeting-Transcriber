import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildStructuredTask, chunkTranscriptSegments, reconcileCandidateGroups, normalizeSupportedDeadline, DetectedCandidate } from './meeting-intelligence';
import { candidateDetectionSchema, reconciliationSchema, taskDraftSchema, taskDraftOutputSchema } from './validation';
import { ProjectSnapshot, TranscriptSegment } from './types';

const meetingId = randomUUID();
function segment(text: string, sequence = 0, speaker = 'Alex', startMs: number | null = sequence * 10000): TranscriptSegment {
  return { id: randomUUID(), meetingId, sequence, speaker, startMs, endMs: startMs === null ? null : startMs + 9000, text };
}
function detected(item: TranscriptSegment, kind: DetectedCandidate['kind'], intent: DetectedCandidate['intent'] = 'unclear'): DetectedCandidate {
  return { kind, intent, summary: item.text, evidenceSegmentIds: [item.id], confidence: 0.8 };
}
function project(): ProjectSnapshot {
  return { id: randomUUID(), name: 'Payments', description: '', instructions: '', glossary: {},
    taskTypes: [{ id: randomUUID(), name: 'Backend', description: '', position: 0 }],
    surfaces: [{ id: randomUUID(), name: 'Payments API', description: '', components: [{ id: randomUUID(), name: 'Callbacks', description: '' }] }],
    workAreas: [{ id: randomUUID(), name: 'Payments', description: '' }], members: [], assignmentRules: [], documents: [], };
}
function output(evidenceSegment: TranscriptSegment, patch: Record<string, unknown> = {}) {
  return taskDraftOutputSchema.parse({ title: 'Add callback retries', description: 'Add bounded retries for failed payment callbacks.', taskType: 'Backend', productSurface: 'Payments API', workArea: 'Payments', component: 'Callbacks', priority: null, mentionedPeople: [], deadlinePhrase: null, acceptanceCriteria: [], confidence: 0.9, evidenceQuotes: [{ segmentId: evidenceSegment.id, quote: evidenceSegment.text }], projectChunkExcerpts: [], priorityEvidence: { source: 'none', segmentIds: [], chunkIds: [], explanation: '' }, ...patch });
}
function reconciled(s: TranscriptSegment, intent: DetectedCandidate['intent'] = 'committed') {
  const candidate = detected(s, 'committed_action', intent);
  return reconcileCandidateGroups([candidate], reconciliationSchema.parse({ summary: 'Meeting summary', groups: [{ candidateIndexes: [0], kind: 'committed_action', intent, summary: 'Add callback retries', assignee: null, assignmentEvidence: 'none', deadlinePhrase: null, confidence: 0.9, mergeRationale: null }], decisions: [], openQuestions: [] }), [s])[0];
}

describe('meeting intelligence foundation', () => {
  it('validates candidate categories including discussion, idea, proposal, rejection, cancellation and deferment', () => {
    const kinds = ['discussion', 'information', 'question', 'status_update', 'idea', 'decision', 'proposal', 'committed_action'] as const;
    const intents = ['committed', 'proposed', 'rejected', 'cancelled', 'deferred', 'unclear'] as const;
    for (const kind of kinds) for (const intent of intents) {
      expect(candidateDetectionSchema.parse({ candidates: [{ kind, intent, summary: 'Grounded item', evidenceSegmentIds: [randomUUID()], confidence: 0.7 }], topics: [], decisions: [], openQuestions: [] }).candidates).toHaveLength(1);
    }
  });

  it('does not promote discussion, ideas, proposals, rejection or deferment to committed intent', () => {
    const s = segment('Maybe we should retry callbacks, but not this sprint.');
    for (const intent of ['proposed', 'rejected', 'cancelled', 'deferred', 'unclear'] as const) {
      expect(reconciled(s, intent).intent).toBe(intent);
    }
    const discussion = detected(s, 'discussion', 'unclear');
    expect(reconcileCandidateGroups([discussion], reconciliationSchema.parse({ summary: 'summary', groups: [], decisions: [], openQuestions: [] }), [s])[0].intent).toBe('unclear');
  });

  it('retains speaker, timestamps, IDs and canonical transcript text as task evidence', () => {
    const s = segment('I will add bounded retries to callbacks.', 2, 'Priya', 20000);
    const group = reconciled(s);
    const task = buildStructuredTask({ id: randomUUID(), meetingId, group, output: output(s), segments: [s], knowledge: [], project: project() });
    expect(task.evidence[0]).toMatchObject({ meetingId, segmentId: s.id, speaker: 'Priya', startMs: 20000, endMs: 29000, sourceText: s.text });
  });

  it('uses only exact project labels and marks unknown labels for review', () => {
    const s = segment('I will add bounded retries to callbacks.');
    const task = buildStructuredTask({ id: randomUUID(), meetingId, group: reconciled(s), output: output(s, { taskType: 'Mobile', productSurface: 'Mobile App' }), segments: [s], knowledge: [], project: project() });
    expect(task.taskType).toBeNull(); expect(task.productSurface).toBeNull(); expect(task.needsReview).toBe(true);
  });

  it('resolves explicit assignment evidence but drops an unknown assigned person', () => {
    const s = segment('I will do the callback retry work.');
    const group = { ...reconciled(s), assignee: 'Unknown Person', assignmentEvidence: 'explicit' as const };
    const task = buildStructuredTask({ id: randomUUID(), meetingId, group, output: output(s), segments: [s], knowledge: [], project: project() });
    expect(task.assignee).toBeNull(); expect(task.assignmentEvidence).toBe('none'); expect(task.needsReview).toBe(true);
  });

  it('normalizes explicit supported dates and leaves ambiguous phrases unnormalized', () => {
    const s = segment('We will ship this by 2026-11-12.');
    const evidence = [{ meetingId, segmentId: s.id, speaker: s.speaker, startMs: s.startMs, endMs: s.endMs, sourceText: s.text, quote: s.text }];
    expect(normalizeSupportedDeadline('2026-11-12', evidence)?.normalizedDate).toBe('2026-11-12');
    expect(normalizeSupportedDeadline('next Friday', evidence)).toBeNull();
    expect(normalizeSupportedDeadline('2026-12-01', evidence)).toBeNull();
  });

  it('retains raw ambiguous deadline phrases for review', () => {
    const s = segment('We should finish it next Friday.');
    const group = { ...reconciled(s), deadlinePhrase: 'next Friday' };
    const task = buildStructuredTask({ id: randomUUID(), meetingId, group, output: output(s, { deadlinePhrase: 'next Friday' }), segments: [s], knowledge: [], project: project() });
    expect(task.deadline).toMatchObject({ rawPhrase: 'next Friday', normalizedDate: null }); expect(task.needsReview).toBe(true);
  });

  it('keeps document citations attached to document versions and chunks', () => {
    const s = segment('I will implement the callback retry behavior described in the guide.');
    const p = project(); const docId = randomUUID(); const versionId = randomUUID(); const chunkId = randomUUID();
    const chunk = { projectId: p.id, documentId: docId, versionId, filename: 'payments.md', type: 'md', chunkId, text: 'Callbacks use bounded retries with idempotency keys.', pageNumber: null, rowNumber: null, rowEndNumber: null, sourceMetadata: {} };
    const task = buildStructuredTask({ id: randomUUID(), meetingId, group: reconciled(s), output: output(s, { projectChunkExcerpts: [{ chunkId, excerpt: 'bounded retries with idempotency keys' }] }), segments: [s], knowledge: [chunk], project: p });
    expect(task.projectReferences[0]).toMatchObject({ projectId: p.id, documentId: docId, versionId, filename: 'payments.md', chunkId, excerpt: 'bounded retries with idempotency keys' });
  });

  it('merges repeated mentions only with an explicit merge rationale', () => {
    const first = segment('We need callback retries.', 0); const second = segment('I will implement bounded retries for callbacks.', 1);
    const inputs = [detected(first, 'idea', 'proposed'), detected(second, 'committed_action', 'committed')];
    const base = { candidateIndexes: [0, 1], kind: 'committed_action' as const, intent: 'committed' as const, summary: 'Implement callback retries', assignee: null, assignmentEvidence: 'none' as const, deadlinePhrase: null, confidence: 0.9 };
    const merged = reconcileCandidateGroups(inputs, reconciliationSchema.parse({ summary: 'summary', groups: [{ ...base, mergeRationale: 'Same callback retry action and outcome.' }], decisions: [], openQuestions: [] }), [first, second]);
    expect(merged).toHaveLength(1); expect(merged[0].evidenceSegmentIds).toEqual([first.id, second.id]);
    const split = reconcileCandidateGroups(inputs, reconciliationSchema.parse({ summary: 'summary', groups: [{ ...base, mergeRationale: null }], decisions: [], openQuestions: [] }), [first, second]);
    expect(split).toHaveLength(2);
  });

  it('segments long meetings while preserving transcript timestamps and IDs', () => {
    const many = Array.from({ length: 9 }, (_, i) => segment(`segment-${i}-${'x'.repeat(20)}`, i, `Speaker ${i % 2}`, i * 30000));
    const chunks = chunkTranscriptSegments(many, 60, 1);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.flat().every(part => many.some(original => original.id === part.id && original.startMs === part.startMs))).toBe(true);
    expect(chunks[0].at(-1)?.id).toBe(chunks[1][0].id);
  });

  it('rejects task drafts without evidence or with invalid evidence fields', () => {
    const s = segment('I will do the callback retry work.');
    const task = buildStructuredTask({ id: randomUUID(), meetingId, group: reconciled(s), output: output(s), segments: [s], knowledge: [], project: project() });
    expect(taskDraftSchema.parse(task).evidence[0].sourceText).toBe(s.text);
    expect(() => taskDraftSchema.parse({ ...task, inventedField: true })).toThrow();
  });
});
