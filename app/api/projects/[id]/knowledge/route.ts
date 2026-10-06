import {NextResponse} from 'next/server';
import {getProject,searchProjectKnowledge} from '@/lib/store';

export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Context){const {id}=await params;const project=await getProject(id);if(!project)return NextResponse.json({error:'Project profile not found.'},{status:404});const query=new URL(request.url).searchParams.get('q')||'';if(!query.trim())return NextResponse.json({error:'Provide a search query in q.'},{status:400});const results=await searchProjectKnowledge(id,query);return NextResponse.json({projectId:id,results})}
