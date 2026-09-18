export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }

        const parts = body?.parts || [];
        const promptText = parts[0]?.text || "A beautiful landscape";

        // Формируем чистый запрос без искажения вашего текста, добавляя качественный суффикс
        const finalPrompt = `${promptText}, highly detailed, cinematic lighting, sharp focus`;
        const encodedPrompt = encodeURIComponent(finalPrompt);
        
        // Используем модель flux без водяных знаков
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true`;

        const imageResponse = await fetch(imageUrl);

        if (!imageResponse.ok) {
            return res.status(502).json({ error: `External service error status: ${imageResponse.status}` });
        }

        const arrayBuffer = await imageResponse.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');

        return res.status(200).json({
            candidates: [{
                content: {
                    parts: [{
                        inline_data: {
                            mime_type: "image/jpeg",
                            data: base64Data
                        }
                    }]
                }
            }]
        });

    } catch (error) {
        console.error("Critical Server Error:", error);
        return res.status(500).json({ error: error?.message || "Internal server error" });
    }
}
