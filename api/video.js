const LIGHTNING_SPACE = "https://saravutw-wan2-2-i2v-lightning-4-8step-custom.hf.space";
const LIGHTNING_INFO = LIGHTNING_SPACE + "/gradio_api/info";
const PIXELSTER = "https://ahm7xmakki.com/api";

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

function authHeaders(){
  const token=String(process.env.HF_TOKEN||"").trim();
  return token?{Authorization:"Bearer "+token}:{};
}
async function fetchJson(url,options={}){
  const r=await fetch(url,{...options,headers:{...authHeaders(),...(options.headers||{})}});
  const t=await r.text(); let d={}; try{d=t?JSON.parse(t):{}}catch{}
  if(!r.ok)throw new Error("HTTP "+r.status+": "+(d.error||d.message||t).slice(0,800));
  return d;
}
function isUrl(v){try{const u=new URL(String(v||""));return /^https?:$/.test(u.protocol)}catch{return false}}
async function normalizeImage(base,url){
  if(String(base||"").startsWith("data:image/"))return String(base);
  if(!isUrl(url))throw new Error("Исходное изображение не найдено.");
  const r=await fetch(url); if(!r.ok)throw new Error("Не удалось получить изображение: HTTP "+r.status);
  const mime=(r.headers.get("content-type")||"image/jpeg").split(";")[0];
  const b=Buffer.from(await r.arrayBuffer());
  return "data:"+mime+";base64,"+b.toString("base64");
}
async function uploadImage(dataUrl){
  const i=dataUrl.indexOf(","); if(i<0)throw new Error("Некорректное изображение.");
  const mime=dataUrl.slice(5,i).split(";")[0]||"image/jpeg";
  const bytes=Buffer.from(dataUrl.slice(i+1),"base64");
  const form=new FormData();
  form.append("files",new Blob([bytes],{type:mime}),"miya-video.jpg");
  const r=await fetch(LIGHTNING_SPACE+"/gradio_api/upload",{method:"POST",headers:authHeaders(),body:form});
  const t=await r.text(); let d; try{d=JSON.parse(t)}catch{d=null}
  if(!r.ok)throw new Error("Lightning upload HTTP "+r.status+": "+t.slice(0,500));
  const path=Array.isArray(d)?d[0]:d?.path;
  if(!path)throw new Error("Lightning upload не вернул файл.");
  return path;
}
function taskIdFor(x){return Buffer.from(JSON.stringify(x)).toString("base64url")}
function taskFromId(x){try{return JSON.parse(Buffer.from(String(x),"base64url").toString("utf8"))}catch{throw new Error("Некорректный taskId.")}}
function buildPrompt(p){
  return [
    "Preserve the identity, appearance, clothing, proportions and main objects from the input image.",
    "Scene and action: "+String(p||"").replace(/\s+/g," ").trim()+".",
    "Make one clear primary physical action continuous and visible from the first moment to the final beat.",
    "Natural body mechanics, stable anatomy, consistent lighting and realistic materials.",
    "Use subtle cinematic camera movement while keeping the subject recognizable.",
    "Photorealistic cinematic motion, no text, no watermark."
  ].join(" ");
}
function findEndpoint(info){
  const names=Object.keys(info?.named_endpoints||info?.endpoints||{});
  return (names.find(x=>/generate_video/i.test(x))||names.find(x=>/generate.*video|video.*generate/i.test(x))||"generate_video").replace(/^\//,"");
}
function extractVideo(v){
  if(!v)return null;
  if(typeof v==="string"){
    if(/\.mp4(?:$|\?)/i.test(v)||/file=/i.test(v))return v;
    return null;
  }
  if(Array.isArray(v)){for(const x of v){const z=extractVideo(x);if(z)return z}return null}
  if(typeof v==="object"){for(const k of ["video","url","path","videoUrl","output","result","data"]){const z=extractVideo(v[k]);if(z)return z}}
  return null;
}
function fileUrl(v){
  if(/^https?:\/\//i.test(v))return v;
  return LIGHTNING_SPACE+"/gradio_api/file="+String(v).replace(/^\//,"");
}
async function startTask(prompt,duration,image){
  const info=await fetchJson(LIGHTNING_INFO,{headers:{Accept:"application/json"}});
  const endpoint=findEndpoint(info);
  const imagePath=await uploadImage(image);
  const seconds=Math.min(5,Math.max(3,Number(duration)||3));
  const data=[
    {path:imagePath,meta:{_type:"gradio.FileData"},orig_name:"miya-video.jpg"},
    null,
    buildPrompt(prompt),
    4,
    "static, frozen, blurry, low quality, distorted, deformed, extra limbs, identity change, scene change, camera teleportation, text, watermark",
    seconds,
    1,
    1,
    Math.floor(Math.random()*2147483647),
    true,
    5,
    "UniPCMultistep",
    3,
    16,
    false,
    true
  ];
  const r=await fetch(LIGHTNING_SPACE+"/gradio_api/call/"+endpoint,{
    method:"POST",headers:{"Content-Type":"application/json",...authHeaders()},
    body:JSON.stringify({data})
  });
  const t=await r.text();let d={};try{d=JSON.parse(t)}catch{}
  if(!r.ok||!d.event_id)throw new Error("Lightning start HTTP "+r.status+": "+(d.error||t).slice(0,800));
  return {taskId:taskIdFor({v:4,provider:"lightning",space:LIGHTNING_SPACE,endpoint,eventId:d.event_id,model:"wan22-lightning",duration:seconds})};
}
async function pollTask(task,timeout=10000){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);
  try{
    const r=await fetch(task.space+"/gradio_api/call/"+task.endpoint+"/"+encodeURIComponent(task.eventId),{headers:{...authHeaders(),Accept:"text/event-stream"},signal:c.signal});
    if(r.status===404)return {done:false,status:"QUEUED"};
    if(!r.ok)throw new Error("Lightning poll HTTP "+r.status+": "+(await r.text()).slice(0,500));
    const reader=r.body.getReader(),dec=new TextDecoder();let buf="",event="";
    while(true){
      const q=await reader.read(); if(q.done)break;
      buf+=dec.decode(q.value,{stream:true});
      const parts=buf.split(/\r?\n\r?\n/);buf=parts.pop()||"";
      for(const part of parts){
        let raw="";
        for(const line of part.split(/\r?\n/)){
          if(line.startsWith("event:"))event=line.slice(6).trim();
          if(line.startsWith("data:"))raw+=line.slice(5).trim();
        }
        let d=null;try{d=raw?JSON.parse(raw):null}catch{}
        if(event==="error"||event==="unexpected_error"){
          return {done:true,success:false,error:typeof d==="string"?d:(d?.error||d?.message||"Lightning error")};
        }
        const u=extractVideo(d);
        if(u)return {done:true,success:true,videoUrl:fileUrl(u)};
      }
    }
    return {done:false,status:"RUNNING"};
  }catch(e){if(e?.name==="AbortError")return {done:false,status:"RUNNING"};throw e}
  finally{clearTimeout(timer)}
}
async function pixelster(prompt,image,ratio,duration){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),25000);
  try{
    const r=await fetch(PIXELSTER+"/ptv",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,ratio,duration,imageBase64:image}),signal:c.signal});
    const t=await r.text();let d={};try{d=JSON.parse(t)}catch{}
    if(!r.ok||!d.videoUrl)throw new Error(d.error||d.message||"PixelSter error");
    return d.videoUrl;
  }finally{clearTimeout(timer)}
}
export default async function handler(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  try{
    if(req.method==="GET"){
      if(String(req.query?.health||"")==="1"){
        const info=await fetchJson(LIGHTNING_INFO,{headers:{Accept:"application/json"}});
        return res.status(200).json({success:true,provider:"Hugging Face ZeroGPU",model:"Wan 2.2 I2V Lightning · 4 steps",space:LIGHTNING_SPACE,endpoint:findEndpoint(info),free:true});
      }
      const id=String(req.query?.taskId||""); if(!id)return res.status(400).json({error:"Нужен taskId."});
      const task=taskFromId(id);
      if(task.v!==4)throw new Error("Задача создана старой версией видео API. Запустите видео заново.");
      const s=await pollTask(task,10000);
      if(!s.done)return res.status(200).json({success:true,done:false,status:s.status||"RUNNING",provider:"Hugging Face ZeroGPU",model:"Wan 2.2 I2V Lightning · 4 steps",taskId:id});
      if(!s.success)return res.status(200).json({success:false,done:true,status:"ERROR",error:s.error||"Lightning завершил задачу с ошибкой.",taskId:id});
      return res.status(200).json({success:true,done:true,status:"COMPLETED",videoUrl:s.videoUrl,provider:"Hugging Face ZeroGPU",model:"Wan 2.2 I2V Lightning · 4 steps",audioAttached:false,taskId:id});
    }
    if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
    let b=req.body||{};if(typeof b==="string")b=JSON.parse(b);
    const prompt=String(b.prompt||"").trim();if(!prompt)return res.status(400).json({error:"Введите сценарий движения."});
    const image=await normalizeImage(b.imageBase64,b.imageUrl);
    const model=String(b.model||"wan22");
    const duration=Math.min(5,Math.max(3,Number(b.duration)||3));
    if(model==="pixelster-motion"){
      const u=await pixelster(prompt,image,b.aspect||"9:16",Math.max(5,duration));
      return res.status(200).json({success:true,done:true,videoUrl:u,provider:"AHM7 PixelSter",model:"Motion synthesis",audioAttached:false});
    }
    if(model!=="wan22")return res.status(501).json({success:false,error:"В этой версии Miya AI основной видеомаршрут — Wan 2.2 I2V Lightning · 4 steps.",code:"VIDEO_MODEL_DISABLED"});
    const task=await startTask(prompt,duration,image);
    return res.status(202).json({success:true,done:false,taskId:task.taskId,status:"QUEUED",provider:"Hugging Face ZeroGPU",model:"Wan 2.2 I2V Lightning · 4 steps"});
  }catch(e){
    console.error("Miya video API:",e);
    return res.status(502).json({success:false,error:e?.message||"Ошибка видео API.",code:"VIDEO_PROVIDER_ERROR"});
  }
}
