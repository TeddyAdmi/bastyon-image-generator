export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    // ============================================
    // Только POST
    // ============================================

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    try {
        // ============================================
        // 1. Получаем запрос пользователя
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
        // 2. AI разбирает смысл русского запроса
        // ============================================

        const analysisPrompt = `
You are an expert image prompt engineer.

The user wants to create an image from this request:

"${userPrompt}"

Understand the request literally and preserve its meaning.

Your task is NOT to invent a new scene.

Your task is to convert the user's request into
one precise English prompt for an advanced image generator.

STRICT RULES:

1. Preserve the main subject exactly.

2. Preserve the number of people, animals and objects.

3. Preserve every important object mentioned by the user.

4. Preserve the exact action.

5. Preserve who performs the action.

6. Preserve relationships between objects.

7. Preserve the location.

8. Preserve colors.

9. Preserve clothing.

10. Preserve age, species, breed and appearance
when specified.

11. Preserve emotions when specified.

12. Preserve weather and time of day
when specified.

13. Preserve the artistic style when specified.

14. Do NOT add new characters.

15. Do NOT add new animals.

16. Do NOT add new vehicles.

17. Do NOT add buildings that were not requested.

18. Do NOT add flags unless requested.

19. Do NOT add logos.

20. Do NOT add brands.

21. Do NOT add text.

22. Do NOT add signs.

23. Do NOT add famous people.

24. Do NOT add NASA or other organizations
unless explicitly requested.

25. Do NOT add Earth, planets or objects
that the user did not request.

26. Do NOT change the action.

27. Do NOT change the location.

28. Do NOT replace one object with another.

29. Do NOT turn a requested object into
a background object.

30. Do NOT remove important details.

You may improve ONLY the visual presentation:
realistic materials, realistic textures,
natural lighting, realistic shadows,
camera composition and photographic quality.

If the user says "cat driving a car",
the cat must actually be driving the car.

If the user says "dog holding a ball",
the dog must actually hold the ball.

If the user says "man standing next to a woman",
do not change this relationship.

The generated image must match the user's
original meaning as closely as possible.

Return ONLY one clean English image prompt.

Do not explain your answer.
Do not use bullet points.
Do not add commentary.

USER REQUEST:
${userPrompt}
`;

        // ============================================
        // 3. Получаем точный английский prompt
        // ============================================

        const textUrl =
            'https://text.pollinations.ai/' +
            encodeURIComponent(analysisPrompt);

        const textResponse =
            await fetch(textUrl);

        if (!textResponse.ok) {
            return res.status(502).json({
                error:
                    `Prompt AI error: ${textResponse.status}`
            });
        }

        let enhancedPrompt =
            (await textResponse.text()).trim();

        if (!enhancedPrompt) {
            enhancedPrompt = userPrompt;
        }

        // Удаляем markdown если AI его добавил
        enhancedPrompt = enhancedPrompt
            .replace(/^```(?:text|plaintext|prompt)?/i, '')
            .replace(/```$/i, '')
            .trim();

        // ============================================
        // 4. Финальный prompt
        // ============================================

        const finalPrompt = `
Create an image that follows this scene EXACTLY:

${enhancedPrompt}

The content of the scene is the highest priority.

Do not add objects that are not described.
Do not remove described objects.
Do not change the action.
Do not change the subjects.
Do not change their relationships.
Do not change the location.

Make the image photorealistic,
high detail,
realistic textures,
realistic materials,
natural lighting,
realistic shadows,
accurate proportions,
natural anatomy,
professional photography,
sharp details,
natural depth of field,
cinematic composition.

No text.
No captions.
No watermark.
No logos unless explicitly requested.
`.trim();

        // ============================================
        // 5. Генерация через GPT Image 2
        // ============================================

        const encodedPrompt =
            encodeURIComponent(finalPrompt);

        const imageUrl =
            `https://image.pollinations.ai/prompt/${encodedPrompt}` +
            `?width=1536` +
            `&height=1024` +
            `&model=gpt-image-2` +
            `&nologo=true` +
            `&private=true`;

        let imageResponse =
            await fetch(imageUrl);

        // ============================================
        // 6. Если GPT Image 2 недоступна,
        // пробуем Seedream 4.5
        // ============================================

        if (!imageResponse.ok) {

            const fallbackUrl =
                `https://image.pollinations.ai/prompt/${encodedPrompt}` +
                `?width=1536` +
                `&height=1024` +
                `&model=seedream-4.5` +
                `&nologo=true` +
                `&private=true`;

            imageResponse =
                await fetch(fallbackUrl);
        }

        // ============================================
        // 7. Если и запасная модель не сработала
        // ============================================

        if (!imageResponse.ok) {

            const fluxUrl =
                `https://image.pollinations.ai/prompt/${encodedPrompt}` +
                `?width=1024` +
                `&height=1024` +
                `&model=flux` +
                `&nologo=true` +
                `&private=true`;

            imageResponse =
                await fetch(fluxUrl);
        }

        // ============================================
        // 8. Проверяем результат
        // ============================================

        if (!imageResponse.ok) {
            return res.status(502).json({
                error:
                    `Image generation error: ${imageResponse.status}`
            });
        }

        // ============================================
        // 9. Получаем изображение
        // ============================================

        const contentType =
            imageResponse.headers.get(
                'content-type'
            ) || 'image/jpeg';

        const arrayBuffer =
            await imageResponse.arrayBuffer();

        const base64Data =
            Buffer.from(arrayBuffer)
                .toString('base64');

        // ============================================
        // 10. Возвращаем изображение
        // ============================================

        return res.status(200).json({

            // Показываем, что именно понял AI
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
