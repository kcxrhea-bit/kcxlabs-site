import { archiveRepository, createDb, mediaRepository } from "../../_lib/db";
import { internalError, isResponse, json, requestUrl, requireDevice, requireMethod, toNodeHandler } from "../../_lib/http";
import { headObject, r2Context } from "../../_lib/r2";
async function handler(request:Request):Promise<Response>{
 const method=requireMethod(request,"POST");if(method)return method;const context=await requireDevice(request);if(isResponse(context))return context;const id=requestUrl(request).pathname.split("/").at(-2)??"";if(!id)return json(400,{error:"invalid_request"});
 try{const db=createDb(context.config.database);const media=await mediaRepository(db).byId(context.ownerId,id);if(!media)return json(404,{error:"not_found"});const shareUrl=`${context.config.publicSiteOrigin}/c/${media.publicId}`;if(media.archiveState==="active"&&media.originalOnline)return json(200,{item:media,shareUrl,idempotent:true});if(media.archiveState!=="restoring")return json(409,{error:"invalid_state"});const head=await headObject(r2Context(context.config.r2),media.storageObjectKey);if(!head.exists)return json(409,{error:"object_missing"});if(head.sizeBytes!==media.sizeBytes)return json(409,{error:"size_mismatch"});if(head.sha256!==media.sha256.toLowerCase())return json(409,{error:"hash_mismatch"});const restored=await archiveRepository(db).markRestored({id,ownerId:context.ownerId});return restored?json(200,{item:restored,shareUrl,idempotent:false}):json(409,{error:"invalid_state"});
 }catch(error){return internalError(error,context.config);}
}

export default toNodeHandler(handler);
