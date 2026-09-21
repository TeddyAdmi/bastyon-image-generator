function isHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

async function fetchImageAsDataUrl(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Miya-AI/1.0" } });
  if (!r.ok) throw new Error("Не удалось получить изображение: HTTP " + r.status);
  const type=(r.headers.get("content-type")||"image/jpeg").split(";")[0];
  if(!type.startsWith("image/")) throw new Error("URL не вернул изображение.");
  const bytes=Buffer.from(await r.arrayBuffer());
  if(bytes.length>3_500_000) throw new Error("Исходное изображение больше лимита 3.5 MB.");
  return "data:"+type+";base64,"+bytes.toString("base64");
}

function bodyOf(req) {
  if(req.body && typeof req.body === "object") return req.body;
  if(typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch {}
  }
  return {};
}

async function ltx(path, options={}) {
  const base=String(process.env.LTX_SERVER_URL||"").replace(/\/$/,"");
  if(!base) throw new Error("LTX_SERVER_URL не настроен.");
  const r=await fetch(base+path,{
    ...options,
    headers:{"Content-Type":"application/json",...(options.headers||{})}
  });
  const text=await r.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch{throw new Error("LTX GPU сервер вернул не JSON (HTTP "+r.status+").");}
  if(!r.ok) throw new Error(typeof data.error==="string"?data.error:(data.message||JSON.stringify(data.error||data)));
  return data;
}

async function pixelSterVideo(imageBase64, imageUrl, prompt, ratio, duration) {
  let image=imageBase64;
  if(!image && isHttpUrl(imageUrl)) image=await fetchImageAsDataUrl(imageUrl);
  if(!image || !image.startsWith("data:image/")) throw new Error("Исходное изображение не найдено.");

  // PixelSter documents imageBase64 as the input for /api/ptv.
  const r=await fetch("https://ahm7xmakki.com/api/ptv",{
    method:"POST",
    headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({
      prompt,
      ratio:ratio==="9:16"||ratio==="16:9"?ratio:"16:9",
      duration:5,
      imageBase64:image
    })
  });

  const text=await r.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch{
    throw new Error("PixelSter видео вернул не JSON (HTTP "+r.status+").");
  }

  if(!r.ok) {
    const reason=data.error||data.message||data.detail||("HTTP "+r.status);
    throw new Error("PixelSter: "+(typeof reason==="string"?reason:JSON.stringify(reason)));
  }
  if(!data.videoUrl) throw new Error("PixelSter не вернул videoUrl.");
  return data;
}

export default async function handler(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");

  try {
    const body=bodyOf(req);

    if(req.method==="GET"){
      const taskId=String(req.query?.taskId||"");

      if(!taskId) return res.status(400).json({success:false,error:"Не указан taskId."});

      if(taskId.startsWith("ltx:")){
        const data=await ltx("/jobs/"+encodeURIComponent(taskId.slice(4)));
        if(data.done && data.success && data.videoUrl)
          return res.status(200).json({success:true,done:true,status:"SUCCEEDED",videoUrl:data.videoUrl,provider:"LTX-Video GPU",model:data.model||"ltxv-2b-0.9.8-distilled"});
        if(data.done)
          return res.status(200).json({success:false,done:true,status:"FAILED",error:data.error||"LTX не создал видео."});
        return res.status(200).json({success:true,done:false,status:data.status||"RUNNING",provider:"LTX-Video GPU",model:data.model||"ltxv-2b-0.9.8-distilled"});
      }

      return res.status(400).json({success:false,error:"Неизвестный taskId."});
    }

    if(req.method!=="POST") return res.status(405).json({success:false,error:"Method not allowed"});

    const prompt=String(body.prompt||"").trim();
    const imageBase64=String(body.imageBase64||"").trim();
    const imageUrl=String(body.imageUrl||"").trim();
    const ratio=String(body.aspect||"16:9");
    const duration=5;

    if(!prompt) return res.status(400).json({success:false,error:"Введите промпт для видео."});
    if(!imageBase64 && !imageUrl) return res.status(400).json({success:false,error:"Исходное изображение не загружено."});

    // Dedicated GPU is used when available.
    if(process.env.LTX_SERVER_URL){
      try{
        const source=imageBase64 || await fetchImageAsDataUrl(imageUrl);
        const data=await ltx("/generate",{
          method:"POST",
          body:JSON.stringify({imageBase64:source,prompt,seed:null})
        });
        if(data.jobId){
          return res.status(202).json({success:true,done:false,taskId:"ltx:"+data.jobId,status:data.status||"queued",provider:"LTX-Video GPU",model:data.model||"ltxv-2b-0.9.8-distilled",duration:data.duration||5});
        }
        throw new Error("LTX не вернул jobId.");
      }catch(error){
        console.error("LTX failed, using PixelSter fallback:",error);
      }
    }

    // Free public fallback: direct image-to-video.
    const data=await pixelSterVideo(imageBase64,imageUrl,prompt,ratio,duration);
    return res.status(200).json({
      success:true,
      done:true,
      status:"SUCCEEDED",
      videoUrl:data.videoUrl,
      provider:"PixelSter",
      model:"Motion Synthesis",
      duration:data.duration||duration
    });

  } catch(error) {
    console.error("Video API error:",error);
    return res.status(500).json({
      success:false,
      error:message(error)
    });
  }
}

function message(error){
  if(!error) return "Ошибка видеогенерации.";
  if(typeof error==="string") return error;
  if(typeof error.message==="string") return error.message;
  if(typeof error.error==="string") return error.error;
  try{return JSON.stringify(error);}catch{return String(error);}
}
