const ee = require('@google/earthengine');

// The main handler for the serverless function
module.exports = async (req, res) => {
    try {
        // Authenticate with Google Earth Engine using credentials from environment variables
        await initializeEe();

        // Define the GEE logic to create an NDVI image
        const image = getNdviImage();

        // Define visualization parameters for the map tiles
        const visParams = {
            min: -0.2, // Min NDVI value
            max: 0.8,  // Max NDVI value
            palette: ['#E3A857', '#FCDD94', '#B6D97C', '#84C065', '#45A24B', '#117A37'] // Brown to green palette
        };

        // Get the map ID from Earth Engine
        const mapId = await getMapId(image, visParams);

        // Redirect the client's request to the actual Google tile server URL
        res.redirect(mapId.urlFormat);

    } catch (error) {
        console.error('GEE Tile Error:', error);
        res.status(500).json({ error: 'Failed to generate GEE map tiles.', details: error.message });
    }
};

// --- GEE Helper Functions ---

const initializeEe = () => {
    return new Promise((resolve, reject) => {
        // Vercel environment variables are in process.env
        const privateKey = JSON.parse(process.env.GEE_PRIVATE_KEY_JSON);
        const projectId = process.env.GEE_PROJECT_ID;

        ee.data.authenticateViaPrivateKey(privateKey, 
            () => ee.initialize(null, null, resolve, reject, null, projectId),
            reject
        );
    });
};

const getNdviImage = () => {
    // Use Sentinel-2 Level-2A surface reflectance data
    const s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');

    // Function to mask clouds using the QA band
    const maskS2clouds = (image) => {
        const qa = image.select('QA60');
        const cloudBitMask = 1 << 10;
        const cirrusBitMask = 1 << 11;
        const mask = qa.bitwiseAnd(cloudBitMask).eq(0).and(qa.bitwiseAnd(cirrusBitMask).eq(0));
        return image.updateMask(mask).divide(10000); // Scale reflectance values
    };

    // Get the most recent cloud-free image
    const recentImage = s2
        .filterDate(ee.Date(Date.now()).advance(-3, 'month'), ee.Date(Date.now()))
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
        .map(maskS2clouds)
        .sort('system:time_start', false) // Sort descending to get the latest
        .first();

    // Calculate NDVI: (NIR - Red) / (NIR + Red)
    // For Sentinel-2, NIR is band B8, Red is band B4
    const ndvi = recentImage.normalizedDifference(['B8', 'B4']).rename('NDVI');
    
    return ndvi;
};

const getMapId = (image, visParams) => {
    return new Promise((resolve, reject) => {
        image.getMap(visParams, (mapId, error) => {
            if (error) {
                return reject(new Error(error));
            }
            resolve(mapId);
        });
    });
};
