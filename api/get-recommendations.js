const https = require('https');

/**
 * Main handler for the serverless function.
 * This function receives geospatial and weather data, sends it to the OpenAI API,
 * and returns agronomic recommendations.
 */
module.exports = async (req, res) => {
    // Set CORS headers to allow requests from your frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle pre-flight CORS requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { lat, lon, ndvi, weatherData, lang } = req.body;

        if (!lat || !lon || !ndvi || !weatherData) {
            return res.status(400).json({ error: 'Missing required data: lat, lon, ndvi, and weatherData are required.' });
        }

        const openAiApiKey = process.env.OPENAI_API_KEY;
        if (!openAiApiKey) {
            console.error('OpenAI API key is not set in environment variables.');
            return res.status(500).json({ error: 'Server configuration error: Missing OpenAI API key.' });
        }
        
        // Construct a detailed prompt for the GPT-4o model
        const prompt = createPromptForAgronomist(lat, lon, ndvi, weatherData, lang);

        // Fetch the recommendation from OpenAI
        const recommendation = await getOpenAiRecommendation(prompt, openAiApiKey);
        
        res.status(200).json({ recommendation });

    } catch (error) {
        console.error('Recommendation Generation Error:', error.message);
        res.status(500).json({ error: 'Failed to get recommendation.', details: error.message });
    }
};

// --- Helper Functions ---

/**
 * Creates a detailed prompt for the AI model based on the provided data.
 * @param {number} lat - Latitude of the location.
 * @param {number} lon - Longitude of the location.
 * @param {string} ndvi - The NDVI value for the location.
 * @param {object} weather - The weather data object.
 * @param {string} lang - The desired language for the recommendation ('kk' or 'ru').
 * @returns {string} A formatted prompt string for the OpenAI API.
 */
function createPromptForAgronomist(lat, lon, ndvi, weather, lang) {
    const language = lang === 'kk' ? 'Kazakh' : 'Russian';

    const promptContext = `You are an expert agronomist AI assistant specializing in wheat cultivation in Kazakhstan. Your task is to provide practical, actionable recommendations for a specific field. The recommendations must be in the ${language} language, be concise, and easy to understand for a farmer.`;

    const weatherSummary = `
- Current Temperature: ${weather.current.temperature_2m}°C
- Current Relative Humidity: ${weather.current.relative_humidity_2m}%
- Current Wind Speed: ${weather.current.wind_speed_10m} km/h
- 16-Day Forecast Summary:
  - Temperatures will range from ${Math.min(...weather.daily.temperature_2m_min)}°C to ${Math.max(...weather.daily.temperature_2m_max)}°C.
  - The forecast indicates periods of ${getWeatherDescription(weather.daily.weather_code)}.
`;

    const dataAnalysis = `
- Location (Latitude, Longitude): ${lat.toFixed(4)}, ${lon.toFixed(4)}
- Current NDVI (Vegetation Index): ${ndvi}
- NDVI Interpretation: An NDVI of ${ndvi} suggests ${interpretNdvi(ndvi)}.
${weatherSummary}
`;
    
    return `${promptContext}

DATA:
${dataAnalysis}

TASK:
Based on this data, provide recommendations for a wheat grower for the next 1-2 weeks. Focus on:
1.  **Irrigation:** Is it needed? When and how much?
2.  **Fertilization:** Are there signs of nutrient stress? What might be needed?
3.  **Pest/Disease Control:** Does the weather forecast indicate high risks? What to scout for?
4.  **General Management:** Any other critical advice.

Format the response clearly with headings.`;
}

/**
 * Provides a simple interpretation of an NDVI value.
 * @param {number} ndvi - The NDVI value.
 * @returns {string} A text interpretation.
 */
function interpretNdvi(ndvi) {
    if (ndvi < 0.2) return "very low plant health or bare soil.";
    if (ndvi < 0.4) return "moderate plant health, potentially under stress or in early growth.";
    if (ndvi < 0.6) return "good plant health.";
    return "very high plant health and dense canopy.";
}

/**
 * Gets a general weather description from a list of weather codes.
 * @param {number[]} codes - An array of weather codes from the forecast.
 * @returns {string} A summary of the most frequent weather condition.
 */
function getWeatherDescription(codes) {
    const codeCounts = codes.reduce((acc, code) => {
        acc[code] = (acc[code] || 0) + 1;
        return acc;
    }, {});
    const mostFrequentCode = Object.keys(codeCounts).reduce((a, b) => codeCounts[a] > codeCounts[b] ? a : b);

    const descriptions = {
        0: "clear skies", 1: "clear skies", 2: "partial clouds", 3: "clouds", 
        61: "rain", 63: "rain", 65: "heavy rain",
        80: "showers", 81: "showers", 82: "heavy showers", 95: "thunderstorms"
    };
    return descriptions[mostFrequentCode] || "varied conditions";
}

/**
 * Sends a request to the OpenAI API to get a recommendation.
 * @param {string} prompt - The prompt to send to the model.
 * @param {string} apiKey - Your OpenAI API key.
 * @returns {Promise<string>} A promise that resolves with the recommendation text.
 */
async function getOpenAiRecommendation(prompt, apiKey) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 450,
            temperature: 0.4,
        });

        const options = {
            hostname: 'api.openai.com',
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsedData = JSON.parse(data);
                        resolve(parsedData.choices[0].message.content.trim());
                    } catch (e) {
                        reject(new Error('Failed to parse OpenAI response.'));
                    }
                } else {
                    reject(new Error(`OpenAI API request failed with status ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (e) => reject(new Error(`Request to OpenAI API failed: ${e.message}`)));
        req.write(payload);
        req.end();
    });
}
