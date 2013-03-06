var YouTubeFactory = function() {
	return {
		create : function(elementId, args, success) {
			var setup = function() {
				var player = new YT.Player(elementId, args);
				if (success) { success(player); }
			};

			if (typeof(YT) === "undefined" || typeof(YT.Player) === "undefined") {
				window.onYouTubeIframeAPIReady = setup;

		    var tag = document.createElement('script');
		    tag.src = "//www.youtube.com/iframe_api";
		    var firstScriptTag = document.getElementsByTagName('script')[0];
		    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
			}
			else 
			{	//assume for now that it is already loaded and ok. this is a bit crap.
				setup();
			}
		}
	};
}();

MegaPlayer = function($) {
	function makeId() {
	    var text = "";
	    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

	    for( var i=0; i < 5; i++ )
	        text += possible.charAt(Math.floor(Math.random() * possible.length));
	    return text;
	}

	function createYoutubeWrapper(container, options) {
		var youtubePlayer = null, notificationEventHandler;
		
		return {
			hide : function() { 
				$(container).hide(); 
			},
			show : function() { $(container).show(); },
			stop : function() { youtubePlayer.stopVideo(); },
			play : function(url, notifier) {
				notificationEventHandler = notifier;
				var task = function(player) {
					var match = /\?v=([^&]+)/i.exec(url);
					player.stopVideo();
					player.cueVideoById(match[1]);
					player.setPlaybackQuality('hd720');
					player.playVideo();
					setTimeout(function() {
						player.playVideo();
					}, 3000);
				};

				if (youtubePlayer === null) {
					var wrapper = $('<div />');
					container.append(wrapper);
					YouTubeFactory.create(wrapper.get(0),  {
						width: options.width,
						height: options.height,
						playerVars: {
		          start: 0,
		          controls: config.YTControls,	          
		          html5: config.YTHTML5
		        },
						events: {
	          'onReady': function(evt) {  
		          	youtubePlayer = evt.target;
		          	youtubePlayer.addEventListener("onStateChange", function(e) {
		          		if (e.data == 0) { //ended
		          			if (notificationEventHandler) {
		          				notificationEventHandler({
		          					status : 'finished'
		          				});
		          			}
		          		}
		          	});

		          	youtubePlayer.addEventListener("onError", function(e) {
		          		notificationEventHandler({
		          			status : 'error'
		          		});
		          	});
		          	task(evt.target);
		          	console.log(youtubePlayer);
		         	}
		       	}
	      	});
				} else {
					task(youtubePlayer);
				}
			}
		};
	};

	function createSoundCloudWrapper(container, options) {
		//var widget;                //todo: don't store clientId here
		var  finishedCallback, isLoaded = false, clientId = 'ac784427be84b4f3ba0f0202659afd20';
		return {
			hide : function() { $(container).hide(); },
			show : function() { $(container).show(); },
			stop : function() {  if (true) { 
					var widget = SC.Widget(container.find('iframe').get(0));
					widget.pause();
					//console.log(widget);
					//widget.unbind(SC.Widget.Events.FINISH);
					///above throws error from soundcloud api so will just bin it
					//container.empty();
				}
			},
			play: function(url, notifier) { 
				finishedCallback = notifier;

				if (!isLoaded) {
					SC.initialize({
						client_id : clientId
					});
					container.attr({
						width: options.width, 
						height: options.height 
					});

					SC.oEmbed(url, { 
						iframe: true,
						auto_play : true
					}, function(oEmbed) {
						container.html(oEmbed.html);
						var widget = SC.Widget(container.find('iframe').get(0));
						widget.bind(SC.Widget.Events.FINISH , function() {
							if(finishedCallback) { 
								finishedCallback({ status : 'finished' }); 
							}
						});
						//widget.play();
						console.log(widget);
					});
					isLoaded = true;
				} else {
					//we have to lookup the other type of sound cloud URL.   
					//because it needs that type here. and only here.
					var resolveUrl = 'http://api.soundcloud.com/resolve.json'
						+ '?client_id=' + clientId
		    		+'&url=' + encodeURIComponent(url);
		    		+ '&?callback=?';

					$.get(resolveUrl, function(data) {
						var widget = SC.Widget(container.find('iframe').get(0));
						widget.load(data.uri, {
							iframe: true,
							callback : function() {
								widget.play();
							}
						});
					});
				}
			}
		};
	};

	function createVimeoWrapper(container, options) {
		var videoApi = null, id = makeId();
		return {
			hide : function() { $(container).hide(); },
			show : function() { $(container).show(); },
			stop : function() { 
				if (!videoApi) {  return; }
					videoApi.api('unload');
			}, 
			play: function(url, notifier) { 
				var match = /vimeo.com\/(\d+)/i.exec(url);
				var videoId = match[1];
				var iframe = $('<iframe/>').attr({ 
					id : id, 
					width: options.width,
					height: options.height,
					frameborder: '0',
					src: 'http://player.vimeo.com/video/'+ videoId +'?api=1&player_id=' + id
				});

				container.empty();
				container.append(iframe);

				Froogaloop(iframe[0]).addEvent('ready', function(player_id) {
					videoApi = Froogaloop(player_id);
	        videoApi.addEvent('finish', function() {
	        	if(notifier) { 
							notifier({ status : 'finished' }); 
						}
	        });
	        videoApi.api('play');
				});
			}
		};
	};

	return {
		create : function(element, opts) {
			opts = opts || {};
			opts.width = opts.width || 540;
			opts.height = opts.height || 304;

			var self = this, players = { 
			  youtube : null,
			  flowplayer : null
			}, activePlayer=null, eventListeners = {
				'finish' : [], 'error' : []
			}, factories = {
				youtube : createYoutubeWrapper,
				soundcloud : createSoundCloudWrapper,
				vimeo : createVimeoWrapper
			};

			 function fireEvent (eventName, arg) {
				for (var i = 0; i < eventListeners[eventName].length; i++) {
					eventListeners[eventName][i].call(this, arg);
				}
			};

		 function getPlayer (type) {
				if (players[type]) {
					return players[type];
				} else {
					if (typeof(factories[type]) === "undefined") {
						throw new Error("unsupported type");
					}

					var elem = $('<div id="' + type +  makeId() + '" class="playerHolder"></div>');
					$(element).append(elem);

					players[type] = factories[type].call(this, elem, opts);

					return players[type];
				}
			};

			var kill = function() {
				if (activePlayer) {
								activePlayer.stop();
								activePlayer.hide();
							}
				activePlayer = null;
			}

			return {
				play : function(item) {
					var type = item.type;

					var player = getPlayer(type);

					if (player) {
						if (player !== activePlayer) {
						  kill();
							player.show();
						}
						activePlayer = player;
						player.play(item.url, function(notification) { 
							if (notification.status === "finished") {
								fireEvent("finish");	
							} else if (notification.status === "error") {
								fireEvent("error");
							}							
						});
					} else {
						alert('Unsupported item type');
					}	
				},
				stop : function() {
					kill();
				},
				bind : function(eventName, callback) {
					if (typeof(eventListeners[eventName]) === 'undefined') {
						throw new Error("Unknown event " + eventName);
					}

					eventListeners[eventName].push(callback);
				}
			};
		}
	};
}(jQuery);