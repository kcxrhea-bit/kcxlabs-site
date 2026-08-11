import { archiveRepository, createDb, mediaRepository } from "../../_lib/db";
import { internalError, isResponse, json, readJson, requestUrl, requireDevice, requireMethod, toNodeHandler } from "../../_lib/http";
import { verifyArchiveCopy } from "../../../src/media/retention";
async function handler(request: Request): Promise<Response>{
 const method=requireMethod(request,"POST");if(method)return method;const context=await requireDevice(request);if(isResponse(context))return context;const body=await readJson(request);const id=(requestUrl(request).pathname.split("/").slice(-2)[0]??"");const localPath=typeof body?.localPath==="string"?body.localPath.trim():"";const sizeBytes=typeof body?.sizeBytes==="number"?body.sizeBytes:NaN;const sha256=typeof body?.sha256==="string"?body.sha256.toLowerCase():"";if(!id||!localPath||body?.verified!==true)return json(400,{error:"verification_required"});
 try{const db=createDb(context.config.database);const item=await mediaRepository(db).byId(context.ownerId,id);if(!item)return json(404,{error:"not_found"});if(item.archiveState!=="archive_downloading")return json(409,{error:"invalid_state"});const verification=verifyArchiveCopy({sizeBytes:item.sizeBytes,sha256:item.sha256},{sizeBytes,sha256});if(!verification.verified)return json(409,{error:"verification_failed",reason:verification.reason});const completed=await archiveRepository(db).confirmVerifiedArchive({id,ownerId:context.ownerId,localPath,sizeBytes,sha256,publicId:item.publicId});return completed?json(200,{item:completed}):json(409,{error:"invalid_state"});
 }catch(error){return internalError(error,context.config);}
}

export default toNodeHandler(handler);
