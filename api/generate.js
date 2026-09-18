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
        const promptText = parts?.[0]?.text || "A beautiful landscape";

        // Запрос к модели с указанием роли генерации изображений
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "Generate an image based on this request: " + promptText }
                    ]
                }],
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

        return res.status(200).json(data);
    } catch (error) {
        console.error("Server Handler Exception:", error);
        return res.status(500).json({ error: error.message });
    }
}
