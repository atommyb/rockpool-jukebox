var mongo = require('mongodb');//, Server = mongo.Server, Db = mongo.Db;
var BSON = mongo.BSONPure;
var search = require('../lib/search.js');
var config = require('../heroku-config.js');

function processResult(item, user) {
	var playCount =  item.plays ? item.plays.length : 0;
	var lastPlayed = playCount > 0 ? item.plays.pop() : null;

	//check whether date vs object
	//we used to just store date here
	if (lastPlayed && !lastPlayed.getMonth) {
		lastPlayed = lastPlayed.when;
	}
	
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

module.exports = function(db, notifications, config) {
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
			if (!req.body.name) {
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

		hostIsAlive : function(req, res, next) {
			var streams = db.collection('streams');
			if (!req.params.streamId) {
				res.send(400); 
				return;
			}
			
			var status = !!req.body.status;

			streams.update({ _id : new BSON.ObjectID(req.params.streamId)},
				{ $set : { lastHosted : new Date(), lastHostStatus : status }},
				function(err) {
					if(err) return next(err);
					res.send(200);
				}
			);
		},

		hostIsActive : function(req, res, next) {
			var streams = db.collection('streams');
			if (!req.params.streamId) {
				res.send(400); 
				return;
			}

			streams.findOne({ _id : new BSON.ObjectID(req.params.streamId)}, function(err, stream) {
				if (err) return next(err);
				if (!stream.lastHosted) {
					res.send({ alive: false, lastHosted : null });
				} else {
					var now = new Date().getTime();
					var last = stream.lastHosted.getTime();

					res.send({ 
						alive : !!stream.lastHostStatus && (now - last) < 6000, //6 s
						lastHosted : last 
					});
				}
			});
		},

		searchMedia: function(req, res, next) {
			var q = req.query.q;
			if (!q) {
				return res.send(400);
			}
			
			var prefixes = {
				sp : search.searchSpotify,
				yt : search.searchYoutube
			};


			function executeSearch(prefix, q) {
				console.log(prefix,q);
				var func = prefixes[prefix];
				func(q, function(err, data) {
					if (err) return next(err);
					res.send(data);
				})
			}

			function searchForUrl(url) {
				//we want to route YouTube URLs through the search API so we can use filters etc.
				if (url.indexOf('youtube.com/') !== -1) {
					console.log("yt url search", url);
					return search.searchYoutube(url, function(err, results) {
						if (err) return next(err);
						res.send(results);
					});
				} else {
					console.log("og search", url);
					search.lookupTrack(url, function(err, r) {
						if (err) return next(err);
						return res.send([{
							title : r.title,
							image : r.image,
							url : r.url,
							views : r.views || '?' //this will fail for '0'..
						}]);
					})
					return;
				}
			}

			//if it looks like a URL we can handle differently
			//this regex is a bit lame
			if (/^(https?:\/\/|www\.)/i.test(q)) {
				console.log("if search", q);
				return searchForUrl(q);
			} else {
				console.log("default search", q);
				var func;
				var m = /^([a-z]{2})\s/.exec(q);

				if (m && prefixes[m[1]] && process.env.allowedItemTypes.indexOf(m[1]) !== -1) {
					executeSearch(m[1], req.query.q.slice(3));				
				} else {
					if (req.params.streamId) {
						db.collection('streams')
						.findOne(
							{ _id : new BSON.ObjectID(req.params.streamId) },
						  function(err, result) {
								if (err) return next(err);
								executeSearch(result.defaultSearchIdentifier || 'yt', req.query.q);
							}
						);
					} else {
						executeSearch('yt', req.query.q);
					}
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
					type : data.type,
					sticky: false
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

			search.lookupTrack(req.body.url, function (err, data) {
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
					if (item) {
						updateExisting(item);
					} else {
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

		itemFindRecents: function(req, res, next) {
			if (!req.params.streamId) {
				res.send(400); return;
			}
			var past = new Date();
			past.setDate(past.getDate() - 1);
			var q = buildItemQuery(req, {
				played:  true,	
				lastPlayed : { $lte : past }
			});

			db.collection('items')
			.find(q)
			.sort({ lastPlayed: -1 })
			.limit(10)
			.toArray(function(err, result) {
				if (err) return next(err);
				res.send(result.map(function(i) { return processResult(i, req.user); }));
			});
		},

		itemFindFavs: function(req, res, next) {
			if (!req.params.streamId) {
				res.send(400); return;
			}
			
			var q = buildItemQuery(req, {
				played:  true,				
				playCount : { $gte : process.env.favsThreshold }
			});

			db.collection('items')
			.find(q)
			.sort({ playCount: -1 })
			.limit(10)
			.toArray(function(err, result) {
				if (err) return next(err);
				res.send(result.map(function(i) { return processResult(i, req.user); }));
			});
		},

		// 30 days old, not played much (descending order)
		itemFindUnFavs: function(req, res, next) {
			if (!req.params.streamId) {
				res.send(400); return;
			}
			
			var past = new Date();
			past.setDate(past.getDate() - process.env.oldiesThreshold);
			var q = buildItemQuery(req, {
				played:  true,				
				lastPlayed : { $lte : past }
			});

			db.collection('items')
			.find(q)
			.sort({ playCount: -1 })
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
			if (!req.params.streamId ) {
				res.send(400); return;
			}

			var itemId = req.body.itemId;
			if (itemId) {
				db.collection('items')
				.findOne({ 
					_id : new BSON.ObjectID(itemId) 
				}, function(err, result) {
					if(err) return next(err);
					notifications.notifyPlay(
							processResult(result, null)
					);
					res.send(200);
				});
			} else {
				notifications.notifyPlay({
					streamId: req.params.streamId,
					_id : null
				});
				setTimeout(function() {
					res.send(200)
				}, 0);
			}
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
							var change = -vote.weight + weight;

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