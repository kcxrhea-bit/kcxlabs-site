import { archiveRepository, createDb } from "../_lib/db";
import { internalError, isResponse, json, requireDevice, requireMethod, toNodeHandler } from "../_lib/http";
async function handler(request: Request): Promise<Response> {
  const method=requireMethod(request,"GET"); if(method)return method; const context=await requireDevice(request); if(isResponse(context))return context;
  try { const items=await archiveRepository(createDb(context.config.database)).pendingJobs(context.ownerId,new Date()); return json(200,{items}); } catch(error){return internalError(error,context.config);}
}

export default toNodeHandler(handler);
