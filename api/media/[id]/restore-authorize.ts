import { archiveRepository, createDb, mediaRepository } from "../../_lib/db";
import { currentStorageBudget } from "../../_lib/budget";
import { internalError, isResponse, json, readJson, requestUrl, requireDevice, requireMethod, toNodeHandler } from "../../_lib/http";
import { presignUpload, r2Context } from "../../_lib/r2";
import { evaluateRestoreEligibility } from "../../../src/media/restore";
async function handler(request:Request):Promise<Response>{
 const method=requireMethod(request,"POST");if(method)return method;const context=await requireDevice(request);if(isResponse(context))return context;const body=await readJson(request);const id=(requestUrl(request).pathname.split("/").slice(-2)[0]??"");const sizeBytes=typeof body?.sizeBytes==="number"?body.sizeBytes:NaN;const sha256=typeof body?.sha256==="string"?body.sha256.toLowerCase():"";if(!id||!Number.isSafeInteger(sizeBytes)||!/^[0-9a-f]{64}$/.test(sha256))return json(400,{error:"invalid_request"});
 try{const db=createDb(context.config.database);const media=await mediaRepository(db).byId(context.ownerId,id);if(!media)return json(404,{error:"not_found"});const archives=archiveRepository(db);const manifest=await archives.manifestEntry(id);const budget=await currentStorageBudget(db,context.config,context.ownerId,media.sizeBytes);const eligibility=evaluateRestoreEligibility({media,manifestEntry:manifest,probe:{exists:body?.exists===true,readable:body?.readable===true,sizeBytes,sha256},budget});if(eligibility.allowed === false)return json(409,{error:eligibility.reason,message:eligibility.message});const authorization=await presignUpload(r2Context(context.config.r2),{key:media.storageObjectKey,contentType:media.mimeType,sizeBytes:media.sizeBytes,sha256:media.sha256});const transitioned=await archives.transition({id,ownerId:context.ownerId,expectedFrom:["archived_offline","restore_requested","restore_failed"],to:"restoring"});if(!transitioned)return json(409,{error:"invalid_state"});return json(200,{mediaId:id,publicId:media.publicId,authorization});
 }catch(error){return internalError(error,context.config);}
}

export default toNodeHandler(handler);
