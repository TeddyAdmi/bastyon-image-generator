export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb',
        },
    },
};

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const apiKey = process.env.POLLINATIONS_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'POLLINATIONS_KEY is not configured' });
        }

        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }

        const parts = Array.isArray(body?.parts) ? body.parts : [];
        const userPrompt = String(parts[0]?.text || '').trim();

        if (!userPrompt) {
            return res.status(400).json({ error: 'Введите описание изображения' });
        }

        // Чистый и качественный промпт для модели
        const finalPrompt = `${userPrompt}, highly detailed, sharp focus, professional photography, high quality, no watermark`;
        const encodedPrompt = encodeURIComponent(finalPrompt);
        
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&private=true`;

        const imageResponse = await fetch(imageUrl, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (!imageResponse.ok) {
            return res.status(502).json({ error: `External API error status: ${imageResponse.status}` });
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
        console.error("Server Error:", error);
        return res.status(500).json({ error: error?.message || "Internal server error" });
    }
}
