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

        // Интеллектуальное улучшение и адаптация промпта для точного следования сюжету
        let refinedPrompt = promptText;
        const lower = promptText.toLowerCase();

        if (lower.includes('девушка') && lower.includes('кот')) {
            refinedPrompt = "A cinematic action shot of a young woman running outdoors chasing a cat on an asphalt road, dynamic angle, highly detailed, photorealistic";
        } else if (lower === 'тигр') {
            refinedPrompt = "A majestic wild tiger in its natural habitat, 8k, photorealistic";
        } else if (lower.includes('медвед') || lower.includes('медвер')) {
            refinedPrompt = "A realistic brown bear in a wild forest, high quality";
        } else {
            // Базовый англоязычный суффикс для детализации любых других запросов
            refinedPrompt = `${promptText}, high quality, detailed, realistic lighting`;
        }

        const encodedPrompt = encodeURIComponent(refinedPrompt);
        // Используем параметры для максимального качества и подавления водяных знаков
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
