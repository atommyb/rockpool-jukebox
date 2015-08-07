var request = require('request');
var cheerio = require('cheerio');
var config = require('../config');
var search = require('youtube-search');

function fetchOpenGraph(url, next) {
	request(url, function(err, resp, body) {
		if (err) return next(err);

		var openGraph = {};

		try {
			var $ = cheerio.load(body);
			$('meta[property^=og]').each(function(i, elem) {
				var content = $(elem).attr('content');
				var propName = $(elem).attr('property');
				openGraph[propName.substring(3)] = content;
			});
		} catch (e) {
			return next(e);
		}

		next(null, openGraph);
	});
}

function lookupTrack(url, next) {
	if (url.indexOf('spotify:track') === 0) {
		return querySpotifyTrack(url, next);
	}

	fetchOpenGraph(url, function(err, openGraph) {
		if (err) return next(err);

		var data = {};

		data.title = openGraph.title || "";
		data.description = openGraph.description || "";
		data.image = openGraph.image || "";
		data.url = openGraph.url || "";
		data.openGraph = openGraph;
		data.type = openGraph.site_name || "";
		next(null, data);
	});
};

function searchYoutube(q, next) {

  var opts = {
    type: 'video',
    maxResults: 10,
    key: config.GOOGLE_API_KEY,
    videoEmbeddable: true,
    videoCategoryId: 10
  };

  search(q, opts, function(err, results) {

    if (err) { return next(err) ; }

    try {

      // need to combine with VIEWS for each result
      // needs to be a new request per result :-S
			var filtered = (results || []).map(function(e) {
				return {
					title : e.title,
					url : e.link,
					image : e.thumbnails.default.url
				};
			});
			return next(null, filtered.slice(0 ,15));
		} catch (e) {
			return next(e);
		}
	});
}

function querySpotifyTrack(uri, next) {
	var apiUrl = 'http://ws.spotify.com/lookup/1/.json?uri=' + encodeURIComponent(uri);

	request(apiUrl, function(err, resp, body) {
		if (err) return next(err);
		if (resp.statusCode !== 200) {
			console.log(resp.body);
			return next(new Error("Spotify service returned status " + resp.statusCode));
		}

		var data = {},  openGraph = {};
		var track;

		try {
			track = JSON.parse(body).track;
		} catch (e) {
			return next(e);
		}

		data.artists = track.artists.map(function(a) { return a.name; });
		data.title = track.name + ' - ' + data.artists.join(', ');
		data.image = '/img/spotify-logo-450-square.jpg';
		data.views = track.popularity;
		data.url = track.href;
		data.openGraph = openGraph;
		data.type = 'Spotify';
		var albumUri = track.album.href;
		if (albumUri) {
			var ogUrl = "http://open.spotify.com/album/" + albumUri.replace(/^spotify:album:/i, '');
			fetchOpenGraph(ogUrl, function(err, og) {
				if (!err) {
					data.image = og.image;
				}
				next(err, data);
			});
		} else {
			next(null, data);
		}
	});
}

function searchSpotify(q, next) {
	var territory ='GB';
	var url = 'http://ws.spotify.com/search/1/track.json?q=' + encodeURIComponent(q);
	request(url, function(err, resp, body) {
		//console.log(resp.statusCode);
		if (err) { return next(err) ; }

		//not sure we need this or whether err would be set for none-ok codes
		if (resp.statusCode !== 200) {
			return next(new Error("Spotify returned status " + resp.statusCode));
		}

		try {
			var data = JSON.parse(body);
			var filtered = data.tracks
			.filter(function(e) {
				return e.album.availability.territories === "worldwide"
									|| e.album.availability.territories.indexOf(territory) !== -1
			})
			.map(function(e) {
				var artists = e.artists.map(function(a) { return a.name; });
				//console.log(artists);
				return {
					title : e.name + ' - ' + artists.join(', '),
					album : e.album.name,
					url : e.href,
					artists : artists,
					image : '/img/spotify-logo-450-square.jpg',
					views : e.popularity
				};
			})
			.slice(0, 15);
			return next(null, filtered);
		} catch (e) {
			return next(e);
		}
	});
}



module.exports = {
	searchSpotify : searchSpotify,
	searchYoutube : searchYoutube,
	lookupTrack : lookupTrack
};
