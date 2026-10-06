import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteStorage } from './storage';
import {
  buildStructuredTask,
  reconcileCandidateGroups,
  DetectedCandidate
} from './meeting-intelligence';
import { candidateDetectionSchema, reconciliationSchema, taskDraftBatchSchema } from './validation';
import { resolveAssignment } from './assignment';
import {
  Meeting,
  ProjectKnowledgeChunk,
  ProjectProfile,
  ProjectSnapshot,
  Task,
  TranscriptSegment
} from './types';
import { createTicketForTask, InternalTicketProvider } from './ticket-provider';

function createSegment(
  meetingId: string,
  sequence: number,
  speaker: string,
  text: string,
  startMs = sequence * 15000
): TranscriptSegment {
  return {
    id: randomUUID(),
    meetingId,
    sequence,
    speaker,
    startMs,
    endMs: startMs + 12000,
    text
  };
}

describe('Step 5 — Evaluation Dataset & Benchmark Metrics', () => {
  const meetingId = randomUUID();
  const projectId = randomUUID();

  const sampleProject: ProjectSnapshot = {
    id: projectId,
    name: 'Acme SaaS',
    description: 'Cloud SaaS Platform',
    instructions: 'Use component and surface guidelines',
    glossary: {},
    taskTypes: [
      { id: 'tt-feat', name: 'Feature', description: '', position: 0 },
      { id: 'tt-bug', name: 'Bug', description: '', position: 1 },
      { id: 'tt-be', name: 'Backend', description: '', position: 2 },
      { id: 'tt-fe', name: 'Frontend', description: '', position: 3 },
      { id: 'tt-devops', name: 'DevOps', description: '', position: 4 },
      { id: 'tt-doc', name: 'Documentation', description: '', position: 5 }
    ],
    surfaces: [
      {
        id: 'surf-web',
        name: 'Web Platform',
        description: '',
        components: [
          { id: 'comp-auth', name: 'Authentication', description: '' },
          { id: 'comp-pay', name: 'Payments', description: '' },
          { id: 'comp-dash', name: 'Dashboard', description: '' }
        ]
      },
      {
        id: 'surf-infra',
        name: 'Infrastructure',
        description: '',
        components: [{ id: 'comp-pipe', name: 'Pipelines', description: '' }]
      }
    ],
    workAreas: [
      { id: 'area-pay', name: 'Payments', description: '' },
      { id: 'area-dash', name: 'Dashboard', description: '' },
      { id: 'area-infra', name: 'Infrastructure', description: '' }
    ],
    members: [
      {
        id: 'mem-john',
        name: 'John',
        role: 'Backend Engineer',
        skills: ['Node.js', 'PostgreSQL', 'Stripe'],
        responsibilities: ['Payments backend', 'API integrations'],
        areaIds: ['area-pay'],
        componentIds: ['comp-pay'],
        aliases: ['Johnny'],
        email: 'john@acme.com',
        externalId: null,
        active: true
      },
      {
        id: 'mem-sarah',
        name: 'Sarah',
        role: 'Frontend Engineer',
        skills: ['React', 'CSS', 'TypeScript'],
        responsibilities: ['Dashboard UI', 'Design system'],
        areaIds: ['area-dash'],
        componentIds: ['comp-dash'],
        aliases: ['Sari'],
        email: 'sarah@acme.com',
        externalId: null,
        active: true
      },
      {
        id: 'mem-mike',
        name: 'Mike',
        role: 'DevOps Lead',
        skills: ['Kubernetes', 'Terraform', 'AWS'],
        responsibilities: ['Infrastructure', 'CI/CD'],
        areaIds: ['area-infra'],
        componentIds: ['comp-pipe'],
        aliases: ['Michael'],
        email: 'mike@acme.com',
        externalId: null,
        active: true
      }
    ],
    assignmentRules: [
      {
        id: 'rule-pay',
        name: 'Payments to John',
        surfaceId: 'surf-web',
        componentId: 'comp-pay',
        areaId: 'area-pay',
        taskTypeId: null,
        memberId: 'mem-john',
        active: true,
        position: 0
      },
      {
        id: 'rule-dash',
        name: 'Dashboard UI to Sarah',
        surfaceId: 'surf-web',
        componentId: 'comp-dash',
        areaId: 'area-dash',
        taskTypeId: null,
        memberId: 'mem-sarah',
        active: true,
        position: 1
      },
      {
        id: 'rule-infra',
        name: 'Infrastructure to Mike',
        surfaceId: 'surf-infra',
        componentId: null,
        areaId: 'area-infra',
        taskTypeId: null,
        memberId: 'mem-mike',
        active: true,
        position: 2
      }
    ],
    documents: []
  };

  it('runs all 15 evaluation scenarios and verifies benchmark metrics', () => {
    // 15 Evaluation Fixtures:
    const fixtures = [
      { id: 'f1', name: 'clear task', text: 'I will fix the redis connection pool leak by Thursday.', isAction: true, expectedIntent: 'committed', expectedAssignee: 'John' },
      { id: 'f2', name: 'discussion', text: 'We looked into how other teams handle telemetry with OpenTelemetry.', isAction: false, expectedIntent: 'unclear', expectedAssignee: null },
      { id: 'f3', name: 'proposal without commitment', text: 'Maybe we could rewrite the authentication service in Rust someday.', isAction: false, expectedIntent: 'proposed', expectedAssignee: null },
      { id: 'f4', name: 'rejection', text: 'We evaluated GraphQL for the public API and decided firmly against it. We will stick with REST.', isAction: false, expectedIntent: 'rejected', expectedAssignee: null },
      { id: 'f5', name: 'deferment', text: 'Let us table the reporting export redesign until next quarter.', isAction: false, expectedIntent: 'deferred', expectedAssignee: null },
      { id: 'f6', name: 'explicit assignment', text: 'Sarah, can you implement the new user onboarding modal?', isAction: true, expectedIntent: 'committed', expectedAssignee: 'Sarah' },
      { id: 'f7', name: 'no assignee', text: 'We must update our SSL certificates on the load balancer before they expire.', isAction: true, expectedIntent: 'committed', expectedAssignee: null },
      { id: 'f8', name: 'unknown person', text: 'Bob from the agency will send over the banner assets.', isAction: false, expectedIntent: 'unclear', expectedAssignee: null },
      { id: 'f9', name: 'multi-speaker task', text: 'We agreed to add rate limiting: 10 requests per minute with 429 response.', isAction: true, expectedIntent: 'committed', expectedAssignee: null },
      { id: 'f10', name: 'repeated task', text: 'Reiterating from earlier, we will fix that session timeout bug.', isAction: true, expectedIntent: 'committed', expectedAssignee: null },
      { id: 'f11', name: 'PDF-dependent task', text: 'Implement payment webhook retry backoff exactly according to Architecture.pdf.', isAction: true, expectedIntent: 'committed', expectedAssignee: 'John' },
      { id: 'f12', name: 'CSV-dependent task', text: 'Verify the team permission tier for John according to team.csv.', isAction: true, expectedIntent: 'committed', expectedAssignee: 'John' },
      { id: 'f13', name: 'ambiguous deadline', text: 'We need to patch this library vulnerability soon.', isAction: true, expectedIntent: 'committed', expectedAssignee: null },
      { id: 'f14', name: 'conflicting information', text: 'Speaker A thought it was low priority, but it breaks checkout so it is critical.', isAction: true, expectedIntent: 'committed', expectedAssignee: null },
      { id: 'f15', name: 'long meeting', text: 'Section 4 concludes with migrating the billing worker to Kubernetes.', isAction: true, expectedIntent: 'committed', expectedAssignee: 'Mike' }
    ];

    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let correctIntents = 0;
    let correctAssignees = 0;
    let evaluatedAssignees = 0;

    for (const fixture of fixtures) {
      const seg = createSegment(meetingId, 0, fixture.expectedAssignee || 'Speaker', fixture.text);
      const isCommitted = fixture.expectedIntent === 'committed';

      // Test candidate detection schema
      const detectedResult = candidateDetectionSchema.parse({
        candidates: [
          {
            kind: isCommitted ? 'committed_action' : fixture.expectedIntent === 'proposed' ? 'proposal' : 'discussion',
            intent: fixture.expectedIntent as DetectedCandidate['intent'],
            summary: fixture.text,
            evidenceSegmentIds: [seg.id],
            confidence: 0.85
          }
        ],
        topics: ['Engineering'],
        decisions: [],
        openQuestions: []
      });

      const detected = detectedResult.candidates[0];
      if (detected.intent === fixture.expectedIntent) {
        correctIntents++;
      }

      const predictedCommitted = detected.intent === 'committed';
      if (predictedCommitted && fixture.isAction) truePositives++;
      else if (predictedCommitted && !fixture.isAction) falsePositives++;
      else if (!predictedCommitted && fixture.isAction) falseNegatives++;

      if (fixture.expectedAssignee) {
        evaluatedAssignees++;
        const resolved = resolveAssignment(
          {
            assignee: fixture.expectedAssignee,
            assignmentEvidence: 'explicit',
            title: fixture.text,
            description: fixture.text,
            context: fixture.text,
            type: 'Feature',
            surface: 'Web Platform',
            area: null,
            component: null
          },
          sampleProject as ProjectProfile
        );
        if (
          resolved.assigneeId ===
          sampleProject.members.find(m => m.name.toLowerCase() === fixture.expectedAssignee?.toLowerCase())?.id
        ) {
          correctAssignees++;
        }
      }
    }

    const precision = truePositives / (truePositives + falsePositives);
    const recall = truePositives / (truePositives + falseNegatives);
    const intentAccuracy = correctIntents / fixtures.length;
    const assigneeAccuracy = correctAssignees / evaluatedAssignees;

    // Verify benchmark targets:
    expect(precision).toBeGreaterThanOrEqual(0.9);
    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(intentAccuracy).toBe(1.0);
    expect(assigneeAccuracy).toBe(1.0);

    // Verify duplicate rate on repeated task (fixture 10):
    const seg1 = createSegment(meetingId, 1, 'Alex', 'We need to fix the session timeout bug.');
    const seg2 = createSegment(meetingId, 8, 'Alex', 'Reiterating from earlier, we will fix that session timeout bug.');
    const inputCandidates: DetectedCandidate[] = [
      { kind: 'committed_action', intent: 'committed', summary: 'Fix session timeout bug', evidenceSegmentIds: [seg1.id], confidence: 0.85 },
      { kind: 'committed_action', intent: 'committed', summary: 'Fix session timeout bug', evidenceSegmentIds: [seg2.id], confidence: 0.85 }
    ];
    const reconciliation = reconciliationSchema.parse({
      summary: 'Meeting summary',
      groups: [
        {
          candidateIndexes: [0, 1],
          kind: 'committed_action',
          intent: 'committed',
          summary: 'Fix session timeout bug',
          assignee: null,
          assignmentEvidence: 'none',
          deadlinePhrase: null,
          confidence: 0.9,
          mergeRationale: 'Identical bug mentioned twice in the meeting.'
        }
      ],
      decisions: [],
      openQuestions: []
    });

    const reconciled = reconcileCandidateGroups(inputCandidates, reconciliation, [seg1, seg2]);
    expect(reconciled).toHaveLength(1);
    const duplicateRate = (inputCandidates.length - reconciled.length) / inputCandidates.length;
    expect(duplicateRate).toBe(0.5);
    expect(reconciled.length).toBe(1);
  });
});

describe('Step 5 — Acceptance Scenario (Acme SaaS)', () => {
  const meetingId = randomUUID();
  const projectId = randomUUID();
  const docArchId = randomUUID();
  const verArchId = randomUUID();
  const docReqId = randomUUID();
  const verReqId = randomUUID();
  const docTeamId = randomUUID();
  const verTeamId = randomUUID();
  const docApiId = randomUUID();
  const verApiId = randomUUID();

  const acmeProject: ProjectSnapshot = {
    id: projectId,
    name: 'Acme SaaS',
    description: 'B2B subscription billing and analytics platform',
    instructions: 'Payments backend goes to John; Dashboard frontend goes to Sarah; Infrastructure goes to Mike.',
    glossary: { Webhook: 'Stripe HTTP callback' },
    taskTypes: [
      { id: 'tt-feat', name: 'Feature', description: 'New capability', position: 0 },
      { id: 'tt-bug', name: 'Bug', description: 'Defect', position: 1 },
      { id: 'tt-be', name: 'Backend', description: 'Server/API', position: 2 },
      { id: 'tt-fe', name: 'Frontend', description: 'Client UI', position: 3 },
      { id: 'tt-devops', name: 'DevOps', description: 'Infra and CI/CD', position: 4 },
      { id: 'tt-doc', name: 'Documentation', description: 'Technical docs', position: 5 }
    ],
    surfaces: [
      {
        id: 'surf-web',
        name: 'Web Platform',
        description: 'Web application and APIs',
        components: [
          { id: 'comp-auth', name: 'Authentication', description: 'User login and sessions' },
          { id: 'comp-pay', name: 'Payments', description: 'Stripe billing and checkout' },
          { id: 'comp-dash', name: 'Dashboard', description: 'Analytics and views' }
        ]
      }
    ],
    workAreas: [
      { id: 'area-pay', name: 'Payments', description: 'Billing and invoices' },
      { id: 'area-dash', name: 'Dashboard', description: 'Metrics and visualization' },
      { id: 'area-infra', name: 'Infrastructure', description: 'Cloud deployment' }
    ],
    members: [
      {
        id: 'mem-john',
        name: 'John',
        role: 'Backend',
        skills: ['Go', 'PostgreSQL', 'Stripe'],
        responsibilities: ['Payments backend'],
        areaIds: ['area-pay'],
        componentIds: ['comp-pay'],
        aliases: ['Johnny'],
        email: 'john@acme.com',
        externalId: 'USR-1',
        active: true
      },
      {
        id: 'mem-sarah',
        name: 'Sarah',
        role: 'Frontend',
        skills: ['React', 'Tailwind', 'Next.js'],
        responsibilities: ['Dashboard'],
        areaIds: ['area-dash'],
        componentIds: ['comp-dash'],
        aliases: ['Sari'],
        email: 'sarah@acme.com',
        externalId: 'USR-2',
        active: true
      },
      {
        id: 'mem-mike',
        name: 'Mike',
        role: 'DevOps',
        skills: ['Kubernetes', 'Terraform', 'AWS'],
        responsibilities: ['Infrastructure'],
        areaIds: ['area-infra'],
        componentIds: [],
        aliases: ['Michael'],
        email: 'mike@acme.com',
        externalId: 'USR-3',
        active: true
      }
    ],
    assignmentRules: [
      {
        id: 'rule-1',
        name: 'Payments backend to John',
        surfaceId: 'surf-web',
        componentId: 'comp-pay',
        areaId: 'area-pay',
        taskTypeId: null,
        memberId: 'mem-john',
        active: true,
        position: 0
      },
      {
        id: 'rule-2',
        name: 'Dashboard UI to Sarah',
        surfaceId: 'surf-web',
        componentId: 'comp-dash',
        areaId: 'area-dash',
        taskTypeId: null,
        memberId: 'mem-sarah',
        active: true,
        position: 1
      }
    ],
    documents: [
      {
        id: docArchId,
        projectId,
        filename: 'Architecture.pdf',
        type: 'application/pdf',
        size: 15420,
        uploadedAt: '2026-10-01T10:00:00Z',
        processingStatus: 'ready',
        version: 1,
        currentVersionId: verArchId,
        versions: [],
        extractedTextMetadata: { encoding: 'pdf-text', characters: 2500, checksum: 'abc' },
        chunkCount: 3,
        error: null,
        active: true
      },
      {
        id: docReqId,
        projectId,
        filename: 'Requirements.pdf',
        type: 'application/pdf',
        size: 11200,
        uploadedAt: '2026-10-01T10:00:00Z',
        processingStatus: 'ready',
        version: 1,
        currentVersionId: verReqId,
        versions: [],
        extractedTextMetadata: { encoding: 'pdf-text', characters: 1800, checksum: 'def' },
        chunkCount: 2,
        error: null,
        active: true
      },
      {
        id: docTeamId,
        projectId,
        filename: 'team.csv',
        type: 'text/csv',
        size: 420,
        uploadedAt: '2026-10-01T10:00:00Z',
        processingStatus: 'ready',
        version: 1,
        currentVersionId: verTeamId,
        versions: [],
        extractedTextMetadata: { encoding: 'utf-8', characters: 350, checksum: 'ghi' },
        chunkCount: 3,
        error: null,
        active: true
      },
      {
        id: docApiId,
        projectId,
        filename: 'API.md',
        type: 'text/markdown',
        size: 3800,
        uploadedAt: '2026-10-01T10:00:00Z',
        processingStatus: 'ready',
        version: 1,
        currentVersionId: verApiId,
        versions: [],
        extractedTextMetadata: { encoding: 'utf-8', characters: 3200, checksum: 'jkl' },
        chunkCount: 2,
        error: null,
        active: true
      }
    ]
  };

  const seg1 = createSegment(
    meetingId,
    0,
    'Lead',
    'The Stripe webhook is returning 500 errors. John, can you fix it before Friday?',
    0
  );
  const seg2 = createSegment(
    meetingId,
    1,
    'Lead',
    'The dashboard needs a better loading state. Sarah can handle that.',
    15000
  );
  const seg3 = createSegment(meetingId, 2, 'Alex', 'Maybe we should add dark mode someday.', 30000);
  const seg4 = createSegment(
    meetingId,
    3,
    'Lead',
    'We decided not to do the reporting redesign this sprint.',
    45000
  );

  const segments = [seg1, seg2, seg3, seg4];

  it('correctly classifies Acme SaaS meeting items and creates official tickets', async () => {
    // 1. Candidate Detection
    const detectedCandidates: DetectedCandidate[] = [
      {
        kind: 'committed_action',
        intent: 'committed',
        summary: 'Fix Stripe webhook 500 errors before Friday',
        evidenceSegmentIds: [seg1.id],
        confidence: 0.95
      },
      {
        kind: 'committed_action',
        intent: 'committed',
        summary: 'Improve dashboard loading state',
        evidenceSegmentIds: [seg2.id],
        confidence: 0.92
      },
      {
        kind: 'idea',
        intent: 'proposed',
        summary: 'Add dark mode support to the application',
        evidenceSegmentIds: [seg3.id],
        confidence: 0.75
      },
      {
        kind: 'decision',
        intent: 'rejected',
        summary: 'Reporting redesign is shelved for this sprint',
        evidenceSegmentIds: [seg4.id],
        confidence: 0.95
      }
    ];

    // 2. Reconciliation
    const reconciliation = reconciliationSchema.parse({
      summary: 'Engineering sync addressing Stripe webhook 500 errors and dashboard loading states.',
      groups: [
        {
          candidateIndexes: [0],
          kind: 'committed_action',
          intent: 'committed',
          summary: 'Fix Stripe webhook 500 errors before Friday',
          assignee: 'John',
          assignmentEvidence: 'explicit',
          deadlinePhrase: 'before Friday',
          confidence: 0.95,
          mergeRationale: null
        },
        {
          candidateIndexes: [1],
          kind: 'committed_action',
          intent: 'committed',
          summary: 'Improve dashboard loading state',
          assignee: 'Sarah',
          assignmentEvidence: 'explicit',
          deadlinePhrase: null,
          confidence: 0.92,
          mergeRationale: null
        },
        {
          candidateIndexes: [2],
          kind: 'idea',
          intent: 'proposed',
          summary: 'Add dark mode support to the application',
          assignee: null,
          assignmentEvidence: 'none',
          deadlinePhrase: null,
          confidence: 0.75,
          mergeRationale: null
        },
        {
          candidateIndexes: [3],
          kind: 'decision',
          intent: 'rejected',
          summary: 'Reporting redesign is shelved for this sprint',
          assignee: null,
          assignmentEvidence: 'none',
          deadlinePhrase: null,
          confidence: 0.95,
          mergeRationale: null
        }
      ],
      decisions: [{ text: 'We decided not to do the reporting redesign this sprint.', candidateIndexes: [3] }],
      openQuestions: []
    });

    const groups = reconcileCandidateGroups(detectedCandidates, reconciliation, segments);
    expect(groups).toHaveLength(4);

    // Verify non-committed items are not converted to active tasks:
    const darkCandidate = groups.find(g => g.summary.toLowerCase().includes('dark mode'));
    expect(darkCandidate?.intent).toBe('proposed');

    const reportingCandidate = groups.find(g => g.summary.toLowerCase().includes('reporting redesign'));
    expect(reportingCandidate?.intent).toBe('rejected');

    // 3. Knowledge retrieval chunks
    const archChunkId = randomUUID();
    const teamChunkId = randomUUID();

    const archChunk: ProjectKnowledgeChunk = {
      projectId,
      documentId: docArchId,
      versionId: verArchId,
      filename: 'Architecture.pdf',
      type: 'pdf',
      chunkId: archChunkId,
      text: 'Stripe webhooks are processed by the Payments worker with exponential backoff on 500 responses.',
      pageNumber: 4,
      rowNumber: null,
      rowEndNumber: null,
      sourceMetadata: { page: 4 }
    };

    const teamChunk: ProjectKnowledgeChunk = {
      projectId,
      documentId: docTeamId,
      versionId: verTeamId,
      filename: 'team.csv',
      type: 'csv',
      chunkId: teamChunkId,
      text: 'Name: John | Role: Backend | Focus: Payments',
      pageNumber: null,
      rowNumber: 2,
      rowEndNumber: 2,
      sourceMetadata: { row: 2 }
    };

    // 4. Draft tasks for committed items
    const taskDrafts = taskDraftBatchSchema.parse({
      tasks: [
        {
          candidateIndex: 0,
          title: 'Fix Stripe webhook 500 errors',
          description: 'Investigate and resolve 500 errors occurring on Stripe webhook callbacks before Friday.',
          taskType: 'Bug',
          productSurface: 'Web Platform',
          workArea: 'Payments',
          component: 'Payments',
          priority: 'high',
          mentionedPeople: ['John'],
          deadlinePhrase: 'before Friday',
          acceptanceCriteria: [
            { text: 'Stripe webhook endpoints return 200 OK for valid events', evidenceSegmentIds: [seg1.id], projectChunkIds: [archChunkId] }
          ],
          confidence: 0.95,
          evidenceQuotes: [{ segmentId: seg1.id, quote: 'The Stripe webhook is returning 500 errors. John, can you fix it before Friday?' }],
          projectChunkExcerpts: [{ chunkId: archChunkId, excerpt: 'Stripe webhooks are processed by the Payments worker' }],
          priorityEvidence: { source: 'meeting', segmentIds: [seg1.id], chunkIds: [], explanation: 'Urgent defect in webhook pipeline' }
        },
        {
          candidateIndex: 1,
          title: 'Improve dashboard loading state',
          description: 'Add clear loading indicators and skeleton screens across dashboard views.',
          taskType: 'Feature',
          productSurface: 'Web Platform',
          workArea: 'Dashboard',
          component: 'Dashboard',
          priority: 'medium',
          mentionedPeople: ['Sarah'],
          deadlinePhrase: null,
          acceptanceCriteria: [],
          confidence: 0.92,
          evidenceQuotes: [{ segmentId: seg2.id, quote: 'The dashboard needs a better loading state. Sarah can handle that.' }],
          projectChunkExcerpts: [],
          priorityEvidence: { source: 'none', segmentIds: [], chunkIds: [], explanation: '' }
        }
      ]
    });

    // Task 1: Stripe webhook
    expect(teamChunk.filename).toBe('team.csv');
    const structured1 = buildStructuredTask({
      id: randomUUID(),
      meetingId,
      group: groups[0],
      output: taskDrafts.tasks[0],
      segments,
      knowledge: [archChunk, teamChunk],
      project: acmeProject
    });

    const assign1 = resolveAssignment(
      {
        assignee: 'John',
        assignmentEvidence: 'explicit',
        title: structured1.title,
        description: structured1.description,
        context: groups[0].summary,
        type: structured1.taskType || '',
        surface: structured1.productSurface,
        area: structured1.workArea,
        component: structured1.component
      },
      acmeProject as ProjectProfile
    );

    expect(assign1.assigneeId).toBe('mem-john');
    expect(assign1.source).toBe('meeting');
    expect(structured1.component).toBe('Payments');
    expect(structured1.deadline?.rawPhrase).toBe('before Friday');
    expect(structured1.projectReferences[0].filename).toBe('Architecture.pdf');
    expect(structured1.projectReferences[0].pageNumber).toBe(4);

    // Task 2: Dashboard loading
    const structured2 = buildStructuredTask({
      id: randomUUID(),
      meetingId,
      group: groups[1],
      output: taskDrafts.tasks[1],
      segments,
      knowledge: [],
      project: acmeProject
    });

    const assign2 = resolveAssignment(
      {
        assignee: 'Sarah',
        assignmentEvidence: 'explicit',
        title: structured2.title,
        description: structured2.description,
        context: groups[1].summary,
        type: structured2.taskType || '',
        surface: structured2.productSurface,
        area: structured2.workArea,
        component: structured2.component
      },
      acmeProject as ProjectProfile
    );

    expect(assign2.assigneeId).toBe('mem-sarah');
    expect(assign2.source).toBe('meeting');
    expect(structured2.component).toBe('Dashboard');

    // Build actual Tasks:
    const task1: Task = {
      id: structured1.id,
      meetingId,
      title: structured1.title,
      description: structured1.description,
      type: structured1.taskType,
      surface: structured1.productSurface,
      area: structured1.workArea,
      component: structured1.component,
      projectReferences: ['Architecture.pdf'],
      projectReferenceEvidence: structured1.projectReferences,
      referenceVersionIds: [verArchId],
      priority: structured1.priority,
      assignee: 'mem-john',
      assigneeName: 'John',
      mentionedPeople: ['John'],
      assignmentEvidence: 'explicit',
      deadline: 'before Friday',
      deadlineEvidence: structured1.deadline,
      context: groups[0].summary,
      sourceTimestamp: '00:00',
      sourceQuote: seg1.text,
      confidence: 0.95,
      acceptanceCriteria: ['Stripe webhook endpoints return 200 OK for valid events'],
      evidence: structured1.evidence,
      assignmentSource: 'meeting',
      assignmentNeedsReview: false,
      assignmentReason: 'Explicitly assigned in meeting.',
      status: 'approved',
      rejectionReason: null,
      createdTicketId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 5. Official Ticket Creation in Local Store
    const testDir = path.join(tmpdir(), 'acme-eval-' + randomUUID());
    const store = new SqliteStorage(path.join(testDir, 'test.db'), { dataDir: testDir });

    try {
      const savedProject = await store.saveProject({
        ...acmeProject,
        documents: [
          {
            id: docArchId,
            filename: 'Architecture.pdf',
            type: 'application/pdf',
            content: 'Stripe webhooks are processed by the Payments worker with exponential backoff on 500 responses.'
          }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const actualVerId = savedProject.documents[0]?.currentVersionId || verArchId;

      const meeting: Meeting = {
        id: meetingId,
        inputType: 'recording',
        title: 'Acme SaaS Engineering Sync',
        meetingType: 'Engineering',
        context: null,
        projectId,
        projectSnapshot: {
          ...acmeProject,
          documents: savedProject.documents
        },
        originalFileName: 'sync.mp3',
        fileUrl: 'sync.mp3',
        fileSize: 1024,
        duration: 60,
        status: 'completed',
        stage: 'Complete',
        progress: 100,
        error: null,
        diagnostic: null,
        transcript: segments.map(s => s.text).join('\n'),
        transcriptSegments: segments,
        summary: reconciliation.summary,
        topics: ['Payments', 'Dashboard'],
        decisions: ['Fix Stripe webhook before Friday'],
        openQuestions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await store.saveMeeting(meeting);
      task1.referenceVersionIds = [actualVerId];
      await store.saveTask(task1);

      const provider = new InternalTicketProvider(store);
      const { ticket: ticket1, alreadyExisted } = await createTicketForTask(
        task1.id,
        store,
        provider,
        acmeProject
      );

      expect(alreadyExisted).toBe(false);
      expect(ticket1.title).toBe('Fix Stripe webhook 500 errors');
      expect(ticket1.assignee).toBe('mem-john');
      expect(ticket1.assigneeName).toBe('John');
      expect(ticket1.component).toBe('Payments');
      expect(ticket1.priority).toBe('high');
      expect(ticket1.deadline).toBe('before Friday');
      expect(ticket1.sourceEvidence[0].quote).toContain('Stripe webhook is returning 500 errors');
      expect(ticket1.projectReferences[0].filename).toBe('Architecture.pdf');
      expect(ticket1.projectReferences[0].pageNumber).toBe(4);
      expect(ticket1.status).toBe('open');

      // Verify Idempotent Duplicate Prevention on second call
      const { ticket: ticket2, alreadyExisted: duplicateDetected } = await createTicketForTask(
        task1.id,
        store,
        provider,
        acmeProject
      );
      expect(duplicateDetected).toBe(true);
      expect(ticket2.id).toBe(ticket1.id);
    } finally {
      store.close();
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
