import { InferenceClient } from "@huggingface/inference";
import { logger } from "../lib/logger";
import { aiProviderKeyPoolService } from "./ai-provider-key-pool.service";
import type { AIModelCatalogEntry } from "./ai-provider.types";

export type HuggingFaceMediaTask = "text-to-image" | "text-to-video";
export interface HuggingFaceMediaResult { buffer: Buffer; mimeType: string; model: string; provider: "huggingface"; task: HuggingFaceMediaTask; }
export interface HuggingFaceMediaTestResult { ok: boolean; provider: "huggingface"; model: string; task: HuggingFaceMediaTask; latencyMs: number; mimeType?: string; sizeBytes?: number; error?: string; }

function requireToken(token?: string): string { const value = token?.trim() || process.env.HF_TOKEN?.trim(); if (!value) throw new Error("Hugging Face API token is not configured. Add a Hugging Face token in Dashboard → AI Providers → API Keys or configure HF_TOKEN for bootstrap."); return value; }
async function resolveRuntimeTokens(): Promise<Array<{ id?: string; key: string }>> { try { await aiProviderKeyPoolService.hydrateProvider("huggingface", "HF_TOKEN"); } catch (error) { logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Unable to hydrate managed Hugging Face tokens; checking bootstrap token"); } const managed = aiProviderKeyPoolService.getOrderedKeys("huggingface"); if (managed.length) return managed.map((item) => ({ id: item.id, key: item.key })); const fallback = requireToken(); return [{ key: fallback }]; }
function detectImageMime(buffer: Buffer): string | undefined { if (buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "image/png"; if(buffer.length>=3&&buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))) return "image/jpeg"; if(buffer.length>=12&&buffer.toString("ascii",0,4)==="RIFF"&&buffer.toString("ascii",8,12)==="WEBP") return "image/webp"; if(buffer.length>=4&&buffer.subarray(0,4).equals(Buffer.from("GIF8"))) return "image/gif"; }
function detectVideoMime(buffer: Buffer): string | undefined { if(buffer.length>=12&&buffer.toString("ascii",4,8)==="ftyp") return "video/mp4"; if(buffer.length>=4&&buffer.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) return "video/webm"; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export class HuggingFaceMediaService {
  async validateToken(token:string): Promise<{ok:boolean;latencyMs:number;error?:string}> { const accessToken=requireToken(token); const started=Date.now(); try { const response=await fetch("https://huggingface.co/api/whoami-v2",{headers:{Authorization:`Bearer ${accessToken}`,Accept:"application/json"}}); if(!response.ok){const body=await response.text().catch(()=>""); return {ok:false,latencyMs:Date.now()-started,error:`Hugging Face token validation failed (${response.status})${body?`: ${body.slice(0,300)}`:""}`};} await response.json().catch(()=>undefined); return {ok:true,latencyMs:Date.now()-started}; } catch(error){ return {ok:false,latencyMs:Date.now()-started,error:errorMessage(error)}; } }

  async listModels(token?: string): Promise<AIModelCatalogEntry[]> {
    const accessToken=requireToken(token); const headers={Authorization:`Bearer ${accessToken}`,Accept:"application/json"};
    const tasks:Array<{tag:HuggingFaceMediaTask;capability:"image_generation"|"video_generation"}>=[{tag:"text-to-image",capability:"image_generation"},{tag:"text-to-video",capability:"video_generation"}];
    const entries=new Map<string,AIModelCatalogEntry>();
    for(const task of tasks){
      const url=new URL("https://huggingface.co/api/models"); url.searchParams.set("pipeline_tag",task.tag); url.searchParams.set("inference_provider","all"); url.searchParams.set("limit","200"); url.searchParams.set("sort","trendingScore"); url.searchParams.set("direction","-1");
      const response=await fetch(url,{headers}); if(!response.ok){const body=await response.text().catch(()=>"");throw new Error(`Hugging Face model catalog failed (${response.status})${body?`: ${body.slice(0,500)}`:""}`);}
      const rows:unknown=await response.json(); if(!Array.isArray(rows)) continue;
      for(const row of rows){ if(!row||typeof row!=="object") continue; const raw=row as Record<string,unknown>; const modelId=typeof raw.id==="string"?raw.id.trim():""; if(!modelId) continue; const existing=entries.get(modelId); entries.set(modelId,{provider:"huggingface",modelId,name:typeof raw.modelId==="string"&&raw.modelId.trim()?raw.modelId.trim():modelId,status:raw.disabled===true||raw.private===true?"inactive":"active",capabilities:[...new Set([...(existing?.capabilities||[]),task.tag,task.capability])],source:"provider_api"}); }
    }
    return [...entries.values()].filter(model=>model.status!=="inactive").sort((a,b)=>a.name.localeCompare(b.name));
  }

  private async resolveRegisteredModel(task:HuggingFaceMediaTask,requestedModel?:string):Promise<string>{
    const {unifiedModelRegistryService}=await import("./unified-model-registry.service"); const registered=await unifiedModelRegistryService.list(); const capability=task==="text-to-image"?"image_generation":"video_generation"; const exact=requestedModel?.trim();
    const candidates=registered.filter(model=>model.provider==="huggingface"&&model.enabled).filter(model=>model.capabilities.some(value=>value.toLowerCase()===capability||value.toLowerCase()===task));
    if(exact){const match=candidates.find(model=>model.modelId===exact);if(!match)throw new Error(`Hugging Face model ${exact} is not registered and enabled for ${task}`);return match.modelId;}
    const selected=candidates.sort((a,b)=>a.priority-b.priority||a.modelId.localeCompare(b.modelId))[0]; if(!selected)throw new Error(`No enabled Hugging Face model is registered for ${task}. Open the Model Registry and register a live ${task} model first.`); return selected.modelId;
  }

  private async executeImage(prompt:string,model:string,token:string,options:{width?:number;height?:number}={}):Promise<HuggingFaceMediaResult>{
    const client=new InferenceClient(token); const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),120_000);
    try{const parameters:Record<string,unknown>={}; if(Number.isFinite(options.width)) parameters.width=options.width; if(Number.isFinite(options.height)) parameters.height=options.height; const blob=await client.textToImage({model,inputs:prompt,provider:"auto",...(Object.keys(parameters).length?{parameters}: {})},{signal:controller.signal,retry_on_error:true}); const buffer=Buffer.from(await blob.arrayBuffer()); const mimeType=detectImageMime(buffer); if(!mimeType||buffer.length<2000) throw new Error("Hugging Face returned an invalid image payload"); return {buffer,mimeType,model,provider:"huggingface",task:"text-to-image"};} finally{clearTimeout(timeout);}
  }

  private async executeVideo(prompt:string,model:string,token:string):Promise<HuggingFaceMediaResult>{
    const client=new InferenceClient(token); const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),240_000);
    try{const blob=await client.textToVideo({model,inputs:prompt,provider:"auto"},{signal:controller.signal,retry_on_error:true}); const buffer=Buffer.from(await blob.arrayBuffer()); const mimeType=detectVideoMime(buffer); if(!mimeType||buffer.length<2000) throw new Error("Hugging Face returned an invalid video payload"); return {buffer,mimeType,model,provider:"huggingface",task:"text-to-video"};} finally{clearTimeout(timeout);}
  }

  async generateImage(prompt:string,options:{model?:string;width?:number;height?:number}={}):Promise<HuggingFaceMediaResult>{
    const model=await this.resolveRegisteredModel("text-to-image",options.model); const candidates=await resolveRuntimeTokens(); let lastError:unknown;
    for(const candidate of candidates){const started=Date.now(); try{const result=await this.executeImage(prompt,model,candidate.key,options); if(candidate.id) aiProviderKeyPoolService.recordSuccess(candidate.id,Date.now()-started); return result;}catch(error){lastError=error; if(candidate.id) aiProviderKeyPoolService.recordFailure(candidate.id,error); logger.warn({model,keyId:candidate.id,error:errorMessage(error)},"Hugging Face image candidate failed; trying next managed token");}}
    throw lastError instanceof Error?lastError:new Error("All configured Hugging Face image tokens failed");
  }

  async generateVideo(prompt:string,options:{model?:string}={}):Promise<HuggingFaceMediaResult>{
    const model=await this.resolveRegisteredModel("text-to-video",options.model); const candidates=await resolveRuntimeTokens(); let lastError:unknown;
    for(const candidate of candidates){const started=Date.now(); try{const result=await this.executeVideo(prompt,model,candidate.key); if(candidate.id) aiProviderKeyPoolService.recordSuccess(candidate.id,Date.now()-started); return result;}catch(error){lastError=error; if(candidate.id) aiProviderKeyPoolService.recordFailure(candidate.id,error); logger.warn({model,keyId:candidate.id,error:errorMessage(error)},"Hugging Face video candidate failed; trying next managed token");}}
    throw lastError instanceof Error?lastError:new Error("All configured Hugging Face video tokens failed");
  }

  async testModelWithKey(model:{modelId:string;capabilities:string[]},token:string):Promise<HuggingFaceMediaTestResult>{
    const caps=new Set(model.capabilities.map(value=>value.toLowerCase())); const task:HuggingFaceMediaTask|undefined=caps.has("video_generation")||caps.has("text-to-video")?"text-to-video":caps.has("image_generation")||caps.has("text-to-image")?"text-to-image":undefined; if(!task)throw new Error(`Registered Hugging Face model ${model.modelId} has no executable media capability`);
    const started=Date.now(); try{const result=task==="text-to-image"?await this.executeImage("production smoke test: a simple red apple on a clean white background",model.modelId,requireToken(token),{width:512,height:512}):await this.executeVideo("production smoke test: a red ball rolling slowly across a clean white floor",model.modelId,requireToken(token)); return {ok:true,provider:"huggingface",model:model.modelId,task,latencyMs:Date.now()-started,mimeType:result.mimeType,sizeBytes:result.buffer.length};}catch(error){logger.warn({model:model.modelId,task,error:errorMessage(error)},"Hugging Face media model smoke test failed");return {ok:false,provider:"huggingface",model:model.modelId,task,latencyMs:Date.now()-started,error:errorMessage(error)};}
  }

  async testModel(model:{modelId:string;capabilities:string[]}):Promise<HuggingFaceMediaTestResult>{ const candidates=await resolveRuntimeTokens(); const first=candidates[0]; return this.testModelWithKey(model,first.key); }
}
export const huggingFaceMediaService=new HuggingFaceMediaService();
