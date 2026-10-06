import {NextRequest,NextResponse} from 'next/server';
import {deleteProject,getProject,saveProject} from '@/lib/store';
import {projectProfileInputSchema} from '@/lib/validation';

export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(_:Request,{params}:Context){const {id}=await params;const profile=await getProject(id);return profile?NextResponse.json(profile):NextResponse.json({error:'Project profile not found.'},{status:404})}
export async function PUT(req:NextRequest,{params}:Context){const {id}=await params;const current=await getProject(id);if(!current)return NextResponse.json({error:'Project profile not found.'},{status:404});try{const parsed=projectProfileInputSchema.parse(await req.json());const profile=await saveProject({...parsed,id,createdAt:current.createdAt,updatedAt:new Date().toISOString()});return NextResponse.json(profile)}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid project profile.'},{status:400})}}
export async function DELETE(_:Request,{params}:Context){const {id}=await params;const current=await getProject(id);if(!current)return NextResponse.json({error:'Project profile not found.'},{status:404});await deleteProject(id);return NextResponse.json({ok:true})}
