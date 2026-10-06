import {promises as fs} from 'node:fs';
import path from 'node:path';

export const LOCAL_MODELS = [
  {id:'qwen3:8b',label:'Qwen3 8B · Q4_K_M'},
  {id:'llama3.2:latest',label:'Llama 3.2'},
  {id:'qwen3.5:4b',label:'Qwen3.5 4B'},
  {id:'qwen3:1.7b',label:'Qwen3 1.7B'},
  {id:'gemma3:1b',label:'Gemma 3 1B'},
] as const;
export type LocalModel=typeof LOCAL_MODELS[number]['id'];
const configPath=path.join(process.cwd(),'data','settings.json');
const fallbackModel=():LocalModel=>{const env=process.env.OLLAMA_MODEL;return (LOCAL_MODELS.some(m=>m.id===env)?env:'qwen3:8b') as LocalModel};
export async function getSelectedModel():Promise<LocalModel>{
  try{const saved=JSON.parse(await fs.readFile(configPath,'utf8')).model as string;if(LOCAL_MODELS.some(m=>m.id===saved))return saved as LocalModel}catch(error){if(error instanceof Error)return fallbackModel()}
  return fallbackModel();
}
export async function setSelectedModel(model:LocalModel){await fs.mkdir(path.dirname(configPath),{recursive:true});const tmp=configPath+'.tmp';await fs.writeFile(tmp,JSON.stringify({model},null,2));await fs.rename(tmp,configPath)}
