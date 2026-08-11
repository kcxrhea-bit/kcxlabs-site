import { createDb, mediaRepository } from "../_lib/db";
import { internalError, isResponse, json, readJson, requireDevice } from "../_lib/http";
import { normalizeRetentionDays, type MediaVisibility } from "../../src/media/types";

const mutable = new Set(["title","description","tags","game","eventType","visibility","retentionDays","keepOnline","favorite","featured"]);
export default async function handler(request: Request): Promise<Response> {
 const context=await requireDevice(request);if(isResponse(context))return context;const id=new URL(request.url).pathname.split("/").pop()??"";if(!id)return json(400,{error:"invalid_request"});const repo=mediaRepository(createDb(context.config.database));
 try { if(request.method==="GET"){const item=await repo.byId(context.ownerId,id);return item?json(200,{item}):json(404,{error:"not_found"});}
 if(request.method==="DELETE"){return await repo.softDelete(context.ownerId,id)?json(204,{}):json(404,{error:"not_found"});}
 if(request.method!=="PATCH")return json(405,{error:"method_not_allowed"},{Allow:"GET, PATCH, DELETE"});const body=await readJson(request);if(!body||Object.keys(body).some(k=>!mutable.has(k)))return json(400,{error:"invalid_request"});
 const visibility=body.visibility; if(visibility!==undefined&&visibility!=="private"&&visibility!=="unlisted"&&visibility!=="public")return json(400,{error:"invalid_request"});if(body.tags!==undefined&&(!Array.isArray(body.tags)||body.tags.some(x=>typeof x!=="string")))return json(400,{error:"invalid_request"});
 const item=await repo.updateMetadata({id,ownerId:context.ownerId,title:typeof body.title==="string"?body.title.slice(0,500):undefined,description:typeof body.description==="string"||body.description===null?body.description:undefined,tags:Array.isArray(body.tags)?body.tags.map(String).slice(0,50):undefined,game:typeof body.game==="string"||body.game===null?body.game:undefined,eventType:typeof body.eventType==="string"||body.eventType===null?body.eventType:undefined,visibility:visibility as MediaVisibility|undefined,retentionDays:body.retentionDays===undefined?undefined:normalizeRetentionDays(body.retentionDays),keepOnline:typeof body.keepOnline==="boolean"?body.keepOnline:undefined,favorite:typeof body.favorite==="boolean"?body.favorite:undefined,featured:typeof body.featured==="boolean"?body.featured:undefined});return item?json(200,{item}):json(404,{error:"not_found"});
 }catch(error){return internalError(error,context.config);}
}
