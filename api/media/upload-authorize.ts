import { createDb, mediaRepository } from "../_lib/db";
import { currentStorageBudget } from "../_lib/budget";
import { internalError, isResponse, json, readJson, requireDevice, requireMethod } from "../_lib/http";
import { generateMediaId, generatePublicId } from "../_lib/ids";
import { presignUpload, r2Context } from "../_lib/r2";
import { resolveContentType, validateUploadRequest } from "../../src/media/content";
import { buildStorageKey, extractExtension, parseClipFilename, suggestTitle } from "../../src/media/filenames";
import { defaultMediaVisibility, mediaVisibilityValues, normalizeRetentionDays, type MediaVisibility } from "../../src/media/types";

export default async function handler(request: Request): Promise<Response> {
  const method=requireMethod(request,"POST");if(method)return method;const context=await requireDevice(request);if(isResponse(context))return context;const body=await readJson(request);
  const filename=typeof body?.filename==="string"?body.filename:"";const sizeBytes=typeof body?.sizeBytes==="number"?body.sizeBytes:NaN;const sha256=typeof body?.sha256==="string"?body.sha256.toLowerCase():"";
  const validation=validateUploadRequest({filename,sizeBytes,sha256,maxUploadBytes:context.config.limits.maxUploadBytes});if(!validation.ok)return json(400,{error:"invalid_request",reason:validation.reason});
  const visibility: MediaVisibility=typeof body?.visibility==="string"&&mediaVisibilityValues.includes(body.visibility as MediaVisibility)?body.visibility as MediaVisibility:defaultMediaVisibility;const autoUpload=body?.autoUpload===true;
  try{const db=createDb(context.config.database);const repo=mediaRepository(db);const duplicate=await repo.byHash(context.ownerId,sha256);if(duplicate)return json(200,{duplicate:true,mediaId:duplicate.id,publicId:duplicate.publicId,shareUrl:`${context.config.publicSiteOrigin}/c/${duplicate.publicId}`});
    const budget=await currentStorageBudget(db,context.config,context.ownerId,sizeBytes);if(!budget.uploadAllowed||(autoUpload&&!budget.autoUploadAllowed))return json(409,{error:"storage_budget",status:budget.status,reason:autoUpload?budget.autoUploadPausedReason:budget.reason});
    const publicId=generatePublicId();const id=generateMediaId();const extension=extractExtension(filename);const content=resolveContentType({extension,declaredMimeType:typeof body?.mimeType==="string"?body.mimeType:null,head:null});const parsed=parseClipFilename(filename);const key=buildStorageKey(context.ownerId,publicId,filename);const authorization=await presignUpload(r2Context(context.config.r2),{key,contentType:content.mimeType,sizeBytes,sha256});
    const item=await repo.createPending({id,publicId,ownerId:context.ownerId,originalFilename:filename,extension,mimeType:content.mimeType,kind:content.kind,sizeBytes,sha256,storageObjectKey:key,title:typeof body?.title==="string"?body.title.slice(0,500):suggestTitle(filename,parsed),visibility,retentionDays:normalizeRetentionDays(body?.retentionDays),keepOnline:body?.keepOnline===true,game:parsed.game,eventType:parsed.eventType,recordedAt:parsed.recordedAt,uploadId:null});
    return json(201,{duplicate:false,mediaId:item.id,publicId:item.publicId,authorization,budget:{status:budget.status,warning:budget.manualUploadWarning}});
  }catch(error){return internalError(error,context.config);}
}
