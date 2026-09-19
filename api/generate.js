export const maxDuration = 60; // Увеличение лимита времени выполнения для Vercel

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
    );

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    try {
        let body = req.body;

        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch {
                body = {};
            }
        }

        const userPrompt = String(
            body?.prompt ||
            body?.text ||
            body?.parts?.[0]?.text ||
            ''
        ).trim();

        if (!userPrompt) {
            return res.status(400).json({
                error: 'Введите описание изображения'
            });
        }

        // Формируем детальный промпт на английском/русском с акцентом на всех участников сцены
        const detailedPrompt = `${userPrompt}, full shot, wide angle, all mentioned subjects clearly visible together in the frame, high quality`;

        const width = 1024;
        const height = 1024;
        const seed = Math.floor(Math.random() * 999999999);
        
        const encodedPrompt = encodeURIComponent(detailedPrompt);
        
        // Используем параметры для уменьшения эффекта «отсебятины»
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=false&model=flux`;

        console.log(`FIXED FREE URL: ${imageUrl}`);

        const imageResponse = await fetch(imageUrl);

        if (!imageResponse.ok) {
            if (imageResponse.status === 429) {
                return res.status(429).json({
                    error: 'Слишком много запросов (ошибка 429). Подождите 1 минуту.'
                });
            }
            throw new Error(`Failed to generate image from public API: ${imageResponse.status}`);
        }

        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        const mimeType = contentType.split(';')[0];

        const arrayBuffer = await imageResponse.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');

        if (!base64Data) {
            return res.status(502).json({
                error: 'Generated image data is empty'
            });
        }

        return res.status(200).json({
            prompt: userPrompt,
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                inline_data: {
                                    mime_type: mimeType,
                                    data: base64Data
                                }
                            }
                        ]
                    }
                }
            ]
        });

    } catch (error) {
        console.error('GENERATION ERROR:', error);
        return res.status(500).json({
            error: error?.message || 'Internal Server Error'
        });
    }
}
