var  config = require('./config.js'),
	express = require('express'),
	mongo = require('mongodb');
var MemoryStore = require('connect').session.MemoryStore
	,passport = require('passport')
  ,FacebookStrategy = require('passport-facebook').Strategy
	,BSON = mongo.BSONPure; 

config.allowedItemTypes = config.allowedItemTypes || ['yt', 'sp', 'sc', 'vm'];

var server = new  mongo.Server(
	config.DB_HOST || 'localhost', 
	config.DB_PORT || 27017, 
	{ auto_reconnect: true }
);

function getDb(next) {
	var db = new mongo.Db(config.DB_NAME || 'jukebox', server, { safe : true });
	db.open(function(err, db) {
		//console.log(err, db);
		if (err) return next(err);
		if (!config.DB_USER) {
			next(null, db);
		} else {
			db.authenticate(config.DB_USER, config.DB_PASS, function(err, replies) {
				if(err) return next(err);
				next(null, db);
			});
		}
	});
}

function setupIndexes(db) {
	db.ensureIndex('items', {
		streamId : 1,
		played : -1
	}, {
		unique:false,
		safe : true,
	}, function(err, result) {
		console.log(err|| result);
	});

	db.ensureIndex('items', {
		streamId : 1,
		url : 1
	}, {
		unique:false,
		safe : true,
	}, function(err, result) {
		console.log(err|| result);
	});

	db.ensureIndex('items', {
		streamId : 1,
		lastPlayVotes: -1, 
		lastRequested: -1,
		played: 1
	}, {
		unique:false,
		safe : true,
	}, function(err, result) {
		console.log(err|| result);
	});
}

function initialiseApplication(db) { 
	function facebookCallback(accessToken, refreshToken, profile, done) {
		var users = db.collection('users');
		users.findOne({ facebook_id : profile.id }, function(err,user) {
			if (!user) {
				users.insert({
					facebook_id: profile.id,
					name: profile.displayName
				}, function(err, result) {
					if (err) { return done(err); }
					done(null, result[0]._id);
				});
			} else {
				users.update({ _id: user._id},
					{ $set:{name : profile.displayName} },
					function(err,result) {
						if (err) { return done(err);}
						done(null, user._id);
					}
				);			
			}
		});
	}

	passport.use(new FacebookStrategy({
	    clientID: config.FACEBOOK_APP_ID,
	    clientSecret: config.FACEBOOK_APP_SECRET
	  },
	  facebookCallback
	));

	passport.serializeUser(function(id, done) {
	  done(null, id);
	});

	passport.deserializeUser(function(id, done) {
		var users = db.collection('users');
		users.findOne({ _id: new BSON.ObjectID(id) }, function(err, user){
			if(err) return done(err);
			done(null, user);
		})
	});

	var app = express()
		,server = require('http').createServer(app)
		,io = require('socket.io').listen(server);

	app.use(express.cookieParser());
	app.use(express.bodyParser());
	app.use(
		express.session({ 
			secret:'keyboard cat', 
			store: new MemoryStore({ reapInterval:  60000 * 10 })
		})
	);
	app.use(passport.initialize());
	app.use(passport.session());
	app.use(app.router);
	app.engine('.html', require('ejs').__express);
	app.set('views', __dirname + '/views');
	app.set('view engine', 'html');
	app.use(express.static(__dirname + '/public'));

	io.set('log level', 1); 
	//console.log(io);
	var notifications = require('./notification-sockets').create(io);
	//sockets.setup();

	var auth_controller = require('./controllers/authentication.js').createAuthController(config);
	var streamsCtrl = require('./controllers/streams.js')(db, notifications, config);

	//var searchCtrl = require('./controllers/search.js');

	app.get('/auth/facebook', auth_controller.authFacebook);
	app.get('/auth/facebook/callback', auth_controller.authFacebookCallback);
	app.get('/logout', auth_controller.logout);

	app.get('/data/stream/:streamId/searchMedia', streamsCtrl.searchMedia);
	app.get('/data/search/youTube', streamsCtrl.searchMedia);


	app.get('/data/stream/:streamId/item/count', streamsCtrl.itemCount);
	app.get('/data/stream/:streamId/item/historic', streamsCtrl.itemFindHistoric);

	app.get('/data/stream/:streamId/item/favs', streamsCtrl.itemFindFavs);
	app.get('/data/stream/:streamId/item/unfavs', streamsCtrl.itemFindUnFavs);
	app.get('/data/stream/:streamId/item/recents', streamsCtrl.itemFindRecents);


	app.get('/data/stream/:streamId/item/oldest', streamsCtrl.itemFindOldest);
	app.post('/data/stream/:streamId/item', streamsCtrl.itemAdd);
	//app.get('/data/stream/:streamId/queryMedia', streamsCtrl.itemNewLookup);
	app.get('/data/stream/:streamId/next', streamsCtrl.itemGetNext);
	app.get('/data/stream/:streamId/item/:id', streamsCtrl.itemFindById);
	app.delete('/data/stream/:streamId/item/:id', streamsCtrl.itemRemove);
	app.get('/data/stream/:streamId/item', streamsCtrl.itemFindActiveByStream);
	app.post('/data/stream/:streamId/hostIsAlive', streamsCtrl.hostIsAlive);
	app.get('/data/stream/:streamId/hostIsAlive', streamsCtrl.hostIsActive);
	app.get('/data/stream/:id', streamsCtrl.streams);
	
	if (!config.suppressPublicStreams) {
		app.get('/data/stream', streamsCtrl.streams);
	}

	app.post('/data/stream', streamsCtrl.streamAdd);
	app.post('/data/item/:id/vote', streamsCtrl.submitVote);
	app.post('/data/item/:id/played', streamsCtrl.itemMarkPlayed);
	app.post('/data/stream/:streamId/playing', streamsCtrl.itemMarkPlaying);
	app.post('/data/item/:id/flag', streamsCtrl.itemFlag);

	app.get('/', function(req, res) {
		var data = { 
			user : req.user ,
			config : {
				suppressPublicStreams : config.suppressPublicStreams || false
			}
		};
		res.render('app.html', data);
	});

	server.listen(config.PORT);
	console.log("listening on port " + config.PORT);
}

getDb(function(err, db) {
	//console.log("got db", err, db);
	if (err) {
		return console.log(err);
	}
	setupIndexes(db);
	initialiseApplication(db);
})