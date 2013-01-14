var mongo = require('mongodb');//, Server = mongo.Server, Db = mongo.Db;
var BSON = mongo.BSONPure;
var request = require('request');
var cheerio = require('cheerio');
var search = require('../lib/search.js');
//todo : pull this out into a shared library used by search.js also
function querySpotify(uri, next) {
	var apiUrl = 'http://ws.spotify.com/lookup/1/.json?uri=' + encodeURIComponent(uri);
	//console.log(apiUrl);
	request(apiUrl, function(err, resp, body) {
		if (err) return next(err);
		if (resp.statusCode !== 200) {
			return next(new Error("Spotify service returned " + resp.statusCode));
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
			//console.log(ogUrl);
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

function queryMedia(url, next) {
	if (url.indexOf('spotify:track') === 0) {
		return querySpotify(url, next);
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
		//console.log(data);
		next(null, data);
	});		
};


function processResult(item, user) {
	//console.log(item.plays );
	var playCount =  item.plays ? item.plays.length : 0;

	var lastPlayed = item.plays && item.plays.length > 0 ?
									item.plays.pop() : null;

	//check whether date vs object
	if (lastPlayed && !lastPlayed.getMonth) {
		lastPlayed = lastPlayed.when;
	}
	//console.log(item);
	var result = {
		_id : item._id,
		streamId: item.streamId,
		title: item.title,
		description : item.description,
		url : item.url,
		image: item.image,
		openGraph : item.openGraph,
		created : item.created,
		lastRequested : item.lastRequested || item.created,
		totalVotes : item.totalVotes,
		historicVotes : item.historicVotes || 0,
		previousPlays : playCount,
		currentVote: 0,
		lastPlayed : lastPlayed,
		type: item.type
	};

	if (!result.type&& result.url.indexOf("spotify:") === 0) {
		result.type = "Spotify";
	}

  if (item.votes && user) {
  	for (var i=0;i<item.votes.length;i++) {
  		if (item.votes[i].userId.equals(user._id)) {
  			result.currentVote = item.votes[i].weight;
  			break;
  		}
  	}
  }

	return result;
};

function buildItemQuery(req, defaults) {
	var q = defaults || {};
	q.streamId = new BSON.ObjectID(req.params.streamId);

	if (typeof(req.query.played) !== "undefined") {
		q.played = req.query.played === "true";
	};

	if (typeof(req.query.minVotes) !== "undefined") {
		var num = parseInt(req.query.minVotes);
		if (!isNaN(num)) {
			q.totalVotes = { $gte : num };
		}
	};

	if (typeof(req.query.age) !== "undefined") {
		var age = parseInt(req.query.age) ;
		if (!isNaN(age)) {
			q.lastRequested = { $lte : new Date(age) };
		}
	}
	return q;
}

module.exports = function(db, notifications) {
	return {
		stream : function(req,res,next){
			res.send(req.params.name);
		},

		streams: function(req, res, next) {
			var collection = db.collection('streams');

			if (req.params.id) {
				collection.findOne({ _id : new BSON.ObjectID(req.params.id) }, function(err, result) {
					if (err) return next(err);
					res.send(result);
				});
			} else {
				collection.find().toArray(function(err, result) {
			 		if (err) return next(err);
					//res.render('streams', { streams : result});
					res.send(result);
				});
			}
		},

		streamAdd : function(req, res, next) {
			var collection = db.collection('streams');
			if (!req.body.name)
			{
				res.send(400); 
				return;
			}

			var item = {
				name: req.body.name,
				created : new Date()
			};

			collection.insert(item, function(err, docs) {
				if (err) return next(err);
				res.send(docs[0]);
			});		
		},

		itemNewLookup : function(req, res, next) {
			var url = req.query.url;
			if (!url) {
				res.send(400);
				return;
			}
			
			queryMedia(url, function(err, data) {
				if (err) return next(err);

				if ([ 'YouTube', 'SoundCloud', 'Vimeo' ].indexOf(data.openGraph.site_name) == -1) {
					res.send(400);
				} else {
					res.send(data);
				}
			});
		},

		searchMedia: function(req, res, next) {
			if (!req.query.q) {
				return res.send(400);
			}
			
			var prefixes = {
				sp : search.querySpotify,
				yt : search.queryYoutube
			};

			function executeSearch(prefix, q) {
				//console.log("executeSearch", prefix, q);
				var func;
				if (prefix && prefixes[prefix]) {
					//console.log("good");
					func = prefixes[prefix];
				} else {
					func = prefixes.yt;
				}

				func(q, function(err, data) {
					if (err) return next(err);
					res.send(data);
				})
			}

			var func;
			var m = /^([a-z]{2})\s/.exec(req.query.q);
			if (m) {
				executeSearch(m[1], req.query.q.slice(3));				
			} else {
				if (req.params.streamId) {
					db.collection('streams')
					.findOne(
						{ _id : new BSON.ObjectID(req.params.streamId) },
					  function(err, result) {
					  	//console.log(result)
							if (err) return next(err);
							executeSearch(result.defaultSearchIdentifier, req.query.q);
						}
					);
				} else {
					executeSearch(null, req.query.q);
				}
			}			
		}, 

		itemAdd : function(req, res, next) {
			if (!req.body.url || !req.params.streamId) {
				res.send(400); 
				return;
			}

			var collection = db.collection('items');
			var now = new Date();

			function createNew(data) {
				var item = {
					streamId: new BSON.ObjectID(req.params.streamId),
					title: data.title,
					description : data.description,
					url : data.url,
					image: data.image,
					openGraph : data.openGraph,
					votes : [],
					created : now,
					lastRequested : now,
					played : false,
					totalVotes : 0,
					historicVotes : 0,
					plays : [],
					type : data.type
				};

				collection.insert(item, function(err, docs) {
					if (err) return next(err);
					var toSend = processResult(docs[0], req.user);
					res.send(toSend);
					notifications.notifyAdd(toSend);
				});	
			}

			function updateExisting(item) {
				if (!item.played) {
					return res.send(400, "Duplicate");
				}

				collection.findAndModify({
					_id : item._id
				}, [['_id','desc']], {
					$set: {
						played: false,
						lastRequested : now 
					}
				},{
					"new" : true
				}, function(err, item) {
					if (err) return next(err);
					var toSend = processResult(item, req.user);
					res.send(toSend);
					notifications.notifyAdd(toSend);
				});
			}

			queryMedia(req.body.url, function (err, data) {
				//console.log(err,data);
				if (err) return next(err);
				if (typeof(data.url) === "undefined") {
					return res.send(404, "URL not returned");
				}

				if (!data.title) {
					return res.send(404, "Title not returned");
				}
				collection.findOne({
					streamId: new BSON.ObjectID(req.params.streamId),
					url : data.url
				}, function(err, item) {
					//console.log(item);
					if (item) {
						//console.log("found");
						updateExisting(item);
					} else {
						//console.log("not found");
						createNew(data);
					}
				});
			});
		},

		itemRemove: function(req, res, next) {
			if (!req.params.id || !req.params.streamId) {
				res.send(400); return;
			}

			db.collection('items')
			.findAndModify({ 
				streamId : new BSON.ObjectID(req.params.streamId), 
				_id : new BSON.ObjectID(req.params.id) 
			}, [['_id','asc']], {}, {
				remove: true
			}, function(err, result) {
				if(err) return next(err);
				if (!result) return res.send(404);
				//todo
				//console.log(result);
				notifications.notifyRemove(result);
				res.send(200);
			});
		},

		itemFindActiveByStream: function(req, res, next) {
			if (!req.params.streamId) {
				res.send(400); return;
			}
			
			var q = buildItemQuery(req, {
				played:  false
			});

			db.collection('items')
			.find(q)
			.sort({ totalVotes: -1, lastRequested: 1})
			.toArray(function(err, result) {
				if (err) return next(err);
				res.send(result.map(function(i) { return processResult(i, req.user); }));
			});
		},

		itemFindHistoric: function(req, res, next) {
			if (!req.params.streamId) {
				res.send(400); return;
			}
			
			var q = buildItemQuery(req, {
				played:  true
			});

			db.collection('items')
			.find(q)
			.sort({ lastPlayVotes: -1, lastRequested: 1 })
			.limit(10)
			.toArray(function(err, result) {
				if (err) return next(err);
				res.send(result.map(function(i) { return processResult(i, req.user); }));
			});
		},

		itemFindOldest: function(req, res, next) {
			if (!req.params.streamId) {
				res.send(400); return;
			}
			
			var q = buildItemQuery(req);

			db.collection('items')
			.find(q)
			.sort({ created: 1, lastRequested: 1 }) 
			.limit(1)
			.toArray(function(err, result) {
				if (err) return next(err);
				if (result.length === 0) return res.send(404);
				res.send(processResult(result[0], req.user));
			});
		},

		itemCount : function(req, res, next) {
			if (!req.params.streamId) {
				res.send(400); return;
			}

			var q= buildItemQuery(req);

			//console.log(q);

			db.collection('items')
			.find(q)
			.count(function(err, count) {
				//console.log(count);
				if (err) return next(err);
				res.json(count);
			});
		},

		itemFindById : function(req, res, next) {
			if (!req.params.id || !req.params.streamId) {
				res.send(400); return;
			}

			db.collection('items')
			.findOne({ 
				streamId : new BSON.ObjectID(req.params.streamId), 
				_id : new BSON.ObjectID(req.params.id) 
			}, function(err, result) {
				if(err) return next(err);
				res.send(processResult(result, req.user));
			});
		},

		itemMarkPlayed : function(req, res, next) {
			if (!req.params.id ) {
				res.send(400); return;
			}
			var items = db.collection('items'),
					now = new Date();

			var q = { _id : new BSON.ObjectID(req.params.id) };

			items.findOne(q, function(err, item) {
				if (err) return next(err);
				items.update(q, { 
					'$set' : { 
						played: true,
						lastPlayed : now,
						votes : [],
						totalVotes : 0,
						lastPlayVotes : item.totalVotes
					},
					'$push' : {
						plays : { 
							when :	now,
							votes : item.votes
						}
					},
					'$inc' : {
						playCount : 1,
						historicVotes : item.totalVotes 
					}
				}, function(err, data) {
					if (err) return next(err);
					res.send(200);
				});
			});
		},

		itemFlag : function(req, res, next) {
			if (!req.params.id || !req.body.reason) {
				res.send(400); return;
			}
			var items = db.collection('items'),
					now = new Date();

			var q = { _id : new BSON.ObjectID(req.params.id) };

			items.update(q, {  
				'$set' : { 
			//		played: true,
					flagged: req.body.reason
				},
			}, function(err, data) {
				if (err) return next(err);
				res.send(200);
			});
		},

		itemMarkPlaying : function(req, res, next) {
			if (!req.params.id ) {
				res.send(400); return;
			}
			db.collection('items')
			.findOne({ 
				_id : new BSON.ObjectID(req.params.id) 
			}, function(err, result) {
				if(err) return next(err);
				notifications.notifyPlay(
						processResult(result, null)
				);
				res.send(200);
			});
		},

		itemGetNext : function(req, res, next) {
			if (!req.params.streamId) {
				res.send(400);return;
			}

			db.collection('items')
			.find({
				streamId : new BSON.ObjectID(req.params.streamId),
				played: false	
			})
			.sort({ 
				totalVotes: -1, 
				lastRequested: 1
			})
			.limit(1)
			.toArray(function(err, result) {
				//console.log(err,result);
				if (err) return next(err);
				if (result.length === 0) {
					res.send("");
				} else {
					res.send(processResult(result[0], req.user));
				}
			});
		},

		submitVote : function(req, res, next) {
			if (!req.user) {
				return res.send(401);
			}

			var weight = parseInt(req.body.weight);

			if (!req.params.id || weight > 1 || weight < -1 || isNaN(weight)) {
				return res.send(400);
			}

			var userId = req.user._id;
			//var weight = req.body.weight > 0 ? 1 : -1;

			/*function sumVotes(item) {
				if (typeof(item.votes) === "undefined" || item.votes.length === 0) { return 0 ;}
				var sum = 0;
				for (var i=0;i<item.votes.length;i++) {
					sum+= item.votes[i].weight;
				}
				return sum;
			}*/

			function respond(success, reason, item) {
				res.send({
					success: success,
					reason: reason ? reason : null,
					newCount : item.totalVotes
				});

				if (success) {
					notifications.notifyVote(
						processResult(item, null)
					);
				}
			}

			var items = db.collection('items');

			function loadItemCallback(err, item) {
				if (err) return next(err);
				if (item.votes) {
					var matches = item.votes.filter(function(v) { 
						return v.userId.equals(userId);
					});
					//found an existing vote
					if (matches.length !== 0) {
						var vote = matches[0];
						if (vote.weight === weight) {
							//same vote has already been cast
							return respond(false, "duplicate", item);
						} else {
							//todo: use $inc for this
							//var currentSum = sumVotes(item);
							var change = -vote.weight + weight;
							//currentSum -= vote.weight;
							//currentSum += weight;

							//remove existing
							items.findAndModify({ 
									'votes.userId' : userId, 
									'_id' : item._id 
								}, [['_id', 'asc']], { 
									'$set' : { 
										'votes.$.weight' : weight, 
										'votes.$.created' : new Date()									
									},
									'$inc' : {
										totalVotes : change
									}
								}, { 'new' : true }, function (err, saved) {
									if (err) return next(err);
									respond(true, null, saved);
								});
							return;
						}
					} 
				}

				//create a new vote instead
				//var currentSum = sumVotes(item);
				//currentSum += weight;

				//add vote
				items.findAndModify({_id : item._id}, [['_id', 'asc']], { 
						'$push' : { 
							'votes' : { 
								weight: weight , 
								userId: userId, created : new Date()
							}
						},
						'$inc' : { 'totalVotes' : weight }
					}, { 'new' : true }, function(err, saved) {
						if (err) return next(err);
						respond(true, null, saved);
					}
				);
			}

			items.findOne({ 
				_id : new BSON.ObjectID(req.params.id) 
			}, loadItemCallback);
		}
	};
};