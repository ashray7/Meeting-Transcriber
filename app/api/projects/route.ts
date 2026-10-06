import {NextRequest,NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {listProjects,saveProject} from '@/lib/store';
import {projectProfileInputSchema} from '@/lib/validation';

export const runtime='nodejs';
export async function GET(){return NextResponse.json(await listProjects())}
export async function POST(req:NextRequest){try{const parsed=projectProfileInputSchema.parse(await req.json());const now=new Date().toISOString();const profile=await saveProject({...parsed,id:randomUUID(),createdAt:now,updatedAt:now});return NextResponse.json(profile,{status:201})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid project profile.'},{status:400})}}
