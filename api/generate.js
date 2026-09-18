export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'API key is not configured on server in Vercel environment variables.' });
    }

    try {
        const { parts } = req.body;
        const userPrompt = parts?.[0]?.text || "A futuristic landscape";

        // Обращаемся к модели с системной инструкцией, требующей выдать результат как изображение
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: `Task: Generate an image. Prompt: ${userPrompt}. Return raw image bytes in inline_data.` }
                        ]
                    }
                ],
                generationConfig: {
                    responseModalities: ["IMAGE"]
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Google API Error Response:", data);
            return res.status(response.status).json({ error: data.error?.message || JSON.stringify(data) });
        }

        // Проверяем, вернула ли модель реальный контент изображения
        const hasImage = data.candidates?.[0]?.content?.parts?.some(p => p.inline_data);

        if (!hasImage) {
            // Если модель снова попыталась ответить текстом, перехватываем и возвращаем ошибку текстом
            const textReply = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textReply) {
                return res.status(400).json({ 
                    error: "Model returned text instead of image: " + textReply.substring(0, 150) + "..." 
                });
            }
        }

        return res.status(200).json(data);
    } catch (error) {
        console.error("Server Handler Exception:", error);
        return res.status(500).json({ error: error.message });
    }
}
