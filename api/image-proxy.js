export default async function handler(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  try{
    const url=String(req.query?.url||"").trim();
    if(!url) return res.status(400).json({success:false,error:"url is required"});
    const parsed=new URL(url);
    if(!["http:","https:"].includes(parsed.protocol)) throw new Error("Only HTTP(S) images are allowed.");
    const response=await fetch(parsed.toString(),{headers:{"User-Agent":"Miya-AI/1.0"}});
    if(!response.ok) throw new Error("Source image HTTP "+response.status);
    const contentType=(response.headers.get("content-type")||"image/jpeg").split(";")[0].toLowerCase();
    if(!contentType.startsWith("image/")) throw new Error("Source is not an image.");
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>12_000_000) throw new Error("Image is too large.");
    return res.status(200).json({success:true,dataUrl:"data:"+contentType+";base64,"+bytes.toString("base64")});
  }catch(error){
    return res.status(502).json({success:false,error:error?.message||"Image proxy failed."});
  }
}