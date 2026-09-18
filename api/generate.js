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
        
        // Используем стабильный эндпоинт v1 и актуальное название модели
        const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: parts }] })
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
