export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    // Только POST
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    try {
        // ============================================
        // 1. Читаем запрос пользователя
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
        // 2. AI анализирует смысл русского запроса
        // ============================================

        const analysisPrompt = `
You are a professional visual scene parser.

The user wants to generate an image from the following request:

"${userPrompt}"

Analyze the request VERY LITERALLY.

Your task is to create a precise image-generation prompt.

CRITICAL RULES:

- Preserve the exact main subject.
- Preserve the exact number of subjects.
- Preserve every important object.
- Preserve the exact action.
- Preserve who is doing the action.
- Preserve the relationship between objects.
- Preserve location.
- Preserve colors.
- Preserve clothing.
- Preserve appearance.
- Preserve species, breed, age and gender when specified.
- Preserve emotions when specified.
- Preserve time of day when specified.
- Preserve weather when specified.
- Preserve style when specified.

DO NOT invent important objects.

DO NOT invent additional characters.

DO NOT change the action.

DO NOT change the location.

DO NOT replace the subject.

DO NOT add famous people.

DO NOT add logos.

DO NOT add flags unless the user requested a flag.

DO NOT add text.

DO NOT add writing.

DO NOT add signs.

DO NOT add brands.

DO NOT add NASA logos or other logos unless explicitly requested.

DO NOT add Earth, buildings, animals, vehicles or other objects
unless they are part of the user's request.

You MAY improve only the visual presentation:
- realistic lighting
- realistic materials
- realistic textures
- natural shadows
- composition
- camera position
- depth of field
- photographic realism

The final image must depict EXACTLY what the user described.

Return ONLY ONE English image prompt.

Do not explain anything.

User request:
${userPrompt}
`;

        // ============================================
        // 3. Получаем улучшенный prompt
        // ============================================

        const promptUrl =
            'https://text.pollinations.ai/' +
            encodeURIComponent(analysisPrompt);

        const promptResponse =
            await fetch(promptUrl);

        if (!promptResponse.ok) {
            return res.status(502).json({
                error:
                    `Prompt AI error: ${promptResponse.status}`
            });
        }

        let enhancedPrompt =
            (await promptResponse.text()).trim();

        if (!enhancedPrompt) {
            enhancedPrompt = userPrompt;
        }

        // Убираем возможные markdown-блоки
        enhancedPrompt = enhancedPrompt
            .replace(/^```(?:text|plaintext|prompt)?/i, '')
            .replace(/```$/i, '')
            .trim();

        // ============================================
        // 4. Финальный prompt для генератора
        // ============================================

        const finalPrompt = `
EXACT SCENE:

${enhancedPrompt}

IMPORTANT IMAGE INSTRUCTIONS:

Follow the described scene exactly.
Do not add or remove important objects.
Do not change the subject.
Do not change the action.
Do not change the location.
Do not introduce additional characters.

Photorealistic image.
Natural realistic proportions.
Accurate anatomy.
Realistic materials and textures.
Natural lighting.
Natural shadows.
Professional cinematic photography.
Sharp main subject.
Detailed environment.
Realistic depth of field.
High visual fidelity.
Clean composition.
No text.
No captions.
No watermark.
No logo unless explicitly requested.
`.trim();

        // ============================================
        // 5. Генерация изображения
        // ============================================

        const encodedPrompt =
            encodeURIComponent(finalPrompt);

        /*
         * Используем более качественную модель.
         *
         * Если эта модель временно недоступна,
         * ниже автоматически делаем запасной запрос
         * через FLUX.
         */

        const primaryImageUrl =
            `https://image.pollinations.ai/prompt/${encodedPrompt}` +
            `?width=1024` +
            `&height=1024` +
            `&model=seedream` +
            `&nologo=true` +
            `&private=true`;

        let imageResponse =
            await fetch(primaryImageUrl);

        // ============================================
        // 6. Запасной вариант FLUX
        // ============================================

        if (!imageResponse.ok) {

            const fallbackImageUrl =
                `https://image.pollinations.ai/prompt/${encodedPrompt}` +
                `?width=1024` +
                `&height=1024` +
                `&model=flux` +
                `&nologo=true` +
                `&private=true`;

            imageResponse =
                await fetch(fallbackImageUrl);
        }

        // ============================================
        // 7. Проверяем ответ генератора
        // ============================================

        if (!imageResponse.ok) {
            return res.status(502).json({
                error:
                    `Image generation error: ${imageResponse.status}`
            });
        }

        // ============================================
        // 8. Получаем изображение
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
        // 9. Возвращаем результат
        // ============================================

        return res.status(200).json({

            // Это полезно для проверки,
            // что AI понял запрос правильно.
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
