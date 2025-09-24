const ee = require('@google/earthengine');
const https = require('https');
const url = require('url');

// Main handler for the serverless function
module.exports = async (req, res) => {
    try {
        await authenticateAndInitialize();

        // Get an NDVI image, now optimized to search a smaller region
        const image = getNdviImage();

        const visParams = {
            min: -0.2, max: 0.8,
            palette: ['#E3A857', '#FCDD94', '#B6D97C', '#84C065', '#45A24B', '#117A37']
        };

        const mapId = await getMapId(image, visParams);
        
        // The URL format from getMapId contains {x}, {y}, {z} placeholders.
        // We replace them with the actual values from the request query.
        const { x, y, z } = req.query;
        const tileUrl = mapId.urlFormat.replace('{x}', x).replace('{y}', y).replace('{z}', z);

        // Proxy the tile request from Google's servers to the client.
        const parsedUrl = url.parse(tileUrl);

        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.path,
            method: 'GET',
            headers: { 'User-Agent': req.headers['user-agent'] }
        };

        const proxyReq = https.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
        });

        req.pipe(proxyReq, { end: true });

        proxyReq.on('error', (e) => {
            console.error('Proxy request error:', e);
            res.status(500).send('Failed to proxy tile request');
        });

    } catch (error) {
        console.error('GEE Tile Error:', error.message);
        res.status(500).json({ error: 'Failed to generate GEE map tiles.', details: error.message });
    }
};

// --- GEE Helper Functions (Optimized) ---

const authenticateAndInitialize = () => new Promise((resolve, reject) => {
    const privateKey = JSON.parse(process.env.GEE_PRIVATE_KEY_JSON);
    const projectId = process.env.GEE_PROJECT_ID;

    ee.data.authenticateViaPrivateKey(privateKey, 
        () => ee.initialize(null, null, resolve, reject, null, projectId),
        (err) => reject(new Error(`GEE Authentication failed: ${err}`))
    );
});

const getNdviImage = () => {
    const regionOfInterest = ee.Geometry.Rectangle([45, 40, 90, 56]); // Central Asia
    const s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');

    const maskS2clouds = (image) => {
        const qa = image.select('QA60');
        const cloudBitMask = 1 << 10;
        const cirrusBitMask = 1 << 11;
        const mask = qa.bitwiseAnd(cloudBitMask).eq(0).and(qa.bitwiseAnd(cirrusBitMask).eq(0));
        return image.updateMask(mask).divide(10000);
    };

    const recentImage = s2
        .filterBounds(regionOfInterest)
        .filterDate(ee.Date(Date.now()).advance(-120, 'day'), ee.Date(Date.now()))
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
        .map(maskS2clouds)
        .sort('system:time_start', false)
        .first();

    return recentImage.normalizedDifference(['B8', 'B4']).rename('NDVI');
};

const getMapId = (image, visParams) => new Promise((resolve, reject) => {
    image.getMap(visParams, (mapId, error) => {
        if (error) return reject(new Error(error));
        resolve(mapId);
    });
});
