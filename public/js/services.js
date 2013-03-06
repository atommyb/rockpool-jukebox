angular.module('jukeboxServices', ['ngResource'])
	.factory('Streams', function($resource) {
		return $resource('/data/stream/:streamId', {});
	})
	.factory('StreamItem', function($resource) {
		return $resource('/data/stream/:streamId/item/:id', {});
	})
	.factory('Socket', function($rootScope) {
		var socket = io.connect();
		socket.on('connect_failed', function () {
			alert('Failed to connect socket.io');
		});

		return {
	 		on: function (eventName, callback) {
	      socket.on(eventName, function () {  
	        var args = arguments;
	        $rootScope.$apply(function () {
	          callback.apply(socket, args);
	        });
	      });
	    },
	    emit: function (eventName, data, callback) {
	      socket.emit(eventName, data, function () {
	        var args = arguments;
	        $rootScope.$apply(function () {
	          if (callback) {
	            callback.apply(socket, args);
	          }
	        });
	      })
	    }
		};
	})
	.factory('StreamData', function($http, Streams, StreamItem) {
		return {
			getStreams: Streams.query,
			addStream : function(stream, success, fail) {
				var stream = new Streams(stream);
				stream.$save(success, fail);
			},
			getStream : Streams.get,
			getItems : StreamItem.query,
			getItem : StreamItem.get,
			lookupItem : function(streamId, url, success, fail) {
				var url = "/data/stream/" + streamId +"/queryMedia?url="
					+ encodeURIComponent(url);
				var r = $http.get(url);
				if (success) r.success(success);
				if (fail) r.error(fail);
			},
			addItem : function(streamId, item, success, fail)  {
				var item = new StreamItem(item);
				item.$save({streamId: streamId}, success, fail);
			},
			markPlayed: function(itemId, success, fail) {
				$http.post('/data/item/' +  itemId + '/played')
					.success(function() { if(success) success(); })
					.error(function() { if(fail) fail(); })
			},
			flagItem: function(itemId, reason, success, fail) {
				$http.post('/data/item/' +  itemId + '/flag', { reason : reason})
					.success(function() { if(success) success(); })
					.error(function() { if(fail) fail(); })
			},
			notifyPlaying :function(streamId, itemId, success, fail) {
				$http.post('/data/stream/' +  streamId + '/playing', {
					itemId : itemId
				})
				.success(success || function() {})
				.error(fail || function() {});
			},
			submitVote : function(itemId, weight, success, fail) {
				$http.post("/data/item/" + itemId + "/vote", { weight : weight })
				.success(function(data) {
					if (!data.success) { return fail(data.reason); }
					success(data);
				})
				.error(function(status, code) {
					if (code == 401) {
						return fail("unauthorised");
					};

					fail();
				});
			},
			getNext : function(streamId, success, fail) {
				var url = "/data/stream/" + streamId +"/next";
				var r = $http.get(url);
				if (success) r.success(success);
				if (fail) r.error(fail);
			},
			hostIsAlive : function(streamId, status) {
				var url = "/data/stream/" + streamId + "/hostIsAlive";
				var r = $http.post(url, {
					status : status
				});
			},
			isHostAlive: function(streamId, success) {
				var url = "/data/stream/" + streamId + "/hostIsAlive";
				var r = $http.get(url);
				r.success(success);
			},
			getFavs: function(streamId, success) {
				var url = "/data/stream/" + streamId + "/item/favs";
				var r = $http.get(url);
				r.success(success);
			}
		};
	})
	.factory('StreamNotification', function(Socket, $routeParams) {
		var streamId = $routeParams.streamId;

		if (!streamId) throw new Error("streamId not provided");

		var onPlay, onItemAdded, onItemSkipped, onClientJoined, onItemVoted, onItemRemoved, onRemoteItemStopped;

		Socket.on('host:playingItem', function(data) { if (onPlay) onPlay(data); });
		Socket.on('stream:itemAdded', function(data) { if (onItemAdded) onItemAdded(data); });
		Socket.on('stream:itemSkipped', function(data) { if (onItemSkipped) onItemSkipped(data); });
		Socket.on('stream:clientJoined', function(data) { if (onClientJoined) onClientJoined(data); });
		Socket.on('stream:itemVoted', function(data) { if (onItemVoted) onItemVoted(data); });
		Socket.on('stream:itemRemoved', function(data) { if (onItemRemoved) onItemRemoved(data); });

		Socket.on('player:remoteItemStopped', function(data) {
			if(onRemoteItemStopped) { onRemoteItemStopped(data);}
		});

		Socket.on('reconnect', function() {
			if (streamId) {
				Socket.emit('stream:join', {
					stream : streamId,
				});
			}
		});

		return {
			setOnPlay : function(f) { onPlay = f},
			setOnItemAdded : function(f) { onItemAdded = f},
			setOnItemSkipped : function(f) { onItemSkipped = f},
			setOnClientJoined : function(f) { onClientJoined = f},
			setOnItemVoted : function(f) { onItemVoted = f},
			setOnItemRemoved : function(f) { onItemRemoved = f; },
			setOnRemoteItemStopped : function(f) { onRemoteItemStopped = f; },
			notifyPlay : function(stream, id) {
				Socket.emit('host:playingItem', {
					stream : stream,
					id : id
				});
			},

			notifyJoin : function(stream) {
				//streamId = stream;
				Socket.emit('stream:join', {
					stream : stream,
				});
			},

			notifyAdd : function(stream, id) {
				Socket.emit('stream:itemAdded', {
					stream : stream,
					id : id
				});
			},

			notifySkip : function(stream, id) {
				Socket.emit('stream:itemSkipped', {
					stream : stream,
					id : id
				});
			},

			notifyVoted : function(stream, id ){
					Socket.emit('stream:itemVoted', {
					id : id,
					stream :stream
				});
			},

			requestRemotePlay : function(item) {
				console.log("spot start")
				Socket.emit('player:requestRemotePlay', {
					stream : streamId,
					item : item
				});
			},

			requestRemoteStop : function() {
				console.log("spot stop");
				Socket.emit('player:requestRemoteStop', {
					stream : streamId
				});
			}
		};
	})
.factory('ItemSearch', function($http, $routeParams, $rootScope) {
	return function(q, success, fail) {
		var url = '/data/stream/' + $routeParams.streamId 
							+ '/searchMedia?q=' + encodeURIComponent(q);
							
		console.log(url);
		var promise = $http.get(url)
		.success(success);
		if (fail) { promise.fail(promise); }
	}
})
.factory('DesktopNotifications', function() {
	

	return {
		request: function() {
			if (!window.webkitNotifications) {
				return;
			}

			if (window.webkitNotifications.checkPermission() !== 0) {
		 		window.webkitNotifications.requestPermission();
		 	}
		},

		showPlaying: function(item) {
			if (!window.webkitNotifications) {
				return;
			}

			if (window.webkitNotifications.checkPermission() === 0) {
				var currentNotifier =  window.webkitNotifications.createNotification(
	        item.image, 'Jukebox now playing', item.title
	      );

	      window.setTimeout(function() {
	      	currentNotifier.cancel();
	      }, 10 * 1000);

	      currentNotifier.show();
    	}
		}
	};
});