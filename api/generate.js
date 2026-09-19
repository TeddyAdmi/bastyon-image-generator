export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
    );

    // ============================================
    // CORS PREFLIGHT
    // ============================================

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // ============================================
    // ONLY POST
    // ============================================

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    try {
        // ============================================
        // POLLINATIONS KEY
        // ============================================

        const apiKey = process.env.POLLINATIONS_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error:
                    'POLLINATIONS_KEY is missing in Vercel Environment Variables'
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

        const userPrompt = String(
            body?.prompt ||
            body?.text ||
            body?.parts?.[0]?.text ||
            ''
        ).trim();

        console.log('USER PROMPT:', userPrompt);

        if (!userPrompt) {
            return res.status(400).json({
                error: 'Введите описание изображения'
            });
        }

        // ============================================
        // DIRECT PROMPT
        //
        // НЕ переводим запрос через другой AI.
        // GPT Image 2 получает исходный запрос.
        // ============================================

        const finalPrompt = `
${userPrompt}

Create exactly the scene described by the user.

The user's requested subject, action, objects,
colors, clothing, location and relationships
must be preserved exactly.

COMPOSITION:

The main subject must be clearly visible
and must be the primary focus of the image.

If the main subject is a person or animal,
show the face and body clearly whenever
the requested scene allows it.

Important clothing and important objects
must remain clearly visible.

Secondary objects must NOT cover the main subject.

Do not hide the main subject behind an object.

Do not replace the main subject.

Do not change the action.

Do not change the location.

Do not add additional people.

Do not add additional animals.

Do not add additional vehicles.

Do not add unnecessary landmarks.

Do not invent objects that were not requested.

Do not add logos or brands unless requested.

Do not add text or captions.

Do not add watermarks.

Use a natural medium shot when appropriate.

Photorealistic photography.
Realistic anatomy.
Realistic proportions.
Realistic materials.
Realistic textures.
Natural lighting.
Natural shadows.
Natural colors.
Detailed subject.
Sharp focus on the main subject.
Cinematic but realistic composition.
High visual quality.
`.trim();

        console.log(
            'FINAL PROMPT:',
            finalPrompt
        );

        // ============================================
        // OFFICIAL POLLINATIONS API
        // ============================================

        const apiUrl =
            'https://gen.pollinations.ai/v1/images/generations';

        // ============================================
        // REQUEST BODY
        // ============================================

        const requestBody = {
            model: 'openai/gpt-image-2',

            prompt: finalPrompt,

            size: '1024x1024',

            quality: 'high',

            n: 1,

            response_format: 'b64_json'
        };

        // ============================================
        // GENERATE IMAGE
        // ============================================

        const response = await fetch(apiUrl, {
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
        // READ RESPONSE
        // ============================================

        const responseText =
            await response.text();

        let data;

        try {
            data = JSON.parse(responseText);
        } catch {
            data = null;
        }

        // ============================================
        // PROVIDER ERROR
        // ============================================

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

        // ============================================
        // GET IMAGE
        // ============================================

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

        // ============================================
        // BASE64
        // ============================================

        let base64Data =
            image.b64_json;

        // ============================================
        // FALLBACK IF PROVIDER RETURNS URL
        // ============================================

        if (!base64Data && image.url) {

            const imageResponse =
                await fetch(image.url);

            if (!imageResponse.ok) {
                return res.status(502).json({
                    error:
                        `Could not download generated image: ${imageResponse.status}`
                });
            }

            const arrayBuffer =
                await imageResponse.arrayBuffer();

            base64Data =
                Buffer.from(arrayBuffer)
                    .toString('base64');
        }

        if (!base64Data) {
            return res.status(502).json({
                error:
                    'Generated image data is empty'
            });
        }

        // ============================================
        // RETURN TO INDEX.HTML
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
