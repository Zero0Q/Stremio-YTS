const { addonBuilder } = require('stremio-addon-sdk');
const request = require('request');
const myCache = require('./cache');
const utils = require('./utils');
const package = require('./package.json');
const RealDebrid = require('./realdebrid');

const endpoint = 'https://yts.mx';
const oneHour = 60 * 60; // in seconds

const cache = {
    maxAge: oneHour, // 1 hour
    staleError: 6 * 30 * oneHour // 6 months
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
    const query = { query_term: imdb };
    const ytsUrl = endpoint + '/api/v2/list_movies.json/?' + utils.serialize(query);

    console.log(`Fetching YTS metadata for IMDb ID: ${imdb} using URL: ${ytsUrl}`);

    // Step 1: Get YTS data (cached or fresh) using cachedRequest
    const ytsItemData = await new Promise((resolve, reject) => {
        cachedRequest(ytsUrl, (data) => {
            try {
                const jsonObject = JSON.parse(data)['data']['movies'];
                const item = (jsonObject || []).find(el => el.imdb_code === imdb);
                if (!item) {
                    console.error(`No YTS metadata found for IMDb ID: ${imdb}`);
                    // Reject specifically for not found, allows differentiating errors
                    reject(new Error(`No YTS metadata found for IMDb ID: ${imdb}`));
                } else {
                    console.log(`Successfully fetched YTS metadata for IMDb ID: ${imdb}`);
                    resolve(item); // Resolve with just the relevant movie item
                }
            } catch (error) {
                console.error(`Error parsing YTS metadata response for ${imdb}:`, error);
                reject('Error parsing metadata response: ' + error.message);
            }
        }, (error) => {
            console.error(`Error fetching YTS metadata for ${imdb}:`, error);
            reject('Error fetching metadata: ' + error);
        });
    }); // If this rejects, the promise chain stops here, which is correct.

    // Step 2: Process torrents and generate RD links (if applicable)
    // This part runs *after* ytsItemData is successfully retrieved (from cache or API)
    const qualityOrder = {
        '2160p': 4,
        '1080p': 3,
        '720p': 2,
        '480p': 1
    };

    // Sort torrents by quality
    const sortedTorrents = ytsItemData.torrents.sort((a, b) => {
        const qualityA = qualityOrder[a.quality] || 0;
        const qualityB = qualityOrder[b.quality] || 0;
        return qualityB - qualityA;
    });

    let streams = [];
    if (rdClient) {
        console.log(`Real-Debrid enabled for ${imdb}, converting torrents to streams`);
        // Use Promise.allSettled to attempt all conversions and gather results
        const rdResults = await Promise.allSettled(sortedTorrents.map(async (torrent) => {
            try {
                const streamUrl = await rdClient.addMagnet(torrent.hash.toLowerCase());
                if (streamUrl) {
                    return { // Return stream object on success
                        title: `🌟 RD ${utils.capitalize(torrent.type)} / ${torrent.quality}, Size: ${torrent.size}`,
                        url: streamUrl
                    };
                } else {
                    // If addMagnet returns null/undefined but doesn't throw
                    console.warn(`Real-Debrid returned no stream URL for torrent hash: ${torrent.hash}`);
                    return null;
                }
            } catch (error) {
                console.error(`Real-Debrid conversion failed for torrent hash ${torrent.hash}:`, error);
                return null; // Return null on error for this specific torrent
            }
        }));

        // Filter out failed/null results and add successful streams
        streams = rdResults
            .filter(result => result.status === 'fulfilled' && result.value)
            .map(result => result.value);

        if (streams.length === 0) {
            console.log(`No Real-Debrid streams could be generated for ${imdb}`);
            // It's not an error state for the addon, just no RD links found/generated
        } else {
             console.log(`Generated ${streams.length} Real-Debrid streams for ${imdb}`);
        }
    } else {
        console.log(`Real-Debrid not configured for ${imdb}, skipping RD stream generation.`);
        // No RD client, streams array remains empty
    }

    // Step 3: Return the final stream list
    // Stremio will cache this response based on cacheMaxAge.
    // The YTS data itself is cached separately by cachedRequest.
    return {
        streams,
        cacheMaxAge: cache.maxAge, // Use the configured cache duration (1 hour) for Stremio's cache of this response
        staleError: cache.staleError
    };
    // No explicit catch here, errors from the Promise or rdClient calls will propagate
    // and cause the defineStreamHandler to reject, which is the expected behavior.
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
