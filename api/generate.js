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
         * НАСТРОЙКИ РЕДАКТОРА
         */

        const model = String(
            body?.model || 'openai/gpt-image-2'
        );

        const size = String(
            body?.size || '1024x1024'
        );

        const quality = String(
            body?.quality || 'high'
        );

        const transparent =
            body?.transparent === true;

        /*
         * Разрешённые модели.
         * Это защищает API от случайных
         * или нежелательных значений.
         */

        const allowedModels = [
            'openai/gpt-image-2',
            'openai/gpt-image-1.5',
            'bytedance/seedream-5.0-pro',
            'bytedance/seedream-5.0-lite',
            'black-forest-labs/flux.2-pro',
            'black-forest-labs/flux.2-flex',
            'black-forest-labs/flux.2-max',
            'google/gemini-3.1-flash-image',
            'google/gemini-3-pro-image',
            'ideogram-ai/ideogram-v4-quality',
            'ideogram-ai/ideogram-v4-balanced',
            'ideogram-ai/ideogram-v4-turbo',
            'x-ai/grok-imagine-image-2.0',
            'qwen/qwen-image-3'
        ];

        if (!allowedModels.includes(model)) {
            return res.status(400).json({
                error: `Unsupported model: ${model}`
            });
        }

        /*
         * Разрешённые размеры.
         */

        const allowedSizes = [
            '1024x1024',
            '1536x1024',
            '1024x1536',
            '1536x1536',
            '1792x1024',
            '1024x1792',
            '2048x1152',
            '1152x2048'
        ];

        if (!allowedSizes.includes(size)) {
            return res.status(400).json({
                error: `Unsupported size: ${size}`
            });
        }

        /*
         * Разрешённое качество.
         */

        const allowedQuality = [
            'low',
            'medium',
            'high',
            'hd'
        ];

        if (!allowedQuality.includes(quality)) {
            return res.status(400).json({
                error: `Unsupported quality: ${quality}`
            });
        }

        /*
         * Дополнительная инструкция.
         * Исходный русский промпт сохраняем.
         */

        const finalPrompt = `
${userPrompt}

Create exactly the scene described by the user.

IMPORTANT:

Follow the user's description precisely.

The main subject must be clearly visible
and remain the primary focus.

Preserve:
- subject
- action
- location
- objects
- colors
- clothing
- relationships between objects
- requested composition

Do not replace the main subject.

Do not change the action.

Do not invent additional people.

Do not invent additional animals.

Do not invent vehicles.

Do not add unnecessary landmarks.

Do not hide the main subject.

Do not put important objects in front
of the main subject.

Do not add logos unless requested.

Do not add text unless requested.

Do not add captions.

Do not add watermarks.

Photorealistic image.

Realistic anatomy.

Realistic proportions.

Realistic materials.

Realistic textures.

Natural lighting.

Natural shadows.

Detailed environment.

Sharp focus on the main subject.

High visual quality.
`.trim();

        console.log('MODEL:', model);
        console.log('SIZE:', size);
        console.log('QUALITY:', quality);
        console.log('TRANSPARENT:', transparent);
        console.log('USER PROMPT:', userPrompt);

        /*
         * POLLINATIONS API
         */

        const apiUrl =
            'https://gen.pollinations.ai/v1/images/generations';

        const requestBody = {
            model,
            prompt: finalPrompt,
            size,
            quality,
            n: 1,
            response_format: 'url'
        };

        /*
         * Прозрачный фон.
         * Для GPT Image моделей Pollinations
         * поддерживает transparent.
         */

        if (
            transparent &&
            (
                model === 'openai/gpt-image-2' ||
                model === 'openai/gpt-image-1.5'
            )
        ) {
            requestBody.transparent = true;
        }

        console.log(
            'POLLINATIONS REQUEST:',
            JSON.stringify({
                model,
                size,
                quality,
                transparent
            })
        );

        const response = await fetch(
            apiUrl,
            {
                method: 'POST',

                headers: {
                    'Authorization':
                        `Bearer ${apiKey}`,

                    'Content-Type':
                        'application/json'
                },

                body:
                    JSON.stringify(requestBody)
            }
        );

        const responseText =
            await response.text();

        let data;

        try {
            data =
                JSON.parse(responseText);
        } catch {
            data = null;
        }

        /*
         * Ошибка Pollinations
         */

        if (!response.ok) {
            console.error(
                'POLLINATIONS ERROR:',
                responseText
            );

            const errorMessage =
                data?.error?.message ||
                data?.error ||
                responseText ||
                `HTTP ${response.status}`;

            return res.status(502).json({
                error:
                    `Image provider error: ${errorMessage}`
            });
        }

        /*
         * Получаем результат
         */

        const image =
            data?.data?.[0];

        if (!image) {
            console.error(
                'NO IMAGE DATA:',
                data
            );

            return res.status(502).json({
                error:
                    'Image provider returned no image'
            });
        }

        /*
         * Pollinations возвращает URL.
         * Скачиваем готовое изображение.
         */

        let base64Data =
            image.b64_json;

        let mimeType =
            image.media_type ||
            'image/png';

        if (!base64Data && image.url) {

            const imageResponse =
                await fetch(image.url);

            if (!imageResponse.ok) {
                return res.status(502).json({
                    error:
                        `Could not download generated image: ${imageResponse.status}`
                });
            }

            const contentType =
                imageResponse.headers.get(
                    'content-type'
                );

            if (contentType) {
                mimeType =
                    contentType.split(';')[0];
            }

            const arrayBuffer =
                await imageResponse.arrayBuffer();

            base64Data =
                Buffer
                    .from(arrayBuffer)
                    .toString('base64');
        }

        if (!base64Data) {
            return res.status(502).json({
                error:
                    'Generated image data is empty'
            });
        }

        /*
         * Возвращаем фронтенду тот же формат,
         * который уже понимает твой index.html.
         */

        return res.status(200).json({

            prompt:
                userPrompt,

            model,

            size,

            quality,

            candidates: [
                {
                    content: {
                        parts: [
                            {
                                inline_data: {
                                    mime_type:
                                        mimeType,

                                    data:
                                        base64Data
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
