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
            const info = await this.axios.get(`${this.baseUrl}/torrents/info/${addResponse.data.id}`);
            
            // Get the streaming link
            const links = await this.axios.get(`${this.baseUrl}/torrents/links/${addResponse.data.id}`);
            
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