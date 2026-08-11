import { createDb, mediaRepository } from "../_lib/db";
import { internalError, isResponse, json, readJson, requireDevice, requireMethod } from "../_lib/http";
import { headObject, r2Context } from "../_lib/r2";
import { calculateArchiveEligibleAt } from "../../src/media/retention";
export default async function handler(request: Request): Promise<Response>{
 const method=requireMethod(request,"POST");if(method)return method;const context=await requireDevice(request);if(isResponse(context))return context;const body=await readJson(request);const id=typeof body?.mediaId==="string"?body.mediaId:"";if(!id)return json(400,{error:"invalid_request"});
 try{const repo=mediaRepository(createDb(context.config.database));const item=await repo.byId(context.ownerId,id);if(!item)return json(404,{error:"not_found"});const shareUrl=`${context.config.publicSiteOrigin}/c/${item.publicId}`;if(item.status==="active"&&item.originalOnline)return json(200,{item,shareUrl,idempotent:true});
 const head=await headObject(r2Context(context.config.r2),item.storageObjectKey);if(!head.exists)return json(409,{error:"object_missing"});if(head.sizeBytes!==item.sizeBytes)return json(409,{error:"size_mismatch"});if(head.sha256!==item.sha256.toLowerCase())return json(409,{error:"hash_mismatch"});const uploadedAt=new Date().toISOString();const archiveEligibleAt=calculateArchiveEligibleAt({uploadedAt,retentionDays:item.retentionDays,keepOnline:item.keepOnline,archiveState:item.archiveState,localArchiveVerified:item.localArchiveVerified,visibility:item.visibility});
 const finalized=await repo.finalize({id,ownerId:context.ownerId,sizeBytes:item.sizeBytes,archiveEligibleAt,thumbnailKey:null,thumbnailSizeBytes:0,durationSeconds:null,width:null,height:null,codec:null});return finalized?json(200,{item:finalized,shareUrl,idempotent:false}):json(409,{error:"finalize_failed"});
 }catch(error){return internalError(error,context.config);}
}
