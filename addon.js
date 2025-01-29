const { addonBuilder } = require('stremio-addon-sdk');
const request = require('request');
const myCache = require('./cache');
const utils = require('./utils');
const package = require('./package.json');

const endpoint = 'https://yts.mx';
const oneDay = 24 * 60 * 60; // in seconds

const cache = {
    maxAge: 1.5 * oneDay, // 1.5 days
    staleError: 6 * 30 * oneDay // 6 months
};

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
    description: 'Movies and torrent results from YTS',
    idPrefixes: ['tt']
};

function cachedRequest(url, callback, reject) {
    let data = myCache.get(url);
    if (data) {
        callback(data);
    } else {
        request(url, function(error, response, data) {
            if (error || !data || response.statusCode != 200) {
                reject('Invalid response from API for category: ' + (cat || 'top') + ' / page: ' + page);
                return;
            }
            myCache.set(url, data, 432000);
            callback(data);
        });
    }
}

function getMovies(page, cat = false) {
    return new Promise((resolve, reject) => {
        const query = {
            genre: cat,
            limit: 50,
            sort_by: 'seeds',
            page
        };

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
        });
    });
}

function getStreams(imdb) {
    return new Promise((resolve, reject) => {
        const query = { query_term: imdb };

        console.log(`Fetching streams with query: ${JSON.stringify(query)}`);
        cachedRequest(endpoint + '/api/v2/list_movies.json/?' + utils.serialize(query), (data) => {
            try {
                const jsonObject = JSON.parse(data)['data']['movies'];
                console.log(`Streams data received: ${JSON.stringify(jsonObject)}`);

                const item = (jsonObject || []).find(el => el.imdb_code === imdb);

                if (!item) {
                    console.error(`No metadata found for IMDb ID: ${imdb}`);
                    return reject('No metadata was found!');
                }

                let streams = item.torrents.map(el => ({
                    title: utils.capitalize(el.type) + ' / ' + el.quality + ', S: ' + el.seeds + ' L: ' + el.peers + ', Size: ' + el.size,
                    infoHash: el.hash.toLowerCase()
                }));

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

module.exports = builder.getInterface();
