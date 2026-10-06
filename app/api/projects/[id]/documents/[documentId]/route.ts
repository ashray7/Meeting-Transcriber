import {NextResponse} from 'next/server';
import {deleteProjectDocument,getProject} from '@/lib/store';

export const runtime='nodejs';
type Context={params:Promise<{id:string;documentId:string}>};
export async function DELETE(_:Request,{params}:Context){const {id,documentId}=await params;if(!await getProject(id))return NextResponse.json({error:'Project profile not found.'},{status:404});await deleteProjectDocument(id,documentId);return NextResponse.json({ok:true})}
