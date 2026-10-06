import {AssignmentEvidence,AssignmentRule,AssignmentSource,ProjectMember,ProjectProfile} from './types';

export type AssignableTask={assignee:string|null;assignmentEvidence:AssignmentEvidence;title:string;description:string;context?:string;type:string|null;surface:string|null;area:string|null;component:string|null};
export type AssignmentResult={assigneeId:string|null;source:AssignmentSource;needsReview:boolean;reason:string|null};
const norm=(value:string|null|undefined)=>value?.trim().toLocaleLowerCase()||'';
const words=(value:string)=>new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(x=>!['the','and','for','with','from','this','that','into','work','task'].includes(x)));
function exactMembers(members:ProjectMember[],name:string){const target=norm(name);return members.filter(m=>m.active&&[m.name,...m.aliases].some(x=>norm(x)===target))}
function oneCandidate(candidates:ProjectMember[],source:AssignmentSource,reason:string):AssignmentResult{const ids=[...new Set(candidates.map(x=>x.id))];if(ids.length===1)return{assigneeId:ids[0],source,needsReview:false,reason};if(ids.length>1)return{assigneeId:null,source:'unassigned',needsReview:true,reason:`Ambiguous ${reason.toLocaleLowerCase()}; choose an assignee.`};return{assigneeId:null,source:'unassigned',needsReview:true,reason:`No active team member matched by ${reason.toLocaleLowerCase()}.`}}
function textMatch(members:ProjectMember[],task:AssignableTask,key:'responsibilities'|'skills'){
 const query=words([task.title,task.description,task.context||'',task.type||'',task.surface||'',task.area||'',task.component||''].join(' '));
 const scored=members.filter(m=>m.active).map(member=>({member,score:Math.max(0,...member[key].map(entry=>{const label=norm(entry);const exact=[task.type,task.surface,task.area,task.component].some(x=>norm(x)===label&&label);if(exact)return 100;const entryWords=words(entry);let overlap=0;for(const word of entryWords)if(query.has(word))overlap++;return overlap>=2?overlap:0}))})).filter(x=>x.score>0);
 if(!scored.length)return[];const high=Math.max(...scored.map(x=>x.score));return scored.filter(x=>x.score===high).map(x=>x.member);
}
export function resolveAssignment(task:AssignableTask,project:ProjectProfile|null):AssignmentResult{
 if(!project)return{assigneeId:null,source:'unassigned',needsReview:true,reason:'No project team is configured for assignment.'};
 const active=project.members.filter(m=>m.active);
 if(task.assignmentEvidence==='explicit'&&task.assignee){const matches=exactMembers(active,task.assignee);if(matches.length===1)return{assigneeId:matches[0].id,source:'meeting',needsReview:false,reason:`Explicitly assigned to ${matches[0].name} in the meeting.`};return{assigneeId:null,source:'unassigned',needsReview:true,reason:matches.length?'Explicit meeting assignment is ambiguous.':`Meeting names “${task.assignee}”, which does not match an active project member.`}}
 const surface=project.surfaces.find(x=>norm(x.name)===norm(task.surface));const component=project.surfaces.flatMap(x=>x.components).find(x=>norm(x.name)===norm(task.component));const area=project.workAreas.find(x=>norm(x.name)===norm(task.area));const taskType=project.taskTypes.find(x=>norm(x.name)===norm(task.type));
 const rules=project.assignmentRules.filter(r=>r.active&&(!r.surfaceId||r.surfaceId===surface?.id)&&(!r.componentId||r.componentId===component?.id)&&(!r.areaId||r.areaId===area?.id)&&(!r.taskTypeId||r.taskTypeId===taskType?.id));
 if(rules.length){const specificity=(r:AssignmentRule)=>Number(!!r.surfaceId)+Number(!!r.componentId)+Number(!!r.areaId)+Number(!!r.taskTypeId);const preferred=rules.sort((a,b)=>specificity(b)-specificity(a)||a.position-b.position);const top=preferred.filter(r=>specificity(r)===specificity(preferred[0])&&r.position===preferred[0].position);const selected=top.map(r=>active.find(m=>m.id===r.memberId)).filter((x):x is ProjectMember=>!!x);return oneCandidate(selected,'rule',`explicit project assignment rule (${preferred[0].name||'rule'})`)}
 const responsibility=textMatch(active,task,'responsibilities');if(responsibility.length)return oneCandidate(responsibility,'responsibility','responsibility match');
 const skills=textMatch(active,task,'skills');if(skills.length)return oneCandidate(skills,'skill','skill match');
 const componentArea=active.filter(m=>(component&&m.componentIds.includes(component.id))||(area&&m.areaIds.includes(area.id)));if(componentArea.length)return oneCandidate(componentArea,'component-area','component/work-area match');
 if(task.assignmentEvidence==='recommendation'&&task.assignee){const matches=exactMembers(active,task.assignee);if(matches.length===1)return{assigneeId:matches[0].id,source:'ai-recommendation',needsReview:false,reason:`AI suggested ${matches[0].name}, who is an active project member.`};return{assigneeId:null,source:'unassigned',needsReview:true,reason:'AI suggestion does not identify exactly one active project member.'}}
 return{assigneeId:null,source:'unassigned',needsReview:true,reason:'No meeting assignment or project assignment match found.'};
}
