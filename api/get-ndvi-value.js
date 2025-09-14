const ee = require('@google/earthengine');

module.exports = async (req, res) => {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
        return res.status(400).json({ error: 'Latitude (lat) and Longitude (lng) are required.' });
    }

    try {
        await initializeEe();

        // Get the same NDVI image as the tile server
        const image = getNdviImage();
        
        // Define the point of interest
        const point = ee.Geometry.Point(parseFloat(lng), parseFloat(lat));

        // Use reduceRegion to get the value at that point
        const data = image.reduceRegion({
            reducer: ee.Reducer.mean(),
            geometry: point,
            scale: 10 // Sentinel-2 resolution in meters
        }).get('NDVI');

        // Evaluate the result from GEE servers
        const result = await evaluate(data);

        res.status(200).json({ ndvi: result });

    } catch (error) {
        console.error('GEE Value Error:', error);
        res.status(500).json({ error: 'Failed to get GEE value.', details: error.message });
    }
};

// --- GEE Helper Functions (Identical to the tile server) ---

const initializeEe = () => {
     return new Promise((resolve, reject) => {
        const privateKey = JSON.parse(process.env.GEE_PRIVATE_KEY_JSON);
        const projectId = process.env.GEE_PROJECT_ID;
        ee.data.authenticateViaPrivateKey(privateKey, 
            () => ee.initialize(null, null, resolve, reject, null, projectId),
            reject
        );
    });
};

const getNdviImage = () => {
    const s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');
    const maskS2clouds = (image) => {
        const qa = image.select('QA60');
        const cloudBitMask = 1 << 10;
        const cirrusBitMask = 1 << 11;
        const mask = qa.bitwiseAnd(cloudBitMask).eq(0).and(qa.bitwiseAnd(cirrusBitMask).eq(0));
        return image.updateMask(mask).divide(10000);
    };
    return s2
        .filterDate(ee.Date(Date.now()).advance(-3, 'month'), ee.Date(Date.now()))
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
        .map(maskS2clouds)
        .sort('system:time_start', false)
        .first()
        .normalizedDifference(['B8', 'B4']).rename('NDVI');
};

// Helper to promisify ee.data.computeValue
const evaluate = (data) => {
    return new Promise((resolve, reject) => {
        data.evaluate((result, error) => {
            if (error) {
                return reject(new Error(error));
            }
            resolve(result);
        });
    });
};
