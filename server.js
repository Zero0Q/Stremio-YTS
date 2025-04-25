#!/usr/bin/env node
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const addonInterface = require("./addon");
const { initializeRealDebrid } = require('./addon');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// Root redirect to config page
app.get('/', (req, res) => {
    res.redirect('/config.html');
});

// Load configuration
let config = {};
const configFile = process.env.CONFIG_FILE || 'config.json';
const configPath = path.join(__dirname, configFile);

try {
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
} catch (error) {
    console.error('Error loading config:', error);
}

// Configuration endpoints
app.get('/config', (req, res) => {
    res.json(config);
});

app.post('/config', async (req, res) => {
    try {
        const { rdApiKey } = req.body;
        
        // Save configuration
        config = { rdApiKey };
        
        // In production (Heroku), use environment variable instead of file
        if (process.env.NODE_ENV === 'production') {
            process.env.RD_API_KEY = rdApiKey;
        } else {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        }

        // Initialize Real-Debrid client with new API key
        initializeRealDebrid(rdApiKey);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving config:', error);
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// Cache clear endpoint
app.post('/clear-cache', (req, res) => {
    try {
        const myCache = require('./cache');
        myCache.clear();
        console.log('Cache cleared successfully');
        res.json({ success: true, message: 'Cache cleared successfully' });
    } catch (error) {
        console.error('Error clearing cache:', error);
        res.status(500).json({ error: 'Failed to clear cache' });
    }
});

// Add Stremio addon routes
const { getRouter } = require('stremio-addon-sdk');
const addonRouter = getRouter(addonInterface);
app.use((req, res, next) => {
    addonRouter(req, res, next);
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Configuration page available at: /config.html`);
    console.log(`Addon manifest available at: /manifest.json`);
});
