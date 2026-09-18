export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const apiKey = process.env.POLLINATIONS_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'POLLINATIONS_KEY is missing in Vercel environment variables' });
        }

        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }

        const userPrompt = String(
            body?.prompt || 
            body?.text || 
            body?.parts?.[0]?.text || 
            ''
        ).trim();

        console.log('EXTRACTED PROMPT:', userPrompt);

        if (!userPrompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        // Большинство нейросетей (включая Flux) идеально понимают английский.
        // Передаем промт с акцентом на качественный английский запрос или через универсальный параметр.
        // Если вы хотите вводить на русском, добавим принудительную подсказку модели или сменим модель на turbo, которая лучше ест кириллицу.
        const enhancedPrompt = userPrompt + ", photorealistic, highly detailed, 8k";
        const safePrompt = encodeURIComponent(enhancedPrompt);
        
        // Меняем модель на 'turbo' или 'flux', но добавляем улучшенный запуск
        const externalUrl = `https://image.pollinations.ai/prompt/${safePrompt}?width=1024&height=1024&model=turbo&nologo=true&private=true`;

        console.log('Requesting URL:', externalUrl);

        const response = await fetch(externalUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(502).json({ error: `Image provider error: ${errText || response.status}` });
        }

        const arrayBuffer = await response.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString('base64');

        return res.status(200).json({
            candidates: [{
                content: {
                    parts: [{
                        inline_data: {
                            mime_type: 'image/jpeg',
                            data: base64Data
                        }
                    }]
                }
            }]
        });

    } catch (err) {
        console.error('Generation Error:', err);
        return res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
}
