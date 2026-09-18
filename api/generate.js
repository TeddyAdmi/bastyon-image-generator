export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'API key is not configured on server in Vercel environment variables.' });
    }

    const { parts } = req.body;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    let attempts = 4; // Количество попыток при нагрузке
    let delay = 3000; // Начальная задержка 3 секунды

    for (let i = 0; i < attempts; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: parts }] })
            });

            const data = await response.json();

            if (response.ok) {
                return res.status(200).json(data);
            }

            // Если модель перегружена (503) или занята, пробуем еще раз
            const errorMessage = data.error?.message || JSON.stringify(data);
            if ((response.status === 503 || response.status === 429) && i < attempts - 1) {
                console.warn(`Attempt ${i + 1} failed (High demand). Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Увеличиваем паузу перед следующим повтором
                continue;
            }

            console.error("Google API Error Response:", data);
            return res.status(response.status).json({ error: errorMessage });

        } catch (error) {
            console.error("Server Handler Exception:", error);
            if (i === attempts - 1) {
                return res.status(500).json({ error: error.message });
            }
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}
