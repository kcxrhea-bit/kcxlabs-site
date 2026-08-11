import { archiveRepository, createDb } from "../../_lib/db";
import { internalError, isResponse, json, readJson, requireDevice, requireMethod } from "../../_lib/http";
export default async function handler(request: Request): Promise<Response> {
 const method=requireMethod(request,"POST");if(method)return method;const context=await requireDevice(request);if(isResponse(context))return context;const body=await readJson(request);const reason=typeof body?.reason==="string"?body.reason.slice(0,500):"";const id=new URL(request.url).pathname.split("/").at(-2)??"";if(!id||!reason)return json(400,{error:"invalid_request"});
 try{await archiveRepository(createDb(context.config.database)).recordFailure({id,ownerId:context.ownerId,reason,state:"archive_failed"});return json(200,{recorded:true});}catch(error){return internalError(error,context.config);}
}
