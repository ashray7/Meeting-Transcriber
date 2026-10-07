import {z} from 'zod';

const id=z.string().uuid();
const label=z.string().trim().min(1).max(100);
const unique=(values:string[])=>new Set(values.map(x=>x.trim().toLocaleLowerCase())).size===values.length;
export const meetingContextSchema=z.object({title:z.string().trim().max(160).optional(),meetingType:z.string().trim().max(80).optional(),context:z.string().trim().max(4000).optional(),projectId:id.nullable().optional()});
export const notesSchema=z.string().trim().min(1,'Paste meeting notes to continue.').max(50000,'Meeting notes must be 50,000 characters or fewer.');
const taskTypeSchema=z.object({id,name:label,description:z.string().trim().max(1000).default(''),position:z.number().int().min(0).default(0)});
const componentSchema=z.object({id,name:label,description:z.string().trim().max(1000).default('')});
const surfaceSchema=z.object({id,name:label,description:z.string().trim().max(1000).default(''),components:z.array(componentSchema).max(100)});
const areaSchema=z.object({id,name:label,description:z.string().trim().max(1000).default('')});
const memberSchema=z.object({id,name:label,role:z.string().trim().max(120).default(''),skills:z.array(label).max(50),responsibilities:z.array(label).max(50),areaIds:z.array(id).max(50),componentIds:z.array(id).max(100),aliases:z.array(label).max(30),email:z.string().trim().email().max(254).nullable().optional().default(null),externalId:z.string().trim().max(200).nullable().optional().default(null),active:z.boolean().default(true)});
const ruleSchema=z.object({id,name:z.string().trim().max(160).default(''),surfaceId:id.nullable(),componentId:id.nullable(),areaId:id.nullable(),taskTypeId:id.nullable(),memberId:id,active:z.boolean().default(true),position:z.number().int().min(0).default(0)});
const projectDocumentInputSchema=z.object({id,filename:z.string().trim().min(1).max(255),type:z.string().trim().min(1).max(160).default('text/plain'),content:z.string().trim().min(1).max(30000)});
export const projectProfileInputSchema=z.object({name:label.max(120),description:z.string().trim().max(3000).default(''),instructions:z.string().trim().max(8000).default(''),glossary:z.record(z.string().trim().max(500)).default({}),taskTypes:z.array(taskTypeSchema).min(1).max(30),surfaces:z.array(surfaceSchema).max(30),workAreas:z.array(areaSchema).max(50),members:z.array(memberSchema).max(100),assignmentRules:z.array(ruleSchema).max(200),documents:z.array(projectDocumentInputSchema).max(50)}).superRefine((p,ctx)=>{
 const names:[string,string[]][]=[['taskTypes',p.taskTypes.map(x=>x.name)],['product surfaces',p.surfaces.map(x=>x.name)],['work areas',p.workAreas.map(x=>x.name)],['team member names',p.members.map(x=>x.name)],['document filenames',p.documents.map(x=>x.filename)]];
 for(const [name,values] of names)if(!unique(values))ctx.addIssue({code:'custom',message:`${name} must be unique within this project.`});
 const allIds=[...p.taskTypes.map(x=>x.id),...p.surfaces.map(x=>x.id),...p.surfaces.flatMap(x=>x.components.map(c=>c.id)),...p.workAreas.map(x=>x.id),...p.members.map(x=>x.id),...p.assignmentRules.map(x=>x.id),...p.documents.map(x=>x.id)];if(new Set(allIds).size!==allIds.length)ctx.addIssue({code:'custom',message:'Entity IDs must be unique within a project.'});
 for(const surface of p.surfaces)if(!unique(surface.components.map(x=>x.name)))ctx.addIssue({code:'custom',message:`Components for ${surface.name} must be unique.`});
 const surfaceIds=new Set(p.surfaces.map(x=>x.id)),componentIds=new Set(p.surfaces.flatMap(x=>x.components.map(c=>c.id))),areaIds=new Set(p.workAreas.map(x=>x.id)),taskTypeIds=new Set(p.taskTypes.map(x=>x.id)),memberIds=new Set(p.members.map(x=>x.id));
 for(const m of p.members){if(m.areaIds.some(x=>!areaIds.has(x)))ctx.addIssue({code:'custom',message:`Team member ${m.name} references an unknown work area.`});if(m.componentIds.some(x=>!componentIds.has(x)))ctx.addIssue({code:'custom',message:`Team member ${m.name} references an unknown component.`});if(!unique(m.aliases))ctx.addIssue({code:'custom',message:`Aliases for ${m.name} must be unique.`})}
 for(const r of p.assignmentRules){if(!memberIds.has(r.memberId))ctx.addIssue({code:'custom',message:`Assignment rule ${r.name||r.id} references an unknown member.`});else if(r.active&&!p.members.find(m=>m.id===r.memberId)?.active)ctx.addIssue({code:'custom',message:`Assignment rule ${r.name||r.id} targets an inactive member.`});if(r.surfaceId&&!surfaceIds.has(r.surfaceId))ctx.addIssue({code:'custom',message:`Assignment rule ${r.name||r.id} references an unknown product surface.`});if(r.componentId&&!componentIds.has(r.componentId))ctx.addIssue({code:'custom',message:`Assignment rule ${r.name||r.id} references an unknown component.`});if(r.areaId&&!areaIds.has(r.areaId))ctx.addIssue({code:'custom',message:`Assignment rule ${r.name||r.id} references an unknown work area.`});if(r.taskTypeId&&!taskTypeIds.has(r.taskTypeId))ctx.addIssue({code:'custom',message:`Assignment rule ${r.name||r.id} references an unknown task type.`});if(!r.surfaceId&&!r.componentId&&!r.areaId&&!r.taskTypeId)ctx.addIssue({code:'custom',message:`Assignment rule ${r.name||r.id} needs at least one matching condition.`})}
 const componentSurface=new Map(p.surfaces.flatMap(s=>s.components.map(c=>[c.id,s.id] as const)));
 for(const r of p.assignmentRules)if(r.componentId&&r.surfaceId&&componentSurface.get(r.componentId)!==r.surfaceId)ctx.addIssue({code:'custom',message:`Assignment rule ${r.name||r.id} selects a component outside its product surface.`});
 const docTotal=p.documents.reduce((sum,d)=>sum+d.content.length,0);if(docTotal>500000)ctx.addIssue({code:'custom',message:'Project documents must total 500,000 characters or fewer.'});
});
export type ProjectProfileInput=z.infer<typeof projectProfileInputSchema>;
export function validateTaskProfileReferences(data:Partial<z.infer<typeof taskInputSchema>>,snapshot:import('./types').ProjectSnapshot|null):string|null{
 if(!snapshot)return data.assignee?`An assignee must belong to a selected project's team.`:null;
 if(data.type&&!snapshot.taskTypes.some(x=>x.name.toLocaleLowerCase()===data.type!.toLocaleLowerCase()))return'Choose a task type from the selected project profile.';
 if(data.surface&&!snapshot.surfaces.some(x=>x.name.toLocaleLowerCase()===data.surface!.toLocaleLowerCase()))return'Choose a product surface from the selected project profile.';
 if(data.area&&!snapshot.workAreas.some(x=>x.name.toLocaleLowerCase()===data.area!.toLocaleLowerCase()))return'Choose a work area from the selected project profile.';
 if(data.component&&!snapshot.surfaces.some(s=>s.components.some(x=>x.name.toLocaleLowerCase()===data.component!.toLocaleLowerCase())))return'Choose a component from the selected project profile.';
 if(data.component&&data.surface&&!snapshot.surfaces.find(s=>s.name.toLocaleLowerCase()===data.surface!.toLocaleLowerCase())?.components.some(x=>x.name.toLocaleLowerCase()===data.component!.toLocaleLowerCase()))return'Component does not belong to the selected product surface.';

 if(data.assignee&&!snapshot.members.some(x=>x.id===data.assignee&&x.active))return'Choose an active team member from the selected project profile.';
 if(data.projectReferences?.some(ref=>!snapshot.documents.some(d=>d.filename.toLocaleLowerCase()===ref.toLocaleLowerCase())))return'Ticket references must match a document in the meeting profile snapshot.';
 if(data.referenceVersionIds?.some(id=>!snapshot.documents.some(d=>d.currentVersionId===id)))return'Ticket document versions must belong to the meeting profile snapshot.';
 return null;
}
export const taskInputSchema=z.object({title:z.string().trim().min(1).max(200),description:z.string().trim().max(5000),type:z.string().trim().min(1).max(100).nullable().optional(),surface:z.string().trim().max(100).nullable().optional(),area:z.string().trim().max(100).nullable().optional(),component:z.string().trim().max(100).nullable().optional(),projectReferences:z.array(z.string().trim().max(255)).max(5).optional(),projectReferenceEvidence:z.array(z.object({projectId:id,documentId:id,versionId:id,filename:z.string().max(255),pageNumber:z.number().int().positive().nullable(),rowNumber:z.number().int().positive().nullable(),chunkId:id,excerpt:z.string().max(4000)})).max(20).optional(),referenceVersionIds:z.array(id).max(10).optional(),priority:z.enum(['critical','high','medium','low']).nullable(),assignee:z.string().trim().max(120).nullable().optional(),mentionedPeople:z.array(z.string().max(120)).max(30).optional(),deadline:z.string().trim().max(120).nullable().optional(),deadlineEvidence:z.object({rawPhrase:z.string().max(200),normalizedDate:z.string().date().nullable()}).strict().nullable().optional(),context:z.string().trim().max(2000).optional(),sourceTimestamp:z.string().trim().max(40).nullable().optional(),acceptanceCriteria:z.array(z.string().trim().max(500)).max(20),evidence:z.array(z.object({meetingId:id,segmentId:id,speaker:z.string().nullable(),startMs:z.number().nullable(),endMs:z.number().nullable(),sourceText:z.string().max(10000),quote:z.string().max(2000)})).max(50).optional(),sourceQuote:z.string().trim().max(2000).nullable().optional(),confidence:z.number().min(0).max(1).nullable().optional(),classificationNeedsReview:z.boolean().optional(),classificationReviewReasons:z.array(z.string().max(300)).max(20).optional(),assignmentEvidence:z.enum(['explicit','recommendation','none']).optional(),assignmentSource:z.enum(['meeting','rule','responsibility','skill','component-area','ai-recommendation','manual','unassigned']).optional(),assignmentNeedsReview:z.boolean().optional(),assignmentReason:z.string().trim().max(500).nullable().optional(),status:z.enum(['detected','review_required','approved','rejected','created','draft']).optional(),rejectionReason:z.string().trim().max(1000).nullable().optional(),createdTicketId:z.string().nullable().optional()});
export const ticketInputSchema=z.object({sourceTaskId:z.string(),meetingId:id.nullable().optional(),projectId:id.nullable().optional(),title:z.string().trim().min(1).max(200),description:z.string().trim().max(5000),context:z.string().trim().max(2000).nullable().optional(),expectedOutcome:z.string().trim().max(2000).nullable().optional(),taskType:z.string().trim().max(100).nullable().optional(),productSurface:z.string().trim().max(100).nullable().optional(),component:z.string().trim().max(100).nullable().optional(),workArea:z.string().trim().max(100).nullable().optional(),priority:z.enum(['critical','high','medium','low']).nullable().optional(),assignee:z.string().trim().max(120).nullable().optional(),assigneeName:z.string().trim().max(120).nullable().optional(),deadline:z.string().trim().max(120).nullable().optional(),acceptanceCriteria:z.array(z.string().trim().max(500)).max(20).optional(),status:z.enum(['open','todo','in_progress','done','closed']).optional()});

const candidateIntent=z.preprocess(val=>{if(typeof val==='string'){const s=val.toLowerCase().trim();if(s==='accepted'||s==='agreed'||s==='approved'||s==='done')return 'committed';if(s==='declined')return 'rejected';if(s==='postponed'||s==='tabled')return 'deferred';if(['committed','proposed','rejected','cancelled','deferred','unclear'].includes(s))return s}return 'unclear'},z.enum(['committed','proposed','rejected','cancelled','deferred','unclear']));
const priority=z.preprocess(val => {
  if (val == null) return null;
  if (typeof val === 'string') {
    const s = val.toLowerCase().trim();
    if (['critical', 'high', 'medium', 'low'].includes(s)) return s;
    if (s.includes('crit') || s.includes('urg') || s === 'p0') return 'critical';
    if (s.includes('high') || s === 'p1') return 'high';
    if (s.includes('med') || s === 'p2' || s === 'normal') return 'medium';
    if (s.includes('low') || s === 'p3') return 'low';
  }
  return null;
}, z.enum(['critical','high','medium','low']).nullable());
const assignmentEvidenceEnum=z.preprocess(val=>{if(Array.isArray(val)){if(val.some(x=>String(x).toLowerCase().includes('explicit')))return 'explicit';if(val.some(x=>String(x).toLowerCase().includes('recommend')))return 'recommendation';return val.length>0?'explicit':'none'}if(typeof val==='string'){const s=val.toLowerCase().trim();if(s==='explicit'||s==='recommendation'||s==='none')return s;if(s.includes('explicit'))return 'explicit';if(s.includes('recommend'))return 'recommendation'}return 'none'},z.enum(['explicit','recommendation','none']));

const indexItem = z.preprocess(v => {
  if (typeof v === 'number') return Math.max(0, Math.floor(v));
  if (typeof v === 'string') {
    const num = parseInt(v.replace(/\D/g, ''), 10);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}, z.number().int().nonnegative());

const candidateIndexesList = z.preprocess(v => {
  if (v == null) return [];
  if (typeof v === 'number' || typeof v === 'string') return [v];
  if (Array.isArray(v)) return v;
  return [];
}, z.array(indexItem).max(30));

const groupCandidateIndexes = z.preprocess(v => {
  if (v == null) return [0];
  if (typeof v === 'number' || typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.length > 0 ? v : [0];
  return [0];
}, z.array(indexItem).min(1).max(30));

const nullableCleanString = (maxLen = 500) => z.preprocess(v => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'none' || s.toLowerCase() === 'null' || s.toLowerCase() === 'n/a') return null;
  return s;
}, z.string().max(maxLen).nullable());

const confidenceSchema = z.preprocess(v => {
  if (typeof v === 'number') return Math.min(1, Math.max(0, v));
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (!isNaN(n)) return Math.min(1, Math.max(0, n));
  }
  return 0.8;
}, z.number().min(0).max(1));

const candidateKind = z.preprocess(v => {
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim();
    if (['discussion','information','question','status_update','idea','decision','proposal','committed_action'].includes(s)) return s;
    if (s.includes('action') || s.includes('commit') || s.includes('task')) return 'committed_action';
    if (s.includes('propos')) return 'proposal';
    if (s.includes('decis')) return 'decision';
    if (s.includes('idea')) return 'idea';
    if (s.includes('quest')) return 'question';
  }
  return 'discussion';
}, z.enum(['discussion','information','question','status_update','idea','decision','proposal','committed_action']));

export const taskDraftSchema=z.object({
  id,
  meetingId:id,
  title:z.string().trim().min(1).max(200),
  description:z.string().trim().min(1).max(5000),
  taskType:label.nullable(),
  productSurface:label.nullable(),
  workArea:label.nullable(),
  component:label.nullable(),
  priority:priority.nullable(),
  assignee:z.string().trim().max(120).nullable(),
  mentionedPeople:z.array(z.string().trim().min(1).max(120)).max(30),
  deadline:z.object({rawPhrase:z.string().trim().max(200),normalizedDate:z.string().date().nullable()}).strict().nullable(),
  acceptanceCriteria:z.array(z.string().trim().min(1).max(500)).max(20),
  intent:candidateIntent,
  confidence:z.number().min(0).max(1),
  evidence:z.array(z.object({
    meetingId:id,
    segmentId:z.string(),
    speaker:z.string().nullable(),
    startMs:z.number().int().nonnegative().nullable(),
    endMs:z.number().int().nonnegative().nullable(),
    sourceText:z.string().max(10000),
    quote:z.string().max(2000)
  }).strict()).max(50),
  projectReferences:z.array(z.object({
    projectId:id,
    documentId:id,
    versionId:id,
    filename:z.string().min(1).max(255),
    pageNumber:z.number().int().positive().nullable(),
    rowNumber:z.number().int().positive().nullable(),
    chunkId:z.string().max(100),
    excerpt:z.string().max(4000)
  }).strict()).max(20),
  assignmentEvidence:assignmentEvidenceEnum,
  needsReview:z.boolean(),
  reviewReasons:z.array(z.string().max(300)).max(20),
  priorityEvidence:z.string().max(500).nullable()
}).strict();
export type TaskDraftInput=z.infer<typeof taskDraftSchema>;
export const candidateDetectionSchema=z.preprocess(val => {
  if (Array.isArray(val)) return { candidates: val, topics: [], decisions: [], openQuestions: [] };
  if (val && typeof val === 'object') {
    const raw = val as Record<string, unknown>;
    const candidates = raw.candidates ?? raw.candidateList ?? raw.taskCandidates ?? raw.detected_candidates ?? [];
    return {
      ...raw,
      candidates
    };
  }
  return val;
}, z.object({
  candidates: z.preprocess(v => {
    if (!Array.isArray(v)) return [];
    return v
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => {
        const summary = String(item.summary ?? '').trim();
        const evidenceSegmentIds = Array.isArray(item.evidenceSegmentIds)
          ? item.evidenceSegmentIds.filter(Boolean).map(String)
          : (item.evidenceSegmentId ? [String(item.evidenceSegmentId)] : []);
        return {
          ...item,
          summary: (summary || 'Discussion item').slice(0, 500),
          evidenceSegmentIds
        };
      });
  }, z.array(z.object({
    kind: candidateKind,
    intent: candidateIntent,
    summary: z.string().min(1).max(500),
    evidenceSegmentIds: z.array(z.string()).max(30),
    confidence: confidenceSchema
  })).max(100)),
  topics: z.preprocess(v => (Array.isArray(v) ? v.filter(Boolean).map(x => String(x).slice(0, 120)) : []), z.array(z.string().max(120)).max(30)),
  decisions: z.preprocess(v => {
    if (!Array.isArray(v)) return [];
    return v.map(item => (typeof item === 'string' ? { text: item, evidenceSegmentIds: [] } : item))
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && String((item as Record<string, unknown>).text || '').trim().length > 0)
      .map(item => ({
        ...item,
        text: String(item.text).trim().slice(0, 500),
        evidenceSegmentIds: Array.isArray(item.evidenceSegmentIds)
          ? item.evidenceSegmentIds.filter(Boolean).map(String)
          : []
      }));
  }, z.array(z.object({
    text: z.string().min(1).max(500),
    evidenceSegmentIds: z.array(z.string()).max(20)
  })).max(50)),
  openQuestions: z.preprocess(v => {
    if (!Array.isArray(v)) return [];
    return v.map(item => (typeof item === 'string' ? { text: item, evidenceSegmentIds: [] } : item))
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && String((item as Record<string, unknown>).text || '').trim().length > 0)
      .map(item => ({
        ...item,
        text: String(item.text).trim().slice(0, 500),
        evidenceSegmentIds: Array.isArray(item.evidenceSegmentIds)
          ? item.evidenceSegmentIds.filter(Boolean).map(String)
          : []
      }));
  }, z.array(z.object({
    text: z.string().min(1).max(500),
    evidenceSegmentIds: z.array(z.string()).max(20)
  })).max(50))
}));

const groupItemSchema = z.preprocess(val => {
  if (Array.isArray(val)) {
    const firstObj = val.find(x => x && typeof x === 'object' && !Array.isArray(x));
    if (firstObj) return firstObj;
    return {
      candidateIndexes: val,
      kind: 'discussion',
      intent: 'unclear',
      summary: 'Candidate group ' + (val.length ? val.join(', ') : '1')
    };
  }
  return val;
}, z.object({
  candidateIndexes: groupCandidateIndexes,
  kind: candidateKind,
  intent: candidateIntent,
  summary: z.preprocess(v => {
    const s = String(v ?? '').trim();
    return (s || 'Summary not provided').slice(0, 500);
  }, z.string().min(1).max(500)),
  assignee: nullableCleanString(120),
  assignmentEvidence: assignmentEvidenceEnum,
  deadlinePhrase: nullableCleanString(200),
  confidence: confidenceSchema,
  mergeRationale: nullableCleanString(500)
}));

export const reconciliationSchema=z.preprocess(val => {
  if (val && typeof val === 'object') {
    const raw = val as Record<string, unknown>;
    const groups = raw.groups ?? raw.candidates ?? raw.reconciledGroups ?? [];
    return {
      ...raw,
      groups
    };
  }
  return val;
}, z.object({
  summary: z.preprocess(v => {
    const s = String(v ?? '').trim();
    return (s || 'Meeting summary').slice(0, 5000);
  }, z.string().min(1).max(5000)),
  groups: z.preprocess(v => (Array.isArray(v) ? v : []), z.array(groupItemSchema).max(100)),
  decisions: z.preprocess(v => {
    if (!Array.isArray(v)) return [];
    return v.map(item => (typeof item === 'string' ? { text: item, candidateIndexes: [] } : item))
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && String((item as Record<string, unknown>).text || '').trim().length > 0)
      .map(item => ({
        ...item,
        text: String(item.text).trim().slice(0, 500),
        candidateIndexes: item.candidateIndexes ?? []
      }));
  }, z.array(z.object({
    text: z.string().min(1).max(500),
    candidateIndexes: candidateIndexesList
  })).max(50)),
  openQuestions: z.preprocess(v => {
    if (!Array.isArray(v)) return [];
    return v.map(item => (typeof item === 'string' ? { text: item, candidateIndexes: [] } : item))
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && String((item as Record<string, unknown>).text || '').trim().length > 0)
      .map(item => ({
        ...item,
        text: String(item.text).trim().slice(0, 500),
        candidateIndexes: item.candidateIndexes ?? []
      }));
  }, z.array(z.object({
    text: z.string().min(1).max(500),
    candidateIndexes: candidateIndexesList
  })).max(50))
}));

export const taskDraftOutputSchema=z.object({
  title: z.preprocess(v => {
    const s = String(v ?? '').trim();
    return (s || 'Untitled Task').slice(0, 200);
  }, z.string().min(1).max(200)),
  description: z.preprocess(v => {
    const s = String(v ?? '').trim();
    return (s || 'No description provided').slice(0, 5000);
  }, z.string().min(1).max(5000)),
  taskType: nullableCleanString(100),
  productSurface: nullableCleanString(100),
  workArea: nullableCleanString(100),
  component: nullableCleanString(100),
  priority: priority.nullable(),
  mentionedPeople: z.preprocess(v => (Array.isArray(v) ? v.filter(Boolean).map(x => String(x).trim().slice(0, 120)).filter(Boolean) : []), z.array(z.string().min(1).max(120)).max(30)),
  deadlinePhrase: nullableCleanString(200),
  acceptanceCriteria: z.preprocess(v => {
    if (!Array.isArray(v)) return [];
    return v.map(item => {
      if (typeof item === 'string') return { text: item.trim().slice(0, 500), evidenceSegmentIds: [], projectChunkIds: [] };
      if (item && typeof item === 'object') {
        const text = String((item as { text?: unknown }).text || '').trim().slice(0, 500);
        return {
          text,
          evidenceSegmentIds: Array.isArray((item as { evidenceSegmentIds?: unknown }).evidenceSegmentIds)
            ? (item as { evidenceSegmentIds: unknown[] }).evidenceSegmentIds.filter(Boolean).map(String)
            : [],
          projectChunkIds: Array.isArray((item as { projectChunkIds?: unknown }).projectChunkIds)
            ? (item as { projectChunkIds: unknown[] }).projectChunkIds.filter(Boolean).map(String)
            : []
        };
      }
      return null;
    }).filter((x): x is { text: string; evidenceSegmentIds: string[]; projectChunkIds: string[] } => !!x && x.text.length > 0);
  }, z.array(z.object({
    text: z.string().min(1).max(500),
    evidenceSegmentIds: z.array(z.string()).max(20),
    projectChunkIds: z.array(z.string()).max(20)
  })).max(20)),
  confidence: confidenceSchema,
  evidenceQuotes: z.preprocess(v => {
    if (!Array.isArray(v)) return [];
    return v.filter(item => item && typeof item === 'object' && item.segmentId && String(item.quote ?? '').trim().length > 0).map(item => ({
      segmentId: String(item.segmentId),
      quote: String(item.quote).trim().slice(0, 2000)
    }));
  }, z.array(z.object({
    segmentId: z.string(),
    quote: z.string().min(1).max(2000)
  })).max(50)),
  projectChunkExcerpts: z.preprocess(v => {
    if (!Array.isArray(v)) return [];
    return v.filter(item => item && typeof item === 'object' && item.chunkId && typeof item.chunkId === 'string' && item.chunkId.toLowerCase() !== 'none' && item.chunkId.toLowerCase() !== 'null' && String(item.excerpt ?? '').trim().length > 0).map(item => ({
      chunkId: String(item.chunkId).slice(0, 100),
      excerpt: String(item.excerpt).trim().slice(0, 4000)
    }));
  }, z.array(z.object({
    chunkId: z.string().max(100),
    excerpt: z.string().min(1).max(4000)
  })).max(20)),
  priorityEvidence: z.preprocess(v => {
    if (!v || typeof v !== 'object') return { source: 'none', segmentIds: [], chunkIds: [], explanation: '' };
    const src = String((v as { source?: unknown }).source || '').toLowerCase();
    const source = ['meeting', 'project', 'none'].includes(src) ? src : 'none';
    const segmentIds = Array.isArray((v as { segmentIds?: unknown }).segmentIds) ? (v as { segmentIds: unknown[] }).segmentIds.filter(Boolean).map(String) : [];
    const chunkIds = Array.isArray((v as { chunkIds?: unknown }).chunkIds) ? (v as { chunkIds: unknown[] }).chunkIds.filter(Boolean).map(String) : [];
    const explanation = String((v as { explanation?: unknown }).explanation || '').slice(0, 300);
    return { source, segmentIds, chunkIds, explanation };
  }, z.object({
    source: z.enum(['meeting', 'project', 'none']),
    segmentIds: z.array(z.string()).max(10),
    chunkIds: z.array(z.string()).max(10),
    explanation: z.string().max(300)
  }))
});

export const taskDraftBatchSchema=z.preprocess(val => {
  if (Array.isArray(val)) return { tasks: val };
  if (val && typeof val === 'object' && !('tasks' in val)) {
    const arr = Object.values(val).find(Array.isArray);
    if (arr) return { tasks: arr };
  }
  return val;
}, z.object({tasks:z.array(taskDraftOutputSchema.extend({candidateIndex:indexItem})).max(20)}));
const taskCandidateSchema=z.object({intent:z.enum(['committed','proposed','rejected','cancelled','deferred','unclear']),title:z.string().min(1).max(200),description:z.string().max(5000),type:z.string().min(1).max(100),surface:z.string().max(100).nullable().optional().default(null),area:z.string().max(100).nullable().optional().default(null),component:z.string().max(100).nullable().optional().default(null),projectReferences:z.array(z.string().max(255)).max(5).optional().default([]),priority:z.enum(['low','medium','high']),assignee:z.string().nullable(),assignmentEvidence:z.enum(['explicit','recommendation','none']).optional().default('none'),deadline:z.string().nullable().optional().default(null),context:z.string().max(2000).optional().default(''),sourceTimestamp:z.string().nullable().optional().default(null),acceptanceCriteria:z.array(z.string().max(500)).max(20),sourceQuote:z.string().min(1).max(2000),confidence:z.number().min(0).max(1)});
const rawAnalysisSchema=z.object({summary:z.string().min(1).max(5000),topics:z.array(z.string().max(120)).max(20),decisions:z.array(z.string().max(500)).max(30),taskCandidates:z.array(taskCandidateSchema).max(80)});
export const analysisSchema=rawAnalysisSchema.transform(({taskCandidates,...analysis})=>({...analysis,candidates:taskCandidates.map((candidate,index)=>({id:`candidate-${index}`,meetingId:'',intent:candidate.intent,payload:candidate as unknown as Record<string,unknown>,createdAt:''})),tasks:taskCandidates.filter(candidate=>candidate.intent==='committed').map(candidate=>{const task=Object.fromEntries(Object.entries(candidate).filter(([key])=>key!=='intent'));return{...task,referenceVersionIds:[] as string[],assigneeName:null,assignmentSource:'unassigned' as const,assignmentNeedsReview:true,assignmentReason:null} as Omit<typeof candidate,'intent'>&{referenceVersionIds:string[];assigneeName:null;assignmentSource:'unassigned';assignmentNeedsReview:boolean;assignmentReason:null}})}));
