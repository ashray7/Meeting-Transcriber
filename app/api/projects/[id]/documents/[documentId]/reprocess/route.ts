import {NextResponse} from 'next/server';
import {getProject,reprocessProjectDocument} from '@/lib/store';

export const runtime='nodejs';
type Context={params:Promise<{id:string;documentId:string}>};
export async function POST(_:Request,{params}:Context){const {id,documentId}=await params;if(!await getProject(id))return NextResponse.json({error:'Project profile not found.'},{status:404});try{return NextResponse.json(await reprocessProjectDocument(id,documentId))}catch(error){const document=(await getProject(id))?.documents.find(item=>item.id===documentId);return NextResponse.json({error:error instanceof Error?error.message:'Document reprocessing failed.',document},{status:422})}}
