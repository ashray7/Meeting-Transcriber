import {describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {projectProfileInputSchema,validateTaskProfileReferences} from './validation';

function valid(){const surface=randomUUID(),component=randomUUID(),area=randomUUID(),taskType=randomUUID(),member=randomUUID();const project=projectProfileInputSchema.parse({name:'Demo',description:'',instructions:'',glossary:{API:'Application programming interface'},taskTypes:[{id:taskType,name:'Backend',description:'',position:0}],surfaces:[{id:surface,name:'Web',description:'',components:[{id:component,name:'Dashboard',description:''}]}],workAreas:[{id:area,name:'Backend',description:''}],members:[{id:member,name:'John',role:'Engineer',skills:['Node'],responsibilities:['Payments'],areaIds:[area],componentIds:[component],aliases:['Johnny'],email:'john@example.com',externalId:'u-123',active:true}],assignmentRules:[],documents:[]});return{project,surface,component,area,taskType,member}}
describe('project profile schemas',()=>{
 it('validates project creation, member metadata, custom task types, and components',()=>{const x=valid();expect(projectProfileInputSchema.safeParse(x.project).success).toBe(true)});
 it('rejects a task type duplicated by case',()=>{const x=valid();x.project.taskTypes.push({...x.project.taskTypes[0],id:randomUUID(),name:'backend'});expect(projectProfileInputSchema.safeParse(x.project).success).toBe(false)});
 it('rejects member references to unknown work areas or components',()=>{const x=valid();x.project.members[0].areaIds=[randomUUID()];expect(projectProfileInputSchema.safeParse(x.project).success).toBe(false)});
 it('rejects assignment rules with dangling member/type/surface IDs',()=>{const x=valid();x.project.assignmentRules=[{id:randomUUID(),name:'Broken',surfaceId:x.surface,componentId:null,areaId:null,taskTypeId:null,memberId:randomUUID(),active:true,position:0}];expect(projectProfileInputSchema.safeParse(x.project).success).toBe(false)});
 it('rejects a component paired with a different surface',()=>{const x=valid();const other=randomUUID();x.project.surfaces.push({id:other,name:'Mobile',description:'',components:[]});x.project.assignmentRules=[{id:randomUUID(),name:'Cross-surface',surfaceId:other,componentId:x.component,areaId:null,taskTypeId:null,memberId:x.member,active:true,position:0}];expect(projectProfileInputSchema.safeParse(x.project).success).toBe(false)});
 it('requires existing profile labels and members for task references',()=>{const x=valid();const profile=projectProfileInputSchema.parse(x.project);const snapshot={...profile,id:randomUUID(),createdAt:'',updatedAt:'',documents:profile.documents.map(d=>({...d,projectId:'',size:0,uploadedAt:'',processingStatus:'ready' as const,version:1,currentVersionId:randomUUID(),versions:[],extractedTextMetadata:{encoding:'utf-8',characters:0,checksum:null},chunkCount:0,error:null,active:true}))};expect(validateTaskProfileReferences({type:'Backend',surface:'Web',area:'Backend',component:'Dashboard',assignee:x.member},snapshot)).toBeNull();expect(validateTaskProfileReferences({type:'Web',surface:'Web',area:'Backend'},snapshot)).toMatch(/task type/);expect(validateTaskProfileReferences({type:'Backend',assignee:randomUUID()},snapshot)).toMatch(/team member/)});
});

describe('AI response schemas tolerance', () => {
  it('safely parses candidateDetectionSchema with extra LLM metadata like confidence on decisions and questions', async () => {
    const { candidateDetectionSchema } = await import('./validation');
    const segmentId = randomUUID();
    const result = candidateDetectionSchema.parse({
      candidates: [{
        kind: 'committed_action',
        intent: 'accepted',
        summary: 'Fix payment callbacks',
        evidenceSegmentIds: [segmentId],
        confidence: 0.95
      }],
      topics: ['Payments'],
      decisions: [{
        text: 'Fix callbacks before Friday',
        evidenceSegmentIds: [segmentId],
        confidence: 0.9
      }],
      openQuestions: [{
        text: 'Do we need a fallback endpoint?',
        evidenceSegmentIds: [segmentId],
        confidence: 0.85
      }]
    });

    expect(result.candidates[0].intent).toBe('committed');
    expect(result.decisions[0].text).toBe('Fix callbacks before Friday');
    expect(result.openQuestions[0].text).toBe('Do we need a fallback endpoint?');
  });

  it('safely parses reconciliationSchema with extra LLM metadata', async () => {
    const { reconciliationSchema } = await import('./validation');
    const result = reconciliationSchema.parse({
      summary: 'Meeting summary',
      groups: [{
        candidateIndexes: [0],
        kind: 'committed_action',
        intent: 'agreed',
        summary: 'Implement retry logic',
        assignee: 'Alex',
        assignmentEvidence: 'explicit',
        deadlinePhrase: 'Friday',
        confidence: 0.92,
        mergeRationale: null
      }],
      decisions: [{
        text: 'Agreed on retry logic',
        candidateIndexes: [0],
        confidence: 0.9
      }],
      openQuestions: []
    });

    expect(result.groups[0].intent).toBe('committed');
  });
});

