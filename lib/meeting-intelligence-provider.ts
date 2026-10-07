import {randomUUID} from 'node:crypto';
import {getSelectedModel} from './model-settings';
import {buildStructuredTask,chunkTranscriptSegments,DetectedCandidate,reconcileCandidateGroups,ReconciledCandidate} from './meeting-intelligence';
import {AssignmentSource,Meeting,ProjectKnowledgeChunk,ProjectProfile,ProjectSnapshot,Task,TaskCandidate,TranscriptSegment} from './types';
import {candidateDetectionSchema,reconciliationSchema,taskDraftBatchSchema,taskDraftOutputSchema} from './validation';
import {resolveAssignment} from './assignment';
import {searchProjectKnowledge} from './store';
import {logger} from './logger';

type StageModel={provider:'ollama'|'openai';model:string};

function repairJson(raw: string): string {
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === '\\') {
        isEscaped = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      }
    }
  }

  let repaired = raw;
  if (inString) {
    if (isEscaped) {
      repaired = repaired.slice(0, -1);
    }
    repaired += '"';
  }

  repaired = repaired.trimEnd();
  if (repaired.endsWith(':')) {
    repaired += ' null';
  }
  repaired = repaired.replace(/,\s*$/, '');

  const finalStack: string[] = [];
  inString = false;
  isEscaped = false;
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (inString) {
      if (isEscaped) isEscaped = false;
      else if (ch === '\\') isEscaped = true;
      else if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === '{') finalStack.push('}');
      else if (ch === '[') finalStack.push(']');
      else if (ch === '}' || ch === ']') {
        if (finalStack.length && finalStack[finalStack.length - 1] === ch) {
          finalStack.pop();
        }
      }
    }
  }

  repaired = repaired.replace(/,\s*$/, '');
  while (finalStack.length) {
    repaired += finalStack.pop();
  }

  return repaired;
}

function cleanAndParseJson(text:string,stage:string):unknown{
  let cleaned=text.trim();
  if(cleaned.startsWith('```')){
    cleaned=cleaned.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  }
  try{return JSON.parse(cleaned)}
  catch{
    const match=cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if(match){
      cleaned=match[1];
      try{return JSON.parse(cleaned)}
      catch{
        const sanitized=cleaned.replace(/,\s*([}\]])/g,'$1');
        try{return JSON.parse(sanitized)}catch{/* proceed to repair */}
      }
    }

    try {
      const startIdx = cleaned.search(/[{[]/);
      const candidate = startIdx >= 0 ? cleaned.slice(startIdx) : cleaned;
      return JSON.parse(repairJson(candidate));
    } catch {
      try {
        const startIdx = cleaned.search(/[{[]/);
        const candidate = startIdx >= 0 ? cleaned.slice(startIdx) : cleaned;
        return JSON.parse(repairJson(candidate).replace(/,\s*([}\]])/g, '$1'));
      } catch { /* failed */ }
    }

    throw new Error(`AI returned invalid JSON during ${stage}. Please retry.`);
  }
}

async function askJson(stage:string,instructions:string,input:unknown,model:StageModel,signal?:AbortSignal){
  if(signal?.aborted)throw new Error('Processing was stopped by user.');
  const startTime=Date.now();
  const messages=[{role:'system' as const,content:instructions},{role:'user' as const,content:JSON.stringify(input)}];
  logger.debug(`Calling AI for ${stage}`,{stage,provider:model.provider,model:model.model});
  let response:Response;
  if(model.provider==='ollama'){
    const base=(process.env.OLLAMA_BASE_URL||'http://localhost:11434').replace(/\/$/,'');
    try{
      response=await fetch(`${base}/api/chat`,{
        method:'POST',
        signal,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:model.model,stream:false,think:false,format:'json',options:{temperature:0.1,num_ctx:Number(process.env.OLLAMA_NUM_CTX||8192),num_predict:Number(process.env.OLLAMA_NUM_PREDICT||3584),num_gpu:999},messages})
      });
    }catch(err:unknown){
      if(signal?.aborted||(err as {name?:string})?.name==='AbortError')throw new Error('Processing was stopped by user.');
      throw new Error(`Cannot connect to Ollama during ${stage}. Start Ollama and confirm the selected model is available.`);
    }
    if(!response.ok)throw new Error(`Ollama ${stage} error (${response.status}): ${await response.text()}`);
    const data=await response.json();
    const content=data.message?.content;
    if(!content)throw new Error(`Ollama returned an empty response during ${stage}.`);
    logger.debug(`AI call completed for ${stage}`,{durationMs:Date.now()-startTime});
    return cleanAndParseJson(content,stage);
  }
  const key=process.env.OPENAI_API_KEY;
  if(!key)throw new Error('OPENAI_API_KEY is missing. Set AI_PROVIDER=ollama to use local models.');
  try{
    response=await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      signal,
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:model.model,temperature:0.1,response_format:{type:'json_object'},messages})
    });
  }catch(err:unknown){
    if(signal?.aborted||(err as {name?:string})?.name==='AbortError')throw new Error('Processing was stopped by user.');
    throw err;
  }
  if(!response.ok)throw new Error(`OpenAI ${stage} error (${response.status}): ${await response.text()}`);
  const content=(await response.json()).choices?.[0]?.message?.content;
  if(!content)throw new Error(`OpenAI returned an empty response during ${stage}.`);
  logger.debug(`AI call completed for ${stage}`,{durationMs:Date.now()-startTime});
  return cleanAndParseJson(content,stage);
}
const SPEAKER_IDENTITY_RULE = `Speaker IDs such as SPEAKER_00, SPEAKER_01, and SPEAKER_02 are anonymous diarization identifiers. Never infer, guess, or assign a real person's identity to a speaker ID. Only use a real person's identity when an explicit user-provided speaker mapping exists. If no mapping exists, refer to the speaker only by their speaker ID.`;
const DETECT=`You analyze software meeting transcript segments to extract all distinct tasks, tickets, features, and decisions. Return only JSON matching:
{"candidates":[{"kind":"committed_action"|"proposal"|"idea"|"decision","intent":"committed"|"proposed"|"deferred","summary":"under 12 words","evidenceSegmentIds":["id-from-segments"],"confidence":0.9}],"topics":["topic"],"decisions":[{"text":"decision","evidenceSegmentIds":["id"]}],"openQuestions":[]}.
Extract EVERY distinct work item, ticket, bug fix, feature, test, or proposal discussed. Keep candidate summary concise (under 12 words). For each candidate, copy the exact segment id into evidenceSegmentIds. Do not omit any deliverable. Keep each distinct feature (e.g. login fixes, profile picture upload, database optimization, CSV export, test additions) as its own separate candidate. Never bundle multiple different features together into one candidate. Ignore greetings and chatter. ${SPEAKER_IDENTITY_RULE}`;
const RECONCILE=`You review and reconcile candidate mentions across the WHOLE meeting. Return only JSON matching:
{"summary":"brief meeting summary","groups":[{"candidateIndexes":[0],"kind":"committed_action"|"proposal"|"idea","intent":"committed"|"proposed"|"deferred","summary":"under 15 words","assignee":null,"assignmentEvidence":"none","deadlinePhrase":null,"confidence":0.9,"mergeRationale":null}],"decisions":[{"text":"decision","candidateIndexes":[0]}],"openQuestions":[]}.
Every distinct feature, bug, deliverable, or test MUST remain its own separate group in groups. In candidateIndexes, assign ONLY the single candidate index for that item (e.g. [0] for item 0, [1] for item 1, [2] for item 2). NEVER combine different features into one group. Only merge if two candidates are identical duplicate mentions of the exact same task. When meeting decisions or wrap-up summaries approve, commit to, or decide to execute discussed action items (e.g. "commit the tickets", "agreed to do all four", "let's proceed"), classify those items as committed intent. Assign a person as explicit only when directly assigned. Recommendations must name a person. ${SPEAKER_IDENTITY_RULE}`;
const DRAFT=`Draft structured tasks only for the supplied candidate summaries and evidence. Return only JSON matching {tasks:[{candidateIndex,title,description,taskType,productSurface,workArea,component,priority,mentionedPeople,deadlinePhrase,acceptanceCriteria:[{text,evidenceSegmentIds,projectChunkIds}],confidence,evidenceQuotes:[{segmentId,quote}],projectChunkExcerpts:[{chunkId,excerpt}],priorityEvidence:{source,segmentIds,chunkIds,explanation}}]}. Use exactly the supplied candidate indexes. Draft the final task meaning without changing its final intent. Use ONLY exact project-defined task types, product surfaces, work areas, and components listed in the profile; return null when not clear. Never invent people, dates, priorities, commitments, requirements, or acceptance criteria. Use null priority unless a cited meeting passage or project excerpt supports it. Keep acceptance criteria only when directly supported by cited meeting segments or supplied project excerpts. Mentioned people must occur in the evidence. Quote evidence verbatim from supplied transcript segments. Cite only supplied chunk IDs and copy exact excerpts. Project documents may ground terminology and technical context but may not create a meeting commitment or new acceptance criteria. A date is normalized elsewhere: provide only the verbatim deadline phrase present in the transcript, and null if none. If task classification is uncertain return null and rely on review. ${SPEAKER_IDENTITY_RULE}`;
function sourceDateContext(meeting:Meeting){return`Meeting date: ${meeting.createdAt.slice(0,10)}. Relative deadlines such as “Friday”, “next week”, or “soon” must retain their raw phrase and stay unnormalized unless the transcript provides enough context to resolve them safely.`}
function sourceTime(ms:number|null){if(ms===null)return null;const total=Math.floor(ms/1000);return`${Math.floor(total/60).toString().padStart(2,'0')}:${(total%60).toString().padStart(2,'0')}`}
function allowedVersions(project:ProjectSnapshot|null){return project?.documents.map(doc=>doc.currentVersionId).filter((id):id is string=>!!id)||[]}
function candidateTask(group:ReconciledCandidate,output:ReturnType<typeof taskDraftBatchSchema.parse>['tasks'][number],meeting:Meeting,segments:TranscriptSegment[],knowledge:ProjectKnowledgeChunk[],project:ProjectSnapshot|null):Task{
 const structured=buildStructuredTask({id:randomUUID(),meetingId:meeting.id,group,output,segments,knowledge,project});const projectProfile=project as ProjectProfile|null;const assignment=resolveAssignment({assignee:structured.assignee,assignmentEvidence:structured.assignmentEvidence,title:structured.title,description:structured.description,context:group.summary,type:structured.taskType||'',surface:structured.productSurface,area:structured.workArea,component:structured.component},projectProfile);const member=assignment.assigneeId?project?.members.find(item=>item.id===assignment.assigneeId):null;const createdAt=new Date().toISOString();const citations=structured.projectReferences;const isCommitted=group.intent==='committed';const needsReview=structured.needsReview||structured.confidence<0.75||assignment.needsReview||!isCommitted;const status=needsReview?'review_required':'detected';const reviewReasons=[...structured.reviewReasons];if(!isCommitted){reviewReasons.push(group.intent==='proposed'?'Proposed during meeting; confirm commitment before creating ticket.':'Intent uncertain from transcript; review before approving.');}if(structured.confidence<0.65){reviewReasons.push('Low confidence; review task grounding.');}return{id:structured.id,meetingId:meeting.id,title:structured.title,description:structured.description,type:structured.taskType,surface:structured.productSurface,area:structured.workArea,component:structured.component,projectReferences:[...new Set(citations.map(x=>x.filename))],projectReferenceEvidence:citations,referenceVersionIds:[...new Set(citations.map(x=>x.versionId))],priority:structured.priority,assignee:assignment.assigneeId,assigneeName:member?.name||null,mentionedPeople:structured.mentionedPeople,assignmentEvidence:structured.assignmentEvidence,deadline:structured.deadline?.normalizedDate||structured.deadline?.rawPhrase||null,deadlineEvidence:structured.deadline,context:group.summary,sourceTimestamp:sourceTime(structured.evidence[0]?.startMs??null),acceptanceCriteria:structured.acceptanceCriteria,evidence:structured.evidence,sourceQuote:structured.evidence[0]?.quote||null,confidence:structured.confidence,classificationNeedsReview:needsReview,classificationReviewReasons:reviewReasons,assignmentSource:assignment.source as AssignmentSource,assignmentNeedsReview:assignment.needsReview,assignmentReason:assignment.reason,status,rejectionReason:null,createdTicketId:null,createdAt,updatedAt:createdAt};
}
function isTaskLike(group:ReconciledCandidate){
  return ['committed_action','proposal','idea','task','bug','feature','discussion','decision'].includes(group.kind) ||
    group.intent === 'committed' ||
    group.intent === 'proposed' ||
    group.intent === 'unclear';
}
function makeDemoResult(meeting:Meeting,segments:TranscriptSegment[],project:ProjectSnapshot|null){const joined=segments.map(segment=>segment.text).join(' ');const candidateSegment=segments.filter(segment=>/retry|implement|take that|do this/i.test(segment.text));if(!candidateSegment.length)return{summary:'No committed work items were identified in the demo transcript.',topics:[],decisions:[],openQuestions:[],tasks:[],candidates:[]};const ids=candidateSegment.map(x=>x.id),group:ReconciledCandidate={kind:'committed_action',intent:'committed',summary:'Implement retry handling for payment callbacks and prevent duplicate transactions.',evidenceSegmentIds:ids,assignee:'Alex',assignmentEvidence:'explicit',deadlinePhrase:null,confidence:0.9,mergeRationale:null};const output=taskDraftBatchSchema.parse({tasks:[{candidateIndex:0,title:'Add bounded retries for payment callbacks',description:'Implement bounded retries for failed payment callbacks, log failed attempts, and prevent duplicate callbacks from creating duplicate transactions.',taskType:project?.taskTypes.find(x=>x.name.toLocaleLowerCase()==='bug')?.name||null,productSurface:null,workArea:null,component:null,priority:null,mentionedPeople:['Alex','Priya'],deadlinePhrase:null,acceptanceCriteria:[],confidence:0.9,evidenceQuotes:candidateSegment.map(segment=>({segmentId:segment.id,quote:segment.text.slice(0,150)})),projectChunkExcerpts:[],priorityEvidence:{source:'none',segmentIds:[],chunkIds:[],explanation:''}}]}).tasks[0];const task=candidateTask(group,output,meeting,segments,[],project);const candidate:TaskCandidate={id:randomUUID(),meetingId:meeting.id,intent:'committed',createdAt:new Date().toISOString(),payload:{kind:group.kind,summary:group.summary,evidence:task.evidence,task}};return{summary:joined?'Demo analysis identified one committed retry task from the sample transcript.':'No transcript text was available.',topics:['Payment callbacks','Retries'],decisions:['Add bounded retries to failed payment callbacks.'],openQuestions:[],tasks:[task],candidates:[candidate]}}
export async function analyzeMeetingIntelligence(meeting:Meeting,project:ProjectSnapshot|null,selectedModel?:string,onStage?:(stage:string)=>Promise<void>,signal?:AbortSignal){const segments=meeting.transcriptSegments?.length?meeting.transcriptSegments:[];const provider=process.env.AI_PROVIDER||'ollama';if(provider==='demo')return makeDemoResult(meeting,segments,project);if(provider!=='ollama'&&provider!=='openai')throw new Error(`Unsupported AI_PROVIDER: ${provider}`);const model:StageModel={provider,model:selectedModel||(provider==='ollama'?await getSelectedModel():process.env.OPENAI_ANALYSIS_MODEL||'gpt-4o-mini')};const transcriptChunks=chunkTranscriptSegments(segments,Number(process.env.MEETING_ANALYSIS_CHUNK_CHARS||12000),1);const detected:DetectedCandidate[]=[];const topics:string[]=[];const decisionsSeen:Array<{text:string;evidenceSegmentIds:string[]}>=[];const questionsSeen:Array<{text:string;evidenceSegmentIds:string[]}>=[];for(const [index,chunk] of transcriptChunks.entries()){if(signal?.aborted)throw new Error('Processing was stopped by user.');await onStage?.(`Detecting candidates · transcript section ${index+1}/${transcriptChunks.length}`);const parsed=candidateDetectionSchema.parse(await askJson('candidate detection',DETECT,{chunk:index+1,totalChunks:transcriptChunks.length,segments:chunk.map(({id,sequence,speaker,startMs,endMs,text})=>({id,sequence,speaker,startMs,endMs,text}))},model,signal));const ids=new Set(chunk.map(x=>x.id));detected.push(...parsed.candidates.map(candidate=>{const validIds=[...new Set(candidate.evidenceSegmentIds)].filter(id=>ids.has(id));const fallbackIds=chunk[0]?.id?[chunk[0].id]:[];return {...candidate,evidenceSegmentIds:validIds.length?validIds:fallbackIds}}).filter(candidate=>candidate.evidenceSegmentIds.length));topics.push(...parsed.topics);decisionsSeen.push(...parsed.decisions.map(item=>({...item,evidenceSegmentIds:item.evidenceSegmentIds.filter(id=>ids.has(id))})).filter(item=>item.evidenceSegmentIds.length));questionsSeen.push(...parsed.openQuestions.map(item=>({...item,evidenceSegmentIds:item.evidenceSegmentIds.filter(id=>ids.has(id))})).filter(item=>item.evidenceSegmentIds.length))}
 if(signal?.aborted)throw new Error('Processing was stopped by user.');await onStage?.('Resolving intent and merging repeated mentions');const evidenceById=new Map(segments.map(segment=>[segment.id,segment]));const reconciliationRaw=await askJson('intent classification and candidate merging',RECONCILE,{meetingDate:meeting.createdAt.slice(0,10),candidates:detected.map((candidate,index)=>({index,...candidate,evidence:candidate.evidenceSegmentIds.map(id=>evidenceById.get(id)).filter(Boolean)})),chunkDecisions:decisionsSeen,chunkOpenQuestions:questionsSeen},model,signal);const reconciliation=reconciliationSchema.parse(reconciliationRaw);const groups=reconcileCandidateGroups(detected,reconciliation,segments);if(signal?.aborted)throw new Error('Processing was stopped by user.');await onStage?.('Retrieving project knowledge for task candidates');const versions=allowedVersions(project);const retrieved=new Map<number,ProjectKnowledgeChunk[]>();for(const [index,group] of groups.entries()){if(!isTaskLike(group)||!meeting.projectId||!versions.length){retrieved.set(index,[]);continue}const query=`${group.summary}\n${group.evidenceSegmentIds.map(id=>evidenceById.get(id)?.text||'').join('\n')}`;retrieved.set(index,await searchProjectKnowledge(meeting.projectId,query,4,versions))}
 if(signal?.aborted)throw new Error('Processing was stopped by user.');await onStage?.('Drafting evidence-backed tasks');const taskLike=groups.map((group,index)=>({group,index})).filter(item=>isTaskLike(item.group));const outputs=new Map<number,ReturnType<typeof taskDraftBatchSchema.parse>['tasks'][number]>();for(let offset=0;offset<taskLike.length;offset+=4){if(signal?.aborted)throw new Error('Processing was stopped by user.');const batch=taskLike.slice(offset,offset+4);const payload=batch.map(({group,index},candidateIndex)=>({candidateIndex,finalIntent:group.intent,kind:group.kind,summary:group.summary,assignment:{name:group.assignee,evidence:group.assignmentEvidence},deadlinePhrase:group.deadlinePhrase,evidence:group.evidenceSegmentIds.map(id=>evidenceById.get(id)).filter(Boolean),retrievedProjectKnowledge:(retrieved.get(index)||[]).map(chunk=>({projectId:chunk.projectId,documentId:chunk.documentId,versionId:chunk.versionId,filename:chunk.filename,pageNumber:chunk.pageNumber,rowNumber:chunk.rowNumber,chunkId:chunk.chunkId,text:chunk.text.slice(0,3000)}))}));const profile=project?{taskTypes:project.taskTypes.map(x=>x.name),productSurfaces:project.surfaces.map(surface=>({name:surface.name,components:surface.components.map(x=>x.name)})),workAreas:project.workAreas.map(x=>x.name),instructions:project.instructions}:null;const parsed=taskDraftBatchSchema.parse(await askJson('task normalization and ticket drafting',`${DRAFT}\n${sourceDateContext(meeting)}\nFor this request return one task draft for every supplied task-like candidate, even when its final intent is proposed, rejected, cancelled, or deferred. Never change its finalIntent. If classification is unknown use null.`,{projectProfile:profile,candidates:payload},model,signal));for(const output of parsed.tasks){const target=batch[output.candidateIndex];if(target&&!outputs.has(target.index))outputs.set(target.index,output)}}
 const tasks:Task[]=[];const candidates:TaskCandidate[]=[];for(const [index,group] of groups.entries()){const knowledge=retrieved.get(index)||[];let output=outputs.get(index);if(!output&&isTaskLike(group)){output={...taskDraftOutputSchema.parse({title:group.summary.slice(0,100),description:group.summary,taskType:null,productSurface:null,workArea:null,component:null,priority:null,mentionedPeople:group.assignee?[group.assignee]:[],deadlinePhrase:group.deadlinePhrase,acceptanceCriteria:[],confidence:group.confidence,evidenceQuotes:group.evidenceSegmentIds.map(id=>({segmentId:id,quote:evidenceById.get(id)?.text.slice(0,150)||''})).filter(x=>x.quote),projectChunkExcerpts:[],priorityEvidence:{source:'none',segmentIds:[],chunkIds:[],explanation:''}}),candidateIndex:index}}let task:Task|undefined;if(output){task=candidateTask(group,output,meeting,segments,knowledge,project);if(group.intent==='committed'||group.intent==='proposed'||group.intent==='unclear')tasks.push(task)}const evidence=group.evidenceSegmentIds.map(id=>evidenceById.get(id)).filter((x):x is TranscriptSegment=>!!x).map(segment=>({meetingId:meeting.id,segmentId:segment.id,speaker:segment.speaker,startMs:segment.startMs,endMs:segment.endMs,sourceText:segment.text}));candidates.push({id:randomUUID(),meetingId:meeting.id,intent:group.intent,createdAt:new Date().toISOString(),payload:{kind:group.kind,summary:group.summary,confidence:group.confidence,evidence,assignment:{name:group.assignee,evidence:group.assignmentEvidence},deadlinePhrase:group.deadlinePhrase,mergeRationale:group.mergeRationale,task,reviewReasons:task?.classificationReviewReasons||[]}})}
 const decisions=[...new Set([...reconciliation.decisions.map(item=>item.text.trim()),...decisionsSeen.map(item=>item.text.trim())])].filter(Boolean);const openQuestions=[...new Set([...reconciliation.openQuestions.map(item=>item.text.trim()),...questionsSeen.map(item=>item.text.trim())])].filter(Boolean);return{summary:reconciliation.summary,topics:[...new Set(topics)].slice(0,30),decisions,openQuestions,tasks,candidates}}
