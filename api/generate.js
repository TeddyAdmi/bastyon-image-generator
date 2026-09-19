export default async function handler(req, res) {

    /*
    ============================================
    CORS
    ============================================
    */

    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "POST, OPTIONS"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );


    if (req.method === "OPTIONS") {

        return res
            .status(200)
            .end();

    }


    if (req.method !== "POST") {

        return res
            .status(405)
            .json({
                error: "Method not allowed"
            });

    }


    try {

        /*
        ========================================
        API KEY
        ========================================
        */

        const apiKey =
            process.env.POLLINATIONS_KEY;


        if (!apiKey) {

            return res
                .status(500)
                .json({
                    error:
                        "POLLINATIONS_KEY не найден в Vercel Environment Variables"
                });

        }


        /*
        ========================================
        REQUEST BODY
        ========================================
        */

        let body =
            req.body;


        if (
            typeof body ===
            "string"
        ) {

            try {

                body =
                    JSON.parse(
                        body
                    );

            } catch {

                body = {};

            }

        }


        /*
        ========================================
        PROMPT
        ========================================
        */

        const userPrompt =
            String(
                body?.prompt ||
                ""
            ).trim();


        if (!userPrompt) {

            return res
                .status(400)
                .json({
                    error:
                        "Введите описание изображения"
                });

        }


        /*
        ========================================
        MODELS
        ========================================
        */

        /*
        Здесь интерфейс использует короткие
        названия.

        Реальные модели отправляются
        в Pollinations.
        */

        const models = {

            flux: {
                id:
                    "black-forest-labs/flux.1-schnell",

                name:
                    "FLUX.1 Schnell"
            },

            zimage: {
                id:
                    "tongyi-mai/z-image-turbo",

                name:
                    "Z-Image Turbo"
            },

            dreamshaper: {
                id:
                    "lykon/dreamshaper-8-lcm",

                name:
                    "DreamShaper 8"
            }

        };


        const requestedModel =
            String(
                body?.model ||
                "flux"
            );


        const selected =
            models[
                requestedModel
            ] ||
            models.flux;


        /*
        ========================================
        QUALITY
        ========================================
        */

        const allowedQuality = [
            "low",
            "medium",
            "high"
        ];


        const quality =
            allowedQuality.includes(
                body?.quality
            )
                ? body.quality
                : "medium";


        /*
        ========================================
        DIMENSIONS
        ========================================
        */

        let width =
            Number(
                body?.width
            ) || 1024;


        let height =
            Number(
                body?.height
            ) || 1024;


        /*
        Безопасные границы.

        Не разрешаем случайно отправить
        огромный размер и получить
        неожиданный расход.
        */

        width =
            Math.max(
                256,
                Math.min(
                    1536,
                    width
                )
            );


        height =
            Math.max(
                256,
                Math.min(
                    1536,
                    height
                )
            );


        /*
        Большинство image-моделей
        лучше работают с размерами,
        кратными 16.
        */

        width =
            Math.round(
                width / 16
            ) * 16;


        height =
            Math.round(
                height / 16
            ) * 16;


        /*
        ========================================
        PROMPT
        ========================================
        */

        const finalPrompt = `
${userPrompt}

Create exactly the scene described by the user.

Preserve the requested:

- subject
- action
- objects
- location
- colors
- clothing
- composition
- relationships between objects

Do not replace the main subject.

Do not change the requested action.

Do not add unnecessary people.

Do not add unnecessary animals.

Do not add unnecessary vehicles.

Do not add logos or brands unless requested.

Do not add captions.

Do not add watermarks.

Keep the main subject clearly visible.

Use realistic proportions.

Use realistic materials.

Use detailed textures.

Use natural lighting.

Use natural shadows.

Use realistic colors.

Create a visually strong composition.

High quality image generation.
`.trim();


        console.log(
            "MODEL:",
            selected.id
        );

        console.log(
            "SIZE:",
            width,
            "x",
            height
        );

        console.log(
            "QUALITY:",
            quality
        );

        console.log(
            "PROMPT:",
            userPrompt
        );


        /*
        ========================================
        POLLINATIONS IMAGE API
        ========================================
        */

        const endpoint =
            "https://gen.pollinations.ai/image/" +
            encodeURIComponent(
                finalPrompt
            );


        /*
        ========================================
        QUERY PARAMETERS
        ========================================
        */

        const params =
            new URLSearchParams();


        params.set(
            "model",
            selected.id
        );


        params.set(
            "width",
            String(width)
        );


        params.set(
            "height",
            String(height)
        );


        params.set(
            "quality",
            quality
        );


        /*
        ========================================
        REQUEST
        ========================================
        */

        const response =
            await fetch(
                endpoint +
                "?" +
                params.toString(),
                {
                    method: "GET",

                    headers: {

                        Authorization:
                            `Bearer ${apiKey}`,

                        Accept:
                            "image/*"

                    }

                }
            );


        /*
        ========================================
        PROVIDER ERROR
        ========================================
        */

        if (
            !response.ok
        ) {

            const errorText =
                await response.text();


            console.error(
                "POLLINATIONS ERROR:",
                response.status,
                errorText
            );


            return res
                .status(502)
                .json({

                    error:
                        "Модель временно недоступна. Попробуйте другую модель или другое качество."

                });

        }


        /*
        ========================================
        IMAGE DATA
        ========================================
        */

        const arrayBuffer =
            await response
                .arrayBuffer();


        if (
            !arrayBuffer ||
            arrayBuffer.byteLength === 0
        ) {

            return res
                .status(502)
                .json({

                    error:
                        "Провайдер вернул пустое изображение"

                });

        }


        /*
        ========================================
        MIME TYPE
        ========================================
        */

        const mime =
            response.headers
                .get(
                    "content-type"
                ) ||
            "image/png";


        /*
        ========================================
        BASE64
        ========================================
        */

        const base64 =
            Buffer
                .from(
                    arrayBuffer
                )
                .toString(
                    "base64"
                );


        /*
        ========================================
        RESPONSE
        ========================================
        */

        return res
            .status(200)
            .json({

                success:
                    true,

                model:
                    selected.id,

                modelName:
                    selected.name,

                width,

                height,

                quality,

                image: {

                    mime,

                    data:
                        base64

                }

            });


    } catch (error) {

        console.error(
            "GENERATION ERROR:",
            error
        );


        return res
            .status(500)
            .json({

                error:
                    error?.message ||
                    "Внутренняя ошибка сервера"

            });

    }

}
