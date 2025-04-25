const axios = require('axios');

class RealDebrid {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.real-debrid.com/rest/1.0';
        this.axios = axios.create({
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
    }

    async waitForTorrent(id, maxAttempts = 10) {
        for (let i = 0; i < maxAttempts; i++) {
            const info = await this.axios.get(`${this.baseUrl}/torrents/info/${id}`);
            if (info.data.status === 'downloaded') {
                return true;
            }
            if (info.data.status === 'error' || info.data.status === 'dead' || info.data.status === 'magnet_error') {
                console.error('Torrent failed:', info.data.status);
                return false;
            }
            // Wait 2 seconds before next check
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        return false;
    }

    async addMagnet(hash) {
        try {
            // Convert hash to magnet link
            const magnet = `magnet:?xt=urn:btih:${hash}`;
            
            // Add magnet to Real-Debrid
            const addResponse = await this.axios.post(`${this.baseUrl}/torrents/addMagnet`, {
                magnet: magnet
            });
            
            // Select all files for download
            await this.axios.post(`${this.baseUrl}/torrents/selectFiles/${addResponse.data.id}`, {
                files: 'all'
            });
            
            // Wait for the torrent to be processed
            const success = await this.waitForTorrent(addResponse.data.id);
            if (!success) {
                console.error('Torrent processing failed or timed out');
                return null;
            }
            
            // Get the streaming link
            const links = await this.axios.get(`${this.baseUrl}/torrents/links/${addResponse.data.id}`);
            if (!links.data || !links.data[0]) {
                console.error('No links available for torrent');
                return null;
            }
            
            // Unrestrict the link to get the final streaming URL
            const unrestrictedLink = await this.axios.post(`${this.baseUrl}/unrestrict/link`, {
                link: links.data[0]
            });
            
            return unrestrictedLink.data.download;
        } catch (error) {
            console.error('Real-Debrid error:', error.message);
            return null;
        }
    }

    async testApiKey() {
        try {
            await this.axios.get(`${this.baseUrl}/user`);
            return true;
        } catch (error) {
            return false;
        }
    }
}

module.exports = RealDebrid;