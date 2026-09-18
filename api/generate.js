export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { parts } = req.body;
        const promptText = parts?.[0]?.text || "A beautiful landscape";

        // Добавляем параметры модели flux и nologo=true для удаления водяного знака
        const encodedPrompt = encodeURIComponent(promptText);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true`;

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            throw new Error("Failed to generate image from external service.");
        }

        const arrayBuffer = await imageResponse.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');

        const formattedResponse = {
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
        };

        return res.status(200).json(formattedResponse);
    } catch (error) {
        console.error("Server Handler Exception:", error);
        return res.status(500).json({ error: error.message });
    }
}export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { parts } = req.body;
        const promptText = parts?.[0]?.text || "A beautiful landscape";

        // Используем открытый и стабильный генератор изображений по URL
        const encodedPrompt = encodeURIComponent(promptText);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true`;

        // Скачиваем картинку на бэкенд Vercel, чтобы конвертировать её в Base64 для фронтенда
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            throw new Error("Failed to generate image from external service.");
        }

        const arrayBuffer = await imageResponse.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');

        // Формируем ответ в привычном для фронтенда формате
        const formattedResponse = {
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
        };

        return res.status(200).json(formattedResponse);
    } catch (error) {
        console.error("Server Handler Exception:", error);
        return res.status(500).json({ error: error.message });
    }
}
