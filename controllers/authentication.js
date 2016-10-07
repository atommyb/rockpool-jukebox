// var passport = require('passport')
//   , FacebookStrategy = require('passport-facebook').Strategy;

// module.exports = {
// 	createAuthController : function(config) {
// 		var getReturnUrl = function(req) {
// 			var returnUrl = '/';
// 			if (req.query.returnUrl && req.query.returnUrl.indexOf('#/') === 0) {
// 				returnUrl = req.query.returnUrl;
// 			}
// 			return  process.env.URL + '/auth/facebook/callback?returnUrl=' + encodeURIComponent(returnUrl);	
// 		};

// 		return {
// 			authFacebook:  function(req, res, next) {
// 				return passport.authenticate('facebook', {
// 				  callbackURL: getReturnUrl(req)
// 				})(req, res, next);
// 			},
// 			authFacebookCallback: function(req, res, next) {
// 				var url = getReturnUrl(req);
// 				return passport.authenticate('facebook', { 
// 					successRedirect: req.query.returnUrl, //should be safe now as came back from FB. maybe this is rubbish.
// 					failureRedirect: '/?authFailed=1', 
// 					callbackURL: url
// 				})(req, res, next);
// 			},
// 			logout:  function(req, res){
// 			  req.logOut();
// 			  res.redirect("/");
// 			},
// 		};
// 	}
// };