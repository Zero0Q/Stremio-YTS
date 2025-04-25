#!/usr/bin/env node
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const { serveHTTP } = require("stremio-addon-sdk");
const addonInterface = require("./addon");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

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
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving config:', error);
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// Set initial RD_API_KEY from config or environment
process.env.RD_API_KEY = process.env.RD_API_KEY || config.rdApiKey;

// Start the combined server (both addon and config on same port for Heroku)
app.listen(PORT, () => {
    console.log(`Configuration page available at: /config.html`);
    // Serve the Stremio addon on the same Express server
    serveHTTP(addonInterface, { port: PORT, server: app });
    console.log(`Server running on port ${PORT}`);
});
