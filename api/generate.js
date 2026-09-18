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
        let promptText = parts[0]?.text || "A beautiful landscape";

        // Делаем промпт более развернутым, чтобы нейросеть не рисовала случайных людей по одному слову
        let enhancedPrompt = promptText;
        const lower = promptText.toLowerCase().trim();

        if (lower === 'тигр' || lower === 'tiger') {
            enhancedPrompt = 'A majestic wild Bengal tiger in the jungle, highly detailed, photorealistic, 8k resolution, no people';
        } else if (lower === 'медведь' || lower === 'медверь' || lower === 'bear') {
            enhancedPrompt = 'A powerful realistic brown bear in the wild forest, cinematic lighting, highly detailed';
        } else {
            // Для остальных коротких запросов добавляем конкретики
            enhancedPrompt = `${promptText}, high quality, detailed digital art, sharp focus`;
        }

        const encodedPrompt = encodeURIComponent(enhancedPrompt);
        // Используем другую модель или параметры без водяного знака
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true`;

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
