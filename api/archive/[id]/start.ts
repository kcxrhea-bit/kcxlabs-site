import { archiveRepository, createDb } from "../../_lib/db";
import { internalError, isResponse, json, requestUrl, requireDevice, requireMethod, toNodeHandler } from "../../_lib/http";
async function handler(request: Request): Promise<Response> {
  const method=requireMethod(request,"POST"); if(method)return method; const context=await requireDevice(request); if(isResponse(context))return context;
  const id=requestUrl(request).pathname.split("/").at(-2)??""; if(!id)return json(400,{error:"invalid_request"});
  try { const item=await archiveRepository(createDb(context.config.database)).transition({id,ownerId:context.ownerId,expectedFrom:["active","archive_eligible","archive_failed"],to:"archive_downloading"}); return item?json(200,{item}):json(409,{error:"invalid_state"}); }catch(error){return internalError(error,context.config);}
}

export default toNodeHandler(handler);
