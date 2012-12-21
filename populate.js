var request = require('request');
var config = require('./config');
var serverUrl =  config.URL, THRESHOLD = 5, ADD = 5;



function getJson(url, done) {
	request(url, function(err, resp, body) {
		if (err) return done(err);
		if (resp.statusCode != 200) {
			return done(new Error("Returned status code" + resp.statusCode));
		}
//console.log(data);
		var data = JSON.parse(body);
		done(null, data);
	});
}

function populateStream(stream, done) {
	//console.log("==============");
	console.log("==processing stream " + stream.name);
	var baseUrl = serverUrl + "/data/stream/" + stream._id + "/item";

	getJson(baseUrl + "/count?played=false", function(err, count) {
		if (err) return done(err);
		//console.log(count + " items unplayed");
		if (count > THRESHOLD) {
			//console.log("skipping");
			return done();
		}

		var url = baseUrl + "/oldest";
		//console.log(url);
		getJson(url, function(err, itemOldest) {
			if (!itemOldest) {
				//console.log("no items at all");
				return done();
			}

			var DAY_MS =  1000 * 60 * 60 * 24;

			var then = new Date(itemOldest.created).getTime();
			var yesterday = new Date(new Date().getTime() - 1000 * 60 * 60 * 24 * 3).getTime();

			var age = Math.floor(
					(Math.random() * (yesterday - then)) + then
			);

			console.log(new Date(age));
			getJson(baseUrl + "/historic?played=true&age=" + age, function(err, set) {
				if (err) return done(err);
				if (set.length === 0) {
					//console.log("nothing to add");
					done();
				} else {
					//console.log("search found " + set.length);
					var add;
					var i = 1;
					add = function(next) {
						item = set.pop();
						if (item && i < ADD) {
							console.log("adding item with id " + item._id + " title " + item.title);
								request.post(baseUrl, { form: {
									streamId : stream._id,
									url : item.url
							}}, function(e,r,body) {
								if (e) return next(e);
								if (r.statusCode !== 200) {
									if (r.body==="Duplicate") return next();
									return next(new Error("add: statuscode " + r.statusCode + " body " + r.body));
								}
								add(next);
							});							
						} else {
							next();
						}
					}
					add(done);					
				}
			});
		});
	});
}

var job = function() {
	getJson(serverUrl + "/data/stream", function(err, streams) {
		if (err) {
			console.log(err);
			return;
		}

		var next;

		next = function(err) {
			if (err) {
				console.log("ERROR: " + err);
				//process.exit(code=1);
				return;
			}

			var stream = streams.pop();
			if (!stream) {
				console.log("Done");
				//process.exit(code=0);
				return;
			}

			populateStream(stream, next);//next();
		}

		next();
		
		
	});
};
job();
setInterval(job, 1000 * 60 * 4);



