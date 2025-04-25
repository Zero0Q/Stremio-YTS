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
            try {
                const info = await this.axios.get(`${this.baseUrl}/torrents/info/${id}`);
                console.log(`Torrent status (attempt ${i + 1}/${maxAttempts}):`, info.data.status);
                
                if (info.data.status === 'downloaded' || info.data.status === 'ready') {
                    return true;
                }
                if (info.data.status === 'error' || info.data.status === 'dead' || info.data.status === 'magnet_error') {
                    console.error('Torrent failed:', info.data.status);
                    return false;
                }
                // Wait 2 seconds before next check
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.error(`Error checking torrent status (attempt ${i + 1}):`, error.message);
                if (error.response) {
                    console.error('Error response:', error.response.data);
                }
            }
        }
        return false;
    }

    async addMagnet(hash) {
        try {
            // Test API key first
            console.log('Testing Real-Debrid API key...');
            const isValid = await this.testApiKey();
            if (!isValid) {
                console.error('Invalid Real-Debrid API key');
                return null;
            }

            // Convert hash to magnet link
            const magnet = `magnet:?xt=urn:btih:${hash}`;
            console.log('Adding magnet:', magnet);
            
            // Add magnet to Real-Debrid
            const addResponse = await this.axios.post(`${this.baseUrl}/torrents/addMagnet`, 
                new URLSearchParams({ magnet }).toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
            
            if (!addResponse.data || !addResponse.data.id) {
                console.error('Failed to add magnet, response:', addResponse.data);
                return null;
            }

            const torrentId = addResponse.data.id;
            console.log('Magnet added, torrent ID:', torrentId);
            
            // Get available files
            const availableFiles = await this.axios.get(`${this.baseUrl}/torrents/info/${torrentId}`);
            console.log('Available files:', availableFiles.data.files);
            
            // Select all files
            console.log('Selecting all files for download...');
            await this.axios.post(`${this.baseUrl}/torrents/selectFiles/${torrentId}`, 
                new URLSearchParams({ files: 'all' }).toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
            
            // Wait for the torrent to be processed
            console.log('Waiting for torrent to be processed...');
            const success = await this.waitForTorrent(torrentId);
            if (!success) {
                console.error('Torrent processing failed or timed out');
                return null;
            }
            
            // Get the streaming links
            console.log('Getting streaming links...');
            const links = await this.axios.get(`${this.baseUrl}/torrents/info/${torrentId}`);
            
            if (!links.data || !links.data.links || !links.data.links[0]) {
                console.error('No links available for torrent');
                return null;
            }
            
            // Unrestrict the first link
            console.log('Unrestricting link...');
            const unrestrictedLink = await this.axios.post(`${this.baseUrl}/unrestrict/link`,
                new URLSearchParams({ link: links.data.links[0] }).toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );
            
            if (!unrestrictedLink.data || !unrestrictedLink.data.download) {
                console.error('Failed to unrestrict link');
                return null;
            }

            console.log('Successfully generated streaming URL');
            return unrestrictedLink.data.download;
        } catch (error) {
            console.error('Real-Debrid error:', error.message);
            if (error.response) {
                console.error('Error response:', error.response.data);
            }
            return null;
        }
    }

    async testApiKey() {
        try {
            const response = await this.axios.get(`${this.baseUrl}/user`);
            console.log('API key is valid, username:', response.data.username);
            return true;
        } catch (error) {
            console.error('API key test failed:', error.message);
            if (error.response) {
                console.error('Error response:', error.response.data);
            }
            return false;
        }
    }
}

module.exports = RealDebrid;