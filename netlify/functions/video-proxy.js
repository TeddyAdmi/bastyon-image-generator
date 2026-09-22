import apiHandler from "../../api/video-proxy.js";
import { runVercelHandler } from "./_vercel-adapter.js";

export async function handler(event) {
  return runVercelHandler(apiHandler, event);
}

export default { handler };
