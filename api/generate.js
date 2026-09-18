export default async function handler(req, res) {
    // Устанавливаем заголовки CORS и тип ответа JSON на случай любых падений
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = req.body || {};
        const parts = body.parts || [];
        const promptText = parts[0]?.text || "A beautiful landscape";

        const encodedPrompt = encodeURIComponent(promptText);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true`;

        const imageResponse = await fetch(imageUrl);

        if (!imageResponse.ok) {
            return res.status(502).json({ error: `External service error: ${imageResponse.status}` });
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
        return res.status(500).json({ error: error.message || "Unknown internal error" });
    }
}export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { parts } = req.body;
        const promptText = parts?.[0]?.text || "A beautiful landscape";

        const encodedPrompt = encodeURIComponent(promptText);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true`;

        // Создаем AbortController для таймаута (чтобы запрос не висел вечно)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 секунд таймаут

        const imageResponse = await fetch(imageUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!imageResponse.ok) {
            return res.status(502).json({ error: `External image service responded with status: ${imageResponse.status}` });
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
        if (error.name === 'AbortError') {
            return res.status(504).json({ error: 'Generation timeout: External service took too long to respond.' });
        }
        return res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}export default async function handler(req, res) {
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
