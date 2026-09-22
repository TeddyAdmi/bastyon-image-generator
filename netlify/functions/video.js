import apiHandler from "../../api/video.js";
import { runVercelHandler } from "./_vercel-adapter.js";

export async function handler(event) {
  return runVercelHandler(apiHandler, event);
}

export default { handler };
