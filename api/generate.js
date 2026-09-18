export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'API key is not configured on server in Vercel environment variables.' });
    }

    try {
        const { parts } = req.body;
        // Извлекаем текст промпта из структуры запроса
        const promptText = parts?.[0]?.text || "A beautiful landscape";

        // Официальный эндпоинт для генерации изображений Imagen 3
        const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instances: [{ prompt: promptText }],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: "1:1",
                    outputMimeType: "image/jpeg"
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Imagen API Error Response:", data);
            return res.status(response.status).json({ error: data.error?.message || JSON.stringify(data) });
        }

        // Imagen возвращает картинку в формате base64 внутри массива predictions
        const base64ImageBytes = data.predictions?.[0]?.bytesBase64Encoded;
        
        if (!base64ImageBytes) {
            return res.status(500).json({ error: "No image returned from Imagen API." }, data);
        }

        // Преобразуем ответ в структуру, которую ожидает наш frontend
        const formattedResponse = {
            candidates: [{
                content: {
                    parts: [{
                        inline_data: {
                            mime_type: "image/jpeg",
                            data: base64ImageBytes
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
