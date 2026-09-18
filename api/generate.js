export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    try {
        const apiKey = process.env.POLLINATIONS_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: 'POLLINATIONS_KEY is not configured in Vercel Environment Variables'
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

        const parts = Array.isArray(body?.parts) ? body.parts : [];
        const userPrompt = String(parts[0]?.text || '').trim();

        if (!userPrompt) {
            return res.status(400).json({
                error: 'Введите описание изображения'
            });
        }

        // Ваш детальный и надежный промпт
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

        // Актуальный эндпоинт Pollinations для работы с ключом
        const encodedPrompt = encodeURIComponent(finalPrompt);
        const apiUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&private=true`;

        // Отправляем запрос с вашим Bearer-токеном
        const imageResponse = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (!imageResponse.ok) {
            const errText = await imageResponse.text();
            return res.status(502).json({
                error: `Pollinations API error: ${errText || imageResponse.status}`
            });
        }

        // Получаем бинарный поток картинки и конвертируем в Base64
        const arrayBuffer = await imageResponse.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');

        if (!base64Data) {
            return res.status(502).json({
                error: 'Generated image data is empty'
            });
        }

        // Возвращаем результат в формате, который ждет ваш фронтенд
        return res.status(200).json({
            prompt: userPrompt,
            model: 'flux',
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                inline_data: {
                                    mime_type: 'image/jpeg',
                                    data: base64Data
                                }
                            }
                        ]
                    }
                }
            ]
        });

    } catch (error) {
        console.error('Critical Server Error:', error);
        return res.status(500).json({
            error: error?.message || 'Internal server error'
        });
    }
}
