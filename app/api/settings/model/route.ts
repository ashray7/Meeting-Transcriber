import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getSelectedModel,LOCAL_MODELS,setSelectedModel} from '@/lib/model-settings';
export const runtime='nodejs';
const schema=z.object({model:z.enum(LOCAL_MODELS.map(m=>m.id) as [string,...string[]])});
export async function GET(){return NextResponse.json({model:await getSelectedModel(),models:LOCAL_MODELS})}
export async function PUT(req:Request){try{const {model}=schema.parse(await req.json());await setSelectedModel(model as typeof LOCAL_MODELS[number]['id']);return NextResponse.json({model})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Invalid model selection.'},{status:400})}}
