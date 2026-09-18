export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    // ============================================
    // METHOD
    // ============================================

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    try {
        // ============================================
        // POLLINATIONS API KEY
        // ============================================

        const apiKey = process.env.POLLINATIONS_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error:
                    'POLLINATIONS_KEY is not configured in Vercel Environment Variables'
            });
        }

        // ============================================
        // READ REQUEST
        // ============================================

        let body = req.body;

        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch {
                body = {};
            }
        }

        const parts = Array.isArray(body?.parts)
            ? body.parts
            : [];

        const userPrompt = String(
            parts[0]?.text || ''
        ).trim();

        if (!userPrompt) {
            return res.status(400).json({
                error: 'Введите описание изображения'
            });
        }

        // ============================================
        // DIRECT IMAGE PROMPT
        //
        // ВАЖНО:
        // Русский запрос НЕ переводится другим AI.
        // Мы передаем смысл непосредственно image-модели.
        // ============================================

        const finalPrompt = `
${userPrompt}

Create exactly the scene described above.

The user's requested content has the highest priority.

IMPORTANT COMPOSITION RULES:

- The main subject must be clearly visible.
- The main subject must be the visual focus of the image.
- Do not let secondary objects hide the main subject.
- If the subject is a person or animal, show the face and body clearly whenever possible.
- Show important clothing clearly.
- Show important objects clearly.
- Keep the requested colors exactly.
- Keep the requested actions exactly.
- Keep the requested relationships between objects exactly.
- Keep the requested location exactly.
- Do not replace objects with different objects.
- Do not add additional characters.
- Do not add additional animals.
- Do not add additional vehicles.
- Do not add famous landmarks unless they are explicitly requested.
- Do not add logos or brands unless explicitly requested.
- Do not add text or captions.
- Do not change the user's scene into a different scene.

Use a natural medium shot when appropriate so the main subject
and the important requested details are clearly visible.

Photorealistic.
Highly detailed.
Realistic anatomy.
Realistic fur, skin, fabric and materials.
Natural lighting.
Realistic shadows.
Natural colors.
Professional cinematic photography.
Sharp focus on the main subject.
High image quality.
Clean composition.
No watermark.
`.trim();

        // ============================================
        // POLLINATIONS OFFICIAL IMAGE API
        // ============================================

        const apiUrl =
            'https://gen.pollinations.ai/v1/images/generations';

        const requestBody = {
            model: 'openai/gpt-image-2',

            prompt: finalPrompt,

            size: '1024x1024',

            quality: 'high',

            n: 1,

            response_format: 'b64_json'
        };

        // ============================================
        // REQUEST
        // ============================================

        const imageResponse = await fetch(apiUrl, {
            method: 'POST',

            headers: {
                'Authorization':
                    `Bearer ${apiKey}`,

                'Content-Type':
                    'application/json'
            },

            body: JSON.stringify(requestBody)
        });

        // ============================================
        // READ API RESPONSE
        // ============================================

        let apiData = null;

        try {
            apiData = await imageResponse.json();
        } catch {
            apiData = null;
        }

        // ============================================
        // API ERROR
        // ============================================

        if (!imageResponse.ok) {
            console.error(
                'Pollinations API error:',
                apiData
            );

            return res.status(502).json({
                error:
                    apiData?.error?.message ||
                    apiData?.error ||
                    `Pollinations API error: ${imageResponse.status}`,

                status:
                    imageResponse.status
            });
        }

        // ============================================
        // CHECK IMAGE
        // ============================================

        const imageData =
            apiData?.data?.[0];

        if (!imageData) {
            console.error(
                'Pollinations returned no image:',
                apiData
            );

            return res.status(502).json({
                error:
                    'Pollinations returned no image'
            });
        }

        // ============================================
        // BASE64 IMAGE
        // ============================================

        let base64Data =
            imageData.b64_json;

        if (!base64Data && imageData.url) {

            // Некоторые ответы могут вернуть URL.
            // Загружаем изображение с URL.
            const imageDownload =
                await fetch(imageData.url);

            if (!imageDownload.ok) {
                return res.status(502).json({
                    error:
                        `Could not download generated image: ${imageDownload.status}`
                });
            }

            const buffer =
                await imageDownload.arrayBuffer();

            base64Data =
                Buffer.from(buffer)
                    .toString('base64');
        }

        if (!base64Data) {
            return res.status(502).json({
                error:
                    'Generated image data is empty'
            });
        }

        // ============================================
        // RETURN SAME FORMAT AS CURRENT INDEX.HTML
        // ============================================

        return res.status(200).json({

            prompt: userPrompt,

            model:
                'openai/gpt-image-2',

            candidates: [
                {
                    content: {
                        parts: [
                            {
                                inline_data: {
                                    mime_type:
                                        'image/png',

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
            'Critical Server Error:',
            error
        );

        return res.status(500).json({
            error:
                error?.message ||
                'Internal server error'
        });
    }
}
