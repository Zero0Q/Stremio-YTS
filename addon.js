const { addonBuilder } = require('stremio-addon-sdk');
const request = require('request');
const myCache = require('./cache');
const utils = require('./utils');
const package = require('./package.json');
const RealDebrid = require('./realdebrid');

const endpoint = 'https://yts.mx';
const oneDay = 24 * 60 * 60; // in seconds

const cache = {
    maxAge: 1.5 * oneDay, // 1.5 days
    staleError: 6 * 30 * oneDay // 6 months
};

// Implement cached request function
function cachedRequest(url, callback, errorCallback) {
    const cached = myCache.get(url);
    if (cached) {
        callback(cached);
        return;
    }

    request(url, (error, response, body) => {
        if (error) {
            errorCallback(error);
            return;
        }

        if (response.statusCode !== 200) {
            errorCallback(new Error(`HTTP ${response.statusCode}`));
            return;
        }

        myCache.set(url, body, cache.maxAge);
        callback(body);
    });
}

// Real-Debrid configuration
let rdClient = null;

// Function to initialize/reinitialize Real-Debrid client
function initializeRealDebrid(apiKey) {
    console.log('Initializing Real-Debrid client with API key:', apiKey ? '[HIDDEN]' : 'none');
    rdClient = apiKey ? new RealDebrid(apiKey) : null;
    return rdClient;
}

// Initialize with environment variable
initializeRealDebrid(process.env.RD_API_KEY);

const manifest = {
    id: 'community.yts',
    logo: 'https://i2.wp.com/fosslovers.com/wp-content/uploads/2019/01/YTS-logo.png',
    version: package.version,
    catalogs: [
        {
            type: 'movie',
            id: 'yts',
            name: 'YTS',
            extra: [
                {
                    name: 'genre',
                    options: ['Action','Adventure','Animation','Biography','Comedy','Crime','Documentary','Drama','Family','Fantasy','Film Noir','History','Horror','Music','Musical','Mystery','Romance', 'Sci-Fi', 'Short', 'Sport', 'Thriller', 'War', 'Western'],
                    isRequired: false
                }
            ]
        }
    ],
    resources: ['catalog', 'stream'],
    types: ['movie'],
    name: 'YTS',
    description: 'YTS Movies catalog with Real-Debrid support. Configure Real-Debrid at: https://yes-movies-catalog-59a8b3211813.herokuapp.com/config.html',
    idPrefixes: ['tt']
};

function getMovies(page, cat = false) {
    return new Promise((resolve, reject) => {
        const query = {
            genre: cat,
            limit: 50,
            order_by: 'year',
            sort_by: 'desc',
            page
        };

        console.log('Making API request with query:', query);
        cachedRequest(endpoint + '/api/v2/list_movies.json?' + utils.serialize(query), (data) => {
            const jsonObject = JSON.parse(data)['data']['movies'];

            const metas = (jsonObject || []).map(item => ({
                id: item.imdb_code,
                name: item.title,
                poster: item.large_cover_image,
                background: item.background_image_original,
                year: item.year,
                releaseInfo: item.year,
                language: item.language,
                imdbRating: item.rating,
                runtime: item.runtime + 'm',
                genres: item.genres,
                type: 'movie'
            }));

            resolve({
                metas,
                cacheMaxAge: cache.maxAge,
                staleError: cache.staleError
            });
        }, reject);
    });
}

async function getStreams(imdb) {
    return new Promise((resolve, reject) => {
        const query = { query_term: imdb };

        console.log(`Fetching streams with query: ${JSON.stringify(query)}`);
        cachedRequest(endpoint + '/api/v2/list_movies.json/?' + utils.serialize(query), async (data) => {
            try {
                const jsonObject = JSON.parse(data)['data']['movies'];
                const item = (jsonObject || []).find(el => el.imdb_code === imdb);

                if (!item) {
                    console.error(`No metadata found for IMDb ID: ${imdb}`);
                    return reject('No metadata was found!');
                }

                const qualityOrder = {
                    '2160p': 4,
                    '1080p': 3,
                    '720p': 2,
                    '480p': 1
                };

                // Sort torrents by quality
                const sortedTorrents = item.torrents.sort((a, b) => {
                    const qualityA = qualityOrder[a.quality] || 0;
                    const qualityB = qualityOrder[b.quality] || 0;
                    return qualityB - qualityA;
                });

                // Process through Real-Debrid if configured
                const streams = [];
                if (rdClient) {
                    console.log('Real-Debrid enabled, converting torrents to streams');
                    for (const torrent of sortedTorrents) {
                        try {
                            const streamUrl = await rdClient.addMagnet(torrent.hash.toLowerCase());
                            if (streamUrl) {
                                streams.push({
                                    title: `🌟 RD ${utils.capitalize(torrent.type)} / ${torrent.quality}, Size: ${torrent.size}`,
                                    url: streamUrl
                                });
                            }
                        } catch (error) {
                            console.error('Real-Debrid conversion failed:', error);
                        }
                    }
                } else {
                    console.log('Real-Debrid not configured, using regular torrent streams');
                }

                // Add regular torrent streams as fallback
                const torrentStreams = sortedTorrents.map(el => ({
                    title: utils.capitalize(el.type) + ' / ' + el.quality + ', S: ' + el.seeds + ' L: ' + el.peers + ', Size: ' + el.size,
                    infoHash: el.hash.toLowerCase()
                }));

                streams.push(...torrentStreams);

                resolve({
                    streams,
                    cacheMaxAge: cache.maxAge,
                    staleError: cache.staleError
                });
            } catch (error) {
                reject('Error parsing metadata response: ' + error.message);
            }
        }, (error) => {
            reject('Error fetching metadata: ' + error);
        });
    });
}

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(args => {
    const start = (args.extra || {}).skip ? Math.round(args.extra.skip / 50) + 1 : 1;
    const cat = (args.extra || {}).genre ? args.extra.genre : false;
    return getMovies(start, cat);
});

builder.defineStreamHandler(args => {
    return getStreams(args.id);
});

module.exports = {
    ...builder.getInterface(),
    initializeRealDebrid
};
