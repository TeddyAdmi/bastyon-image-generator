const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ success:false, error:"Method not allowed" });
  }

  const source = String(req.body?.prompt || "").trim();
  if (!source) {
    return res.status(400).json({ success:false, error:"Введите исходную идею." });
  }

  const fallback =
    source +
    ", ultra-detailed, photorealistic, cinematic lighting, natural textures, realistic anatomy, professional photography, depth of field, coherent composition, high detail";

  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(200).json({
        success:true,
        provider:"local",
        prompt:fallback
      });
    }

    const response = await fetch(OPENROUTER_URL,{
      method:"POST",
      headers:{
        Authorization:"Bearer "+process.env.OPENROUTER_API_KEY,
        "Content-Type":"application/json",
        "HTTP-Referer":process.env.APP_URL||"https://bastyon-image-generator.vercel.app/",
        "X-Title":"Miya AI"
      },
      body:JSON.stringify({
        model:"openai/gpt-4o-mini",
        messages:[
          {
            role:"system",
            content:"You are Miya AI prompt engineer. Rewrite the user's short image idea into one polished image-generation prompt. Preserve every requested subject, action and setting. Add composition, camera, lighting, materials, realism and detail when useful. Do not explain. Return only the final prompt in the user's language."
          },
          {role:"user",content:source}
        ],
        temperature:0.7,
        max_tokens:500
      })
    });

    const text=await response.text();
    let data={};
    try{data=JSON.parse(text)}catch{
      throw new Error("OpenRouter вернул не JSON (HTTP "+response.status+").");
    }
    if(!response.ok){
      throw new Error(data?.error?.message||data?.error||"OpenRouter HTTP "+response.status);
    }

    const prompt=String(data?.choices?.[0]?.message?.content||"").trim();
    if(!prompt)throw new Error("OpenRouter не вернул улучшенный промпт.");

    return res.status(200).json({success:true,provider:"OpenRouter",prompt});
  } catch(error) {
    return res.status(200).json({
      success:true,
      provider:"local-fallback",
      prompt:fallback,
      warning:error?.message||"AI Prompt fallback"
    });
  }
}
