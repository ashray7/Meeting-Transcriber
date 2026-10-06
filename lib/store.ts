import {promises as fs} from 'node:fs';import path from 'node:path';import {Meeting,ProjectProfile,Task} from './types';
const root=process.cwd(), file=path.join(root,'data','store.json');
type DB={meetings:Meeting[];tasks:Task[]};
async function read():Promise<DB>{try{const db=JSON.parse(await fs.readFile(file,'utf8')) as DB;db.meetings=db.meetings.map(m=>({...m,inputType:m.inputType||'recording',diagnostic:m.diagnostic??null,projectId:m.projectId??null,projectSnapshot:m.projectSnapshot??null}));db.tasks=(db.tasks||[]).map(t=>({...t,deadline:t.deadline??null,context:t.context??'',sourceTimestamp:t.sourceTimestamp??null,surface:t.surface??null,area:t.area??null,projectReferences:t.projectReferences??[]}));return db}catch{return{meetings:[],tasks:[]}}}
async function write(db:DB){await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.tmp';await fs.writeFile(tmp,JSON.stringify(db,null,2));await fs.rename(tmp,file)}
export async function listMeetings(){return (await read()).meetings.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
export async function getMeeting(id:string){const db=await read();return{meeting:db.meetings.find(m=>m.id===id)??null,tasks:db.tasks.filter(t=>t.meetingId===id)}}
export async function saveMeeting(m:Meeting){const db=await read();const i=db.meetings.findIndex(x=>x.id===m.id);if(i<0)db.meetings.push(m);else db.meetings[i]=m;await write(db);return m}
export async function addTasks(tasks:Task[]){const db=await read();db.tasks.push(...tasks);await write(db)}
export async function saveTask(task:Task){const db=await read();const i=db.tasks.findIndex(t=>t.id===task.id);if(i<0)db.tasks.push(task);else db.tasks[i]=task;await write(db);return task}
export async function deleteTask(id:string){const db=await read();db.tasks=db.tasks.filter(t=>t.id!==id);await write(db)}
export async function getTask(id:string){return (await read()).tasks.find(t=>t.id===id)??null}

const projectsFile=path.join(root,'data','projects.json');
async function readProjects():Promise<ProjectProfile[]>{try{return JSON.parse(await fs.readFile(projectsFile,'utf8')) as ProjectProfile[]}catch{return[]}}
async function writeProjects(projects:ProjectProfile[]){await fs.mkdir(path.dirname(projectsFile),{recursive:true});const tmp=projectsFile+'.tmp';await fs.writeFile(tmp,JSON.stringify(projects,null,2));await fs.rename(tmp,projectsFile)}
export async function listProjects(){return (await readProjects()).sort((a,b)=>a.name.localeCompare(b.name))}
export async function getProject(id:string){return (await readProjects()).find(p=>p.id===id)??null}
export async function saveProject(project:ProjectProfile){const projects=await readProjects();const i=projects.findIndex(p=>p.id===project.id);if(i<0)projects.push(project);else projects[i]=project;await writeProjects(projects);return project}
export async function deleteProject(id:string){await writeProjects((await readProjects()).filter(p=>p.id!==id))}
