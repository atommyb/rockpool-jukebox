angular.module('jukeboxFormatters', []).
 filter('urlEncode', function() {               // filter is a factory function
   return function(rawUrl) { // first arg is the input, rest are filter params
       return encodeURIComponent(rawUrl);
   }
 });

var project = angular.module('project', ['jukeboxServices', 'jukeboxDirectives', 'jukeboxConfiguration', 'jukeboxFormatters']);

var delay = (function(){
  var timer = 0;
  return function(callback, ms){
    clearTimeout (timer);
    timer = setTimeout(callback, ms);
  };
})();

function findStreamItemInSet(set, id) {
	for (var j =0; j < set.length; j++) {
		if (id === set[j]._id) {
			return set[j];
		}
	}
	return null;
}

function streamItemSorter(a,b) {
	//temp hack
	if (typeof(a.totalVotes)==="undefined") a.totalVotes = 0;
	if (typeof(b.totalVotes)==="undefined") b.totalVotes = 0;

	if (a.totalVotes != b.totalVotes) return b.totalVotes > a.totalVotes ? 1 : -1;

	return (new Date(a.lastRequested) > new Date(b.lastRequested)) ? 1 : -1;
}
function toggleSearching(){
	document.getElementById('topRow').classList.toggle('searching');
}

project.config(function($routeProvider) {
	$routeProvider.
	  when('/', {controller:'ListStreams', templateUrl:'streams.html'})
	  .when('/stream/:streamId/:streamName', { controller : 'Stream', templateUrl:'stream.html'})
	  .otherwise({redirectTo:'/'});
});

project.controller('ListStreams', function($scope, $rootScope, $location, StreamData, StaticConfiguration) {
	$rootScope.page_title = 'Home';
	var existingStreams = !StaticConfiguration.suppressPublicStreams;

	var streams = existingStreams ? StreamData.getStreams() : [];
	$scope.streams =streams;
	$scope.addStream = function() {
		StreamData.addStream({ name : $scope.stream.name }, function(saved) {
			$scope.streams.push(saved);
			if (!existingStreams) {
				$location.path('/stream/' + saved._id + '/' + saved.name);
				console.log(	$location.path );
				return;
			}
		});
		$scope.stream.name = "";
	}
});

project.controller('Stream', function($rootScope, $scope, $location, $routeParams, Socket, StreamNotification, StreamData, ItemSearch, DesktopNotifications) {
	var streamId = $routeParams.streamId;
	var interval;

	function playNext() {
		$scope.hostItem = null;

		StreamData.getNext(streamId, function(item) {
			if (item) {
				$scope.hostItem = item; //player (host)
				StreamData.notifyPlaying(streamId, item._id)
			} else {
				StreamData.notifyPlaying(streamId, null);
			}
		}, function(r) {
			alert('Error fetching next item');
		});
	};

	function sortItems() {
		$scope.items.sort(streamItemSorter)
	}

	$scope.isHostPlaying = false;

	$scope.items = [];

	$scope.stream = StreamData.getStream({ streamId : streamId}, function(stream) {
		$rootScope.page_title = stream.name;
		$scope.items = StreamData.getItems({ streamId : streamId}, function() {
			StreamNotification.notifyJoin($scope.stream._id);
				interval = setInterval(function (){
			    $scope.$apply(function() {
			    	if ($scope.isHostPlaying) {
			    		StreamData.hostIsAlive(streamId, true);
			    	}
			    });
			  },5000);

				$scope.$on('$destroy', function() {
			  	clearTimeout(interval);
				});
			sortItems();
		});
	});

	StreamData.getFavs(streamId, function(data) {
		$scope.favourites = data;
	});

	StreamData.getUnFavs(streamId, function(data) {
		$scope.unfavourites = data;
	});

	StreamData.getRecents(streamId, function(data) {
		$scope.recents = data;
	});

	$scope.addItem = function(item, closeResults) {
		item.adding = true;
		StreamData.addItem(streamId, { url : item.url }, function(saved) {
			item.added=  true;
			item.adding = false;
			//wait for notification instead
			//$scope.items.push(saved);
			//sortItems();
			if (closeResults || $scope.entry.youtubeResults.length <= 1) {
				$scope.entry.youtubeResults = null;
				$scope.entry.url = "";
			}
		}, function(err,a,b) {
			if (err.data === "Duplicate") {
				alert('This item is already queued');
			} else {
				alert('Unknown Error');
			}

			item.adding = false;
		});
	};

	$scope.addExistingItem = function(item, closeResults) {
		item.adding = true;
		StreamData.addItem(streamId, { url : item.url }, function(saved) {
			item.added = true;
			item.adding = false;
			//wait for notification instead
			//$scope.items.push(saved);
			//sortItems();
			// if (closeResults || $scope.entry.youtubeResults.length <= 1) {
			// 	$scope.entry.youtubeResults = null;
			// 	$scope.entry.url = "";
			// }
		}, function(err,a,b) {
			if (err.data === "Duplicate") {
				alert('This item is already queued');
			} else {
				console.log('ERROR:' , err)
				alert('Unknown Error');
			}

			item.adding = false;
		});
	};

	$scope.lookupItem = function() {
		delay(function() {
			var q = $scope.entry.url;

			if (!q || q.length < 4) {
				return ;
			}

			ItemSearch(q, function(result) {
				$scope.entry.youtubeResults = result || [];
			});
		}, 200);
	};

	$scope.closeSearchResults = function() {
		$scope.entry.youtubeResults = null;
		$scope.entry.url = "";
	}

	$scope.startHostPlaying = function() {
		function fail() {
			alert('Somebody else is already hosting this stream - if this is not the case please try again in 30 seconds');
		}

		if ($scope.nowPlaying) {
			return fail();
		}

		StreamData.isHostAlive(streamId, function(response) {
			if (response.alive) {
				return fail();
			} else {
				$scope.isHostPlaying = true;
				playNext();
			}
		});
	};

	$scope.stopHostPlaying = function() {
		if ($scope.hostItem) {
			StreamData.notifyPlaying(streamId, null);
		}
		$scope.hostItem = null;
		$scope.isHostPlaying = false;
		//StreamNotification.stopHosting();
		StreamData.hostIsAlive(streamId, false);
	};

	$scope.hostErrorCount = 0;

	$scope.hostFinishedPlaying = function() {
		StreamData.markPlayed($scope.hostItem._id, function() {
			playNext();
		});

		$scope.hostErrorCount = 0;
	};

	$scope.hostPlaybackError = function() {
		++$scope.hostErrorCount;
		StreamData.markPlayed($scope.nowPlaying._id, function() {
			StreamData.flagItem($scope.hostItem._id, "error", function() {
				if ($scope.hostErrorCount < 3) {
					playNext();
				} else {
					alert('Too many errors have occured');
				}
			}, function() {
				alert('Error flagging item')
			});
		});
	};

	function hostSkipTrack() {
		StreamData.markPlayed($scope.hostItem._id, function() {
			playNext();
		});
	}


	$scope.skipCurrent = function() {
		if (!$scope.nowPlaying) {
			return;
		}
		//if we are the host we can just skip and not bother with notifications
		if ($scope.isHostPlaying) {
			hostSkipTrack();
		} else {
			StreamNotification.notifySkip(streamId, $scope.nowPlaying._id);
		}
	};

	$scope.submitVote = function(item, weight) {
		//if already voted same then this is a cancel
		if (item.currentVote == weight) { weight = 0; }

		StreamData.submitVote(item._id, weight, function(result) {
			item.totalVotes = result.newCount;
			item.currentVote = weight;
			sortItems();
		}, function(reason) {
			if (reason === "unauthorised") { return alert('You need to be logged in to vote'); }
			alert('Unknown error');
		});
	};

	$scope.makeSticky = function(item) {
		//if already voted same then this is a cancel
		console.log(item);
		//if (item.sticky == true) { item.sticky = false; }

		// StreamData.submitVote(item._id, weight, function(result) {
		// 	item.totalVotes = result.newCount;
		// 	item.currentVote = weight;
		// 	sortItems();
		// }, function(reason) {
		// 	if (reason === "unauthorised") { return alert('You need to be logged in to vote'); }
		// 	alert('Unknown error');
		// });
	};

	$scope.flagItem = function(item) {
		StreamData.flagItem(item._id, "user", function() {
			alert("Item flagged. It will not be removed until somebody looks at the flagged list.");
		}, function() {
			alert('Error submitting flag!');
		});
	};

	$scope.enableNotifications = function() {
		DesktopNotifications.request();
	}

	StreamNotification.setOnPlay(function(data) {
		if (data.id === null) {
			$scope.nowPlaying = null;
			return;
		}

		//load item for displaying
		var item = findStreamItemInSet($scope.items, data.id);

		if (item !== null) {
			var index = $scope.items.indexOf(item);
			$scope.items.splice(index, 1);
			$scope.nowPlaying = item;

			DesktopNotifications.showPlaying(item);
		}
	});

	StreamNotification.setOnItemAdded(function(data) {
		//add to our list if we don't have it
		if (findStreamItemInSet($scope.items, data.id) === null) {
			$scope.items.push(data.item);
			sortItems();

			if ($scope.isHostPlaying && !$scope.hostItem) {
				playNext();
			}
		}
	});

	StreamNotification.setOnItemRemoved(function(data) {
		//remove from our list if we have it
		for (var i =0; i < $scope.items.length; i++) {
			if ($scope.items[i]._id === data.id) {
				$scope.items.splice(i, 1);
				return;
			}
		}
	});

	StreamNotification.setOnItemSkipped(function(data) {
		//if we are not playing then the display can wait until we get host:playingItem
		if (!$scope.isHostPlaying) { return; }

		//ignore if not playing this track
		if ($scope.hostItem && $scope.hostItem._id !== data.id) { return; }

		hostSkipTrack();
	});

	StreamNotification.setOnClientJoined(function(data) {
		if ($scope.isHostPlaying && $scope.hostItem) {
			StreamData.notifyPlaying(streamId, $scope.hostItem._id);
		}
	});

	StreamNotification.setOnItemVoted(function(data) {
		//todo: if you are logged in on two browsers and you vote on one, the other will not
		//update the thumb thing

		var itemInSet = findStreamItemInSet($scope.items, data.id);
		if (itemInSet !== null) {
			itemInSet.totalVotes =  data.totalVotes;
			//itemInSet.currentVote =  data.currentVote;
			sortItems();
		}
	});
});
