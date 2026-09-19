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
        const apiKey = process.env.POLLINATIONS_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: 'POLLINATIONS_KEY is missing in Vercel'
            });
        }

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

        /*
         * Не переводим русский текст.
         * Передаем исходный запрос непосредственно
         * модели изображения.
         */
        const finalPrompt = `
${userPrompt}

Create exactly the scene described by the user.

IMPORTANT:
- Follow the user's description exactly.
- Keep the main subject clearly visible.
- Do not replace the main subject.
- Do not change the action.
- Do not change the location.
- Preserve requested colors and clothing.
- Preserve requested objects.
- Do not add people unless requested.
- Do not add animals unless requested.
- Do not add vehicles unless requested.
- Do not add unnecessary landmarks.
- Do not hide the main subject.
- Do not put objects in front of the main subject.
- Do not add text.
- Do not add logos.
- Do not add watermarks.

The main subject should occupy a clear,
natural part of the frame.

Photorealistic.
Realistic anatomy.
Realistic proportions.
Natural lighting.
Natural shadows.
Detailed textures.
Sharp focus.
High image quality.
`.trim();

        console.log('USER PROMPT:', userPrompt);

        const response = await fetch(
            'https://gen.pollinations.ai/v1/images/generations',
            {
                method: 'POST',

                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },

                body: JSON.stringify({
                    model: 'openai/gpt-image-1.5',
                    prompt: finalPrompt,
                    size: '1024x1024',
                    quality: 'medium',
                    n: 1,
                    response_format: 'url'
                })
            }
        );

        const responseText = await response.text();

        let data;

        try {
            data = JSON.parse(responseText);
        } catch {
            data = null;
        }

        if (!response.ok) {
            console.error(
                'POLLINATIONS ERROR:',
                responseText
            );

            return res.status(502).json({
                error:
                    `Image provider error: ${
                        data?.error?.message ||
                        responseText ||
                        response.status
                    }`
            });
        }

        const image = data?.data?.[0];

        if (!image) {
            console.error('NO IMAGE DATA:', data);

            return res.status(502).json({
                error: 'Image provider returned no image'
            });
        }

        /*
         * Pollinations может вернуть URL.
         * Скачиваем изображение на сервере Vercel
         * и возвращаем фронтенду тот же формат,
         * который уже использует наш index.html.
         */
        let base64Data = image.b64_json;

        if (!base64Data && image.url) {
            const imageResponse = await fetch(image.url);

            if (!imageResponse.ok) {
                return res.status(502).json({
                    error:
                        `Could not download generated image: ${imageResponse.status}`
                });
            }

            const arrayBuffer =
                await imageResponse.arrayBuffer();

            base64Data =
                Buffer.from(arrayBuffer).toString('base64');
        }

        if (!base64Data) {
            return res.status(502).json({
                error: 'Generated image data is empty'
            });
        }

        return res.status(200).json({
            prompt: userPrompt,
            model: 'openai/gpt-image-1.5',

            candidates: [
                {
                    content: {
                        parts: [
                            {
                                inline_data: {
                                    mime_type: 'image/png',
                                    data: base64Data
                                }
                            }
                        ]
                    }
                }
            ]
        });

    } catch (error) {
        console.error(
            'GENERATION ERROR:',
            error
        );

        return res.status(500).json({
            error:
                error?.message ||
                'Internal Server Error'
        });
    }
}
