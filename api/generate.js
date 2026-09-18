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

        // Используем публичный стабильный эндпоинт Hugging Face для генерации изображений
        const response = await fetch(
            "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ inputs: promptText })
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            return res.status(502).json({ error: `Hugging Face API error: ${errText}` });
        }

        // Сервис возвращает бинарные данные картинки напрямую
        const arrayBuffer = await response.arrayBuffer();
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
