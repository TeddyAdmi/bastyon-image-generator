export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    try {
        // -----------------------------
        // 1. Получаем запрос пользователя
        // -----------------------------

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

        // -----------------------------
        // 2. AI понимает смысл запроса
        // -----------------------------

        const promptEngineer = `
You are an expert AI image prompt engineer.

The user can write the request in Russian or any other language.

Your job is to understand exactly what the user wants to see
and convert the request into ONE detailed English prompt
for an image generation model.

IMPORTANT:

1. Preserve the exact meaning of the user's request.

2. NEVER remove the main subject.

3. NEVER change the main subject.

4. NEVER change the action.

5. NEVER change the location.

6. NEVER invent important objects, characters or events
that were not requested.

7. Keep all important relationships between objects.

For example:

"кот сидит на крыше автомобиля"

means that the CAT is sitting ON THE ROOF of the CAR.

Do NOT turn it into:
"a car with a cat nearby".

Another example:

"собака держит мяч во рту"

means the DOG is holding the BALL IN ITS MOUTH.

Do NOT change the action.

8. If the user describes several objects or characters,
keep all of them.

9. If the user specifies colors, clothes, age, breed,
appearance, emotions, weather or other details,
preserve them.

10. If the user specifies an artistic style,
preserve that style.

11. If the user does not specify a style,
use cinematic photorealism.

12. Improve the visual description without changing
the meaning.

13. Add useful visual details such as:
- composition
- camera angle
- realistic lighting
- environment
- textures
- depth of field
- realistic materials
- natural shadows
- cinematic atmosphere

14. Make the scene visually coherent.

15. Do not add text, captions, letters, logos,
watermarks or signs unless the user explicitly asks
for them.

16. Do not explain your answer.

17. Return ONLY the final English image prompt.

User request:

${userPrompt}
`;

        const textUrl =
            'https://text.pollinations.ai/' +
            encodeURIComponent(promptEngineer);

        const textResponse = await fetch(textUrl);

        if (!textResponse.ok) {
            return res.status(502).json({
                error:
                    `AI prompt error: ${textResponse.status}`
            });
        }

        let enhancedPrompt =
            (await textResponse.text()).trim();

        // -----------------------------
        // 3. Если AI не ответил —
        // используем оригинальный запрос
        // -----------------------------

        if (!enhancedPrompt) {
            enhancedPrompt = userPrompt;
        }

        // Убираем возможные кавычки/служебный текст
        enhancedPrompt = enhancedPrompt
            .replace(/^```(?:text|plaintext)?/i, '')
            .replace(/```$/i, '')
            .trim();

        // -----------------------------
        // 4. Добавляем качество
        // -----------------------------

        const finalPrompt = `
${enhancedPrompt}

High quality cinematic photography,
photorealistic details,
realistic textures,
natural lighting,
realistic shadows,
accurate proportions,
natural anatomy,
sharp focus on the main subject,
depth of field,
professional photography,
highly detailed.
`.trim();

        // -----------------------------
        // 5. Генерируем изображение
        // -----------------------------

        const encodedPrompt =
            encodeURIComponent(finalPrompt);

        const imageUrl =
            `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&private=true`;

        const imageResponse =
            await fetch(imageUrl);

        if (!imageResponse.ok) {
            return res.status(502).json({
                error:
                    `Image generation error: ${imageResponse.status}`
            });
        }

        // -----------------------------
        // 6. Получаем изображение
        // -----------------------------

        const contentType =
            imageResponse.headers.get(
                'content-type'
            ) || 'image/jpeg';

        const arrayBuffer =
            await imageResponse.arrayBuffer();

        const base64Data =
            Buffer.from(arrayBuffer)
                .toString('base64');

        // -----------------------------
        // 7. Возвращаем изображение
        // -----------------------------

        return res.status(200).json({
            prompt: enhancedPrompt,

            candidates: [
                {
                    content: {
                        parts: [
                            {
                                inline_data: {
                                    mime_type:
                                        contentType,
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
