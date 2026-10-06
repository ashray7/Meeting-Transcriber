import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from './storage';
import { Meeting, Task, ProjectProfile, MeetingTaskEvidence, ProjectReferenceEvidence, ProjectDocument } from './types';
import { ProjectProfileInput, validateTaskProfileReferences } from './validation';
import { InternalTicketProvider, buildTicketContent, createTicketForTask } from './ticket-provider';

let tempDir: string;
let store: SqliteStorage;

function sampleProfileInput(): ProjectProfileInput {
  const areaId = randomUUID();
  const surfaceId = randomUUID();
  const componentId = randomUUID();
  const taskId = randomUUID();
  const memberId = randomUUID();

  return {
    name: 'Payment Gateway',
    description: 'Core billing and payment processing services',
    instructions: 'All payment callback changes require idempotency checks and timeout bounds.',
    glossary: { Webhook: 'HTTP callback for asynchronous event notifications' },
    taskTypes: [
      { id: taskId, name: 'Bug', description: 'Defect or incident fix', position: 0 },
      { id: randomUUID(), name: 'Feature', description: 'New functionality', position: 1 }
    ],
    surfaces: [
      {
        id: surfaceId,
        name: 'Backend API',
        description: 'Server services and endpoints',
        components: [{ id: componentId, name: 'Webhook Handler', description: 'Inbound merchant callbacks' }]
      }
    ],
    workAreas: [{ id: areaId, name: 'Payments', description: 'Financial workflows' }],
    members: [
      {
        id: memberId,
        name: 'Alex Rivera',
        role: 'Senior Backend Engineer',
        skills: ['TypeScript', 'PostgreSQL'],
        responsibilities: ['Payment callbacks', 'Reconciliation'],
        areaIds: [areaId],
        componentIds: [componentId],
        aliases: ['Alex R', 'AR'],
        email: 'alex@example.com',
        externalId: 'tracker-alex',
        active: true
      }
    ],
    assignmentRules: [
      {
        id: randomUUID(),
        name: 'Webhooks to Alex',
        surfaceId,
        componentId,
        areaId,
        taskTypeId: taskId,
        memberId,
        active: true,
        position: 0
      }
    ],
    documents: []
  };
}

async function setupTestEnvironment(): Promise<{ project: ProjectProfile; meeting: Meeting; doc: ProjectDocument }> {
  const project = await store.saveProject({ ...sampleProfileInput(), id: randomUUID() });
  const doc = await store.ingestProjectDocument(
    project.id,
    'webhook-specs.md',
    Buffer.from('# Webhook spec\nWebhook retry backoff schedule: 1s, 5s, 30s, max 3 attempts.')
  );

  const refreshedProject = (await store.getProject(project.id))!;
  const meetingId = randomUUID();

  const meeting: Meeting = {
    id: meetingId,
    inputType: 'recording',
    title: 'Payment Resiliency Review',
    meetingType: 'Architecture Review',
    context: 'Discussing webhook retry storms',
    projectId: refreshedProject.id,
    projectSnapshot: {
      id: refreshedProject.id,
      name: refreshedProject.name,
      description: refreshedProject.description,
      instructions: refreshedProject.instructions,
      glossary: refreshedProject.glossary,
      taskTypes: refreshedProject.taskTypes,
      surfaces: refreshedProject.surfaces,
      workAreas: refreshedProject.workAreas,
      members: refreshedProject.members,
      assignmentRules: refreshedProject.assignmentRules,
      documents: refreshedProject.documents
    },
    originalFileName: 'meeting-recording.mp4',
    fileUrl: 'meeting-recording.mp4',
    fileSize: 1024 * 1024 * 5,
    duration: 1800,
    status: 'completed',
    stage: 'Complete',
    progress: 100,
    error: null,
    diagnostic: null,
    transcript: '[02:15] Alex Rivera: We need bounded retries with jitter on failed webhook callbacks.',
    transcriptSegments: [
      {
        id: 'seg-101',
        meetingId,
        sequence: 1,
        startMs: 135000,
        endMs: 142000,
        speaker: 'Alex Rivera',
        text: 'We need bounded retries with jitter on failed webhook callbacks.'
      }
    ],
    summary: 'Team decided to implement bounded retries with exponential backoff and jitter.',
    topics: ['Webhooks', 'Retries', 'Idempotency'],
    decisions: ['Add exponential backoff with jitter on webhook callbacks'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await store.saveMeeting(meeting);
  return { project: refreshedProject, meeting, doc };
}

function sampleTaskCandidate(meetingId: string, project: ProjectProfile, doc: ProjectDocument): Task {
  const member = project.members[0];
  const surface = project.surfaces[0];
  const component = surface.components[0];
  const area = project.workAreas[0];
  const taskType = project.taskTypes[0];

  const evidence: MeetingTaskEvidence = {
    meetingId,
    segmentId: 'seg-101',
    speaker: 'Alex Rivera',
    startMs: 135000,
    endMs: 142000,
    sourceText: 'We need bounded retries with jitter on failed webhook callbacks.',
    quote: 'We need bounded retries with jitter'
  };

  const projectReference: ProjectReferenceEvidence = {
    projectId: project.id,
    documentId: doc.id,
    versionId: doc.currentVersionId!,
    filename: doc.filename,
    pageNumber: null,
    rowNumber: null,
    chunkId: 'chunk-1',
    excerpt: 'Webhook retry backoff schedule: 1s, 5s, 30s, max 3 attempts.'
  };

  return {
    id: randomUUID(),
    meetingId,
    title: 'Implement exponential backoff for webhook callbacks',
    description: 'Add bounded exponential retries with jitter to prevent downstream webhook stampedes.',
    type: taskType.name,
    surface: surface.name,
    area: area.name,
    component: component.name,
    projectReferences: [doc.filename],
    projectReferenceEvidence: [projectReference],
    referenceVersionIds: [doc.currentVersionId!],
    priority: 'high',
    assignee: member.id,
    assigneeName: member.name,
    mentionedPeople: ['Alex Rivera'],
    assignmentEvidence: 'explicit',
    deadline: '2026-10-30',
    deadlineEvidence: { rawPhrase: 'end of October', normalizedDate: '2026-10-30' },
    context: 'Discussed during payment architecture review',
    sourceTimestamp: '02:15',
    acceptanceCriteria: [
      'Callbacks retry with jitter up to 3 times',
      'Log warning after the final failed attempt'
    ],
    evidence: [evidence],
    sourceQuote: evidence.quote,
    confidence: 0.92,
    classificationNeedsReview: false,
    classificationReviewReasons: [],
    assignmentSource: 'meeting',
    assignmentNeedsReview: false,
    assignmentReason: 'Alex explicitly committed to this during meeting',
    status: 'detected',
    rejectionReason: null,
    createdTicketId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'meeting-step4-'));
  store = new SqliteStorage(path.join(tempDir, 'test.sqlite'), { dataDir: tempDir });
});

afterEach(async () => {
  store.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe('Step 4 — Task Review & Ticket Creation Workflow', () => {
  it('supports full candidate review state transitions (detected -> approved -> created)', async () => {
    const { project, meeting, doc } = await setupTestEnvironment();
    const task = sampleTaskCandidate(meeting.id, project, doc);
    await store.saveTask(task);

    // Initial state: detected
    let loaded = await store.getTask(task.id);
    expect(loaded?.status).toBe('detected');
    expect(loaded?.createdTicketId).toBeNull();

    // Human action: Approve
    task.status = 'approved';
    await store.saveTask(task);
    loaded = await store.getTask(task.id);
    expect(loaded?.status).toBe('approved');

    // Action: Convert to Ticket
    const provider = new InternalTicketProvider(store);
    const { ticket, alreadyExisted } = await createTicketForTask(task.id, store, provider, meeting.projectSnapshot);

    expect(alreadyExisted).toBe(false);
    expect(ticket.sourceTaskId).toBe(task.id);
    expect(ticket.status).toBe('open');

    // Task status transitioned to created and links to ticket
    loaded = await store.getTask(task.id);
    expect(loaded?.status).toBe('created');
    expect(loaded?.createdTicketId).toBe(ticket.id);
  });

  it('supports candidate rejection with optional rejection reason and reopening', async () => {
    const { project, meeting, doc } = await setupTestEnvironment();
    const task = sampleTaskCandidate(meeting.id, project, doc);
    await store.saveTask(task);

    // Human action: Reject with reason
    task.status = 'rejected';
    task.rejectionReason = 'Out of scope: payment provider handles retries natively';
    await store.saveTask(task);

    let loaded = await store.getTask(task.id);
    expect(loaded?.status).toBe('rejected');
    expect(loaded?.rejectionReason).toBe('Out of scope: payment provider handles retries natively');

    // Human action: Reopen for review
    task.status = 'review_required';
    task.rejectionReason = null;
    await store.saveTask(task);

    loaded = await store.getTask(task.id);
    expect(loaded?.status).toBe('review_required');
    expect(loaded?.rejectionReason).toBeNull();
  });

  it('allows valid editing of all candidate fields', async () => {
    const { project, meeting, doc } = await setupTestEnvironment();
    const task = sampleTaskCandidate(meeting.id, project, doc);
    await store.saveTask(task);

    // Edit fields
    task.title = 'Updated Title: Configurable Jitter for Webhooks';
    task.description = 'Updated description with additional details';
    task.priority = 'critical';
    task.deadline = '2026-11-15';
    task.acceptanceCriteria = ['Add exponential backoff', 'Add jitter coefficient setting'];

    const validationError = validateTaskProfileReferences(task, meeting.projectSnapshot);
    expect(validationError).toBeNull();

    await store.saveTask(task);
    const loaded = await store.getTask(task.id);

    expect(loaded?.title).toBe('Updated Title: Configurable Jitter for Webhooks');
    expect(loaded?.priority).toBe('critical');
    expect(loaded?.deadline).toBe('2026-11-15');
    expect(loaded?.acceptanceCriteria).toHaveLength(2);
  });

  it('rejects invalid edits that violate project configuration', async () => {
    const { meeting } = await setupTestEnvironment();

    // 1. Invalid Task Type
    const errType = validateTaskProfileReferences({ type: 'NonExistentType' }, meeting.projectSnapshot);
    expect(errType).toContain('task type');

    // 2. Invalid Product Surface
    const errSurface = validateTaskProfileReferences({ surface: 'Mobile iOS' }, meeting.projectSnapshot);
    expect(errSurface).toContain('product surface');

    // 3. Component not belonging to surface
    const otherSurfaceId = randomUUID();
    const snapshotWithTwoSurfaces = {
      ...meeting.projectSnapshot!,
      surfaces: [
        ...meeting.projectSnapshot!.surfaces,
        { id: otherSurfaceId, name: 'Frontend Web', description: '', components: [] }
      ]
    };
    const errComponentPair = validateTaskProfileReferences(
      { surface: 'Frontend Web', component: 'Webhook Handler' },
      snapshotWithTwoSurfaces
    );
    expect(errComponentPair).toContain('Component does not belong to the selected product surface');

    // 4. Inactive or unknown assignee
    const errAssignee = validateTaskProfileReferences({ assignee: randomUUID() }, meeting.projectSnapshot);
    expect(errAssignee).toContain('active team member');
  });

  it('guarantees idempotent ticket creation with duplicate prevention', async () => {
    const { project, meeting, doc } = await setupTestEnvironment();
    const task = sampleTaskCandidate(meeting.id, project, doc);
    task.status = 'approved';
    await store.saveTask(task);

    const provider = new InternalTicketProvider(store);

    // First call: creates ticket
    const result1 = await createTicketForTask(task.id, store, provider, meeting.projectSnapshot);
    expect(result1.alreadyExisted).toBe(false);
    expect(result1.ticket.id).toBeDefined();

    // Second call: idempotent duplicate prevention
    const result2 = await createTicketForTask(task.id, store, provider, meeting.projectSnapshot);
    expect(result2.alreadyExisted).toBe(true);
    expect(result2.ticket.id).toBe(result1.ticket.id);

    // Total tickets count in store must be exactly 1
    const allTickets = await store.listTickets();
    expect(allTickets).toHaveLength(1);
    expect(allTickets[0].id).toBe(result1.ticket.id);
  });

  it('preserves meeting evidence and project reference citations on created tickets', async () => {
    const { project, meeting, doc } = await setupTestEnvironment();
    const task = sampleTaskCandidate(meeting.id, project, doc);
    task.status = 'approved';
    await store.saveTask(task);

    const provider = new InternalTicketProvider(store);
    const { ticket } = await createTicketForTask(task.id, store, provider, meeting.projectSnapshot);

    // Verify source evidence preserved
    expect(ticket.sourceEvidence).toHaveLength(1);
    expect(ticket.sourceEvidence[0].segmentId).toBe('seg-101');
    expect(ticket.sourceEvidence[0].speaker).toBe('Alex Rivera');
    expect(ticket.sourceEvidence[0].startMs).toBe(135000);
    expect(ticket.sourceEvidence[0].quote).toContain('We need bounded retries with jitter');

    // Verify project references preserved
    expect(ticket.projectReferences).toHaveLength(1);
    expect(ticket.projectReferences[0].filename).toBe('webhook-specs.md');
    expect(ticket.projectReferences[0].chunkId).toBe('chunk-1');
    expect(ticket.projectReferences[0].excerpt).toContain('Webhook retry backoff schedule');
  });

  it('buildTicketContent generates concise expected outcome without inventing requirements', () => {
    const task: Task = {
      id: 'task-test',
      meetingId: 'meeting-1',
      title: 'Fix race condition in session checkout',
      description: 'Acquire lock on checkout token before committing cart transaction.',
      type: 'Bug',
      surface: 'Backend API',
      area: 'Payments',
      component: null,
      projectReferences: [],
      referenceVersionIds: [],
      priority: 'high',
      assignee: null,
      assigneeName: null,
      assignmentEvidence: 'none',
      deadline: '2026-10-15',
      context: 'Reported during incident review',
      sourceTimestamp: '05:30',
      sourceQuote: null,
      confidence: 0.9,
      acceptanceCriteria: ['Lock is acquired with 5s timeout', 'Returns 409 Conflict if lock fails'],
      status: 'approved',
      assignmentSource: 'unassigned',
      assignmentNeedsReview: true,
      assignmentReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const content = buildTicketContent(task, null);

    expect(content.title).toBe('Fix race condition in session checkout');
    expect(content.description).toBe('Acquire lock on checkout token before committing cart transaction.');
    expect(content.context).toBe('Reported during incident review');
    expect(content.expectedOutcome).toContain('Completed when:');
    expect(content.expectedOutcome).toContain('Lock is acquired with 5s timeout');
    expect(content.acceptanceCriteria).toHaveLength(2);
  });

  it('implements ticket provider abstraction (get, update, find, list)', async () => {
    const { project, meeting } = await setupTestEnvironment();
    const provider = new InternalTicketProvider(store);

    const created = await provider.createTicket({
      sourceTaskId: 'source-task-1',
      projectId: project.id,
      meetingId: meeting.id,
      title: 'Test ticket abstraction',
      description: 'Checking provider implementation',
      taskType: 'Feature',
      status: 'open'
    });

    // getTicket
    const fetched = await provider.getTicket(created.id);
    expect(fetched?.title).toBe('Test ticket abstraction');

    // findTicket
    const found = await provider.findTicket({ sourceTaskId: 'source-task-1' });
    expect(found?.id).toBe(created.id);

    // updateTicket
    const updated = await provider.updateTicket(created.id, {
      title: 'Updated title in tracker',
      status: 'in_progress'
    });
    expect(updated.title).toBe('Updated title in tracker');
    expect(updated.status).toBe('in_progress');

    // listTickets with filter
    const list = await provider.listTickets({ projectId: project.id });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
  });
});
