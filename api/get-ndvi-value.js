const ee = require('@google/earthengine');

// Main handler for the serverless function
module.exports = async (req, res) => {
    // Set CORS headers to allow requests from any origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    try {
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);

        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ error: 'Invalid or missing coordinates.' });
        }
        
        // Authenticate with GEE
        await authenticateAndInitialize();
        
        // Run the optimized analysis
        const data = await runAnalysis(lat, lon);
        
        res.status(200).json(data);

    } catch (error) {
        console.error('GEE Value Error:', error.message);
        res.status(500).json({ error: error.message || 'An internal server error occurred.' });
    }
};

// --- GEE Helper Functions (Optimized) ---

// Promisified authentication and initialization
const authenticateAndInitialize = () => new Promise((resolve, reject) => {
    const privateKey = JSON.parse(process.env.GEE_PRIVATE_KEY_JSON);
    const projectId = process.env.GEE_PROJECT_ID;

    ee.data.authenticateViaPrivateKey(privateKey, 
        () => ee.initialize(null, null, resolve, reject, null, projectId),
        (err) => reject(new Error(`GEE Authentication failed: ${err}`))
    );
});

// Promisified analysis function, based on your efficient example
const runAnalysis = (lat, lon) => new Promise((resolve, reject) => {
    const point = ee.Geometry.Point([lon, lat]);
    const s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');

    // Function to mask clouds
    const maskS2clouds = (image) => {
        const qa = image.select('QA60');
        const cloudBitMask = 1 << 10;
        const cirrusBitMask = 1 << 11;
        const mask = qa.bitwiseAnd(cloudBitMask).eq(0).and(qa.bitwiseAnd(cirrusBitMask).eq(0));
        return image.updateMask(mask).divide(10000);
    };

    // **CRITICAL OPTIMIZATION**: Filter images by the point of interest first.
    const image = s2
        .filterBounds(point)
        .filterDate(ee.Date(Date.now()).advance(-120, 'day'), ee.Date(Date.now()))
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
        .map(maskS2clouds)
        .sort('system:time_start', false) // Get the most recent
        .first();

    // Pre-flight check: Ensure an image was found before doing more work
    image.get('system:index').evaluate((id, err) => {
        if (err || !id) {
            return reject(new Error('No recent cloud-free image found for this location.'));
        }

        const ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
        
        const ndviValue = ndvi.reduceRegion({
            reducer: ee.Reducer.first(), // Use 'first' for a single point
            geometry: point,
            scale: 10
        }).get('NDVI');

        // Evaluate the final value
        ndviValue.evaluate((result, error) => {
            if (error) {
                reject(new Error(`GEE Evaluation Error: ${error}`));
            } else if (result === null || typeof result === 'undefined') {
                reject(new Error('Point may be in water or an area with no data.'));
            } else {
                resolve({ ndvi: result });
            }
        });
    });
});

