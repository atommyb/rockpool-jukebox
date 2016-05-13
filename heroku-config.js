var config = {port: '9000'};

config.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
config.FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
config.FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
config.PORT = process.env.PORT;
config.URL = process.env.URL;
config.DB_HOST = process.env.DB_HOST;
config.DB_USER = process.env.DB_USER;
config.DB_PASS = process.env.DB_PASS;
config.DB_NAME = process.env.DB_NAME;
config.DB_PORT = process.env.DB_PORT;
config.allowedItemTypes = process.env.allowedItemTypes;// ['yt'];
config.suppressPublicStreams = process.env.suppressPublicStreams;// false;
config.favsThreshold = process.env.favsThreshold;// 3; // num of times a song must be played to be a "favourite"
config.oldiesThreshold = process.env.oldiesThreshold;// 1; // num of days since song was played to count as an oldie
config.YTControls = process.env.YTControls;// 1; // 1 shows player controls
config.YTHTML5 = process.env.YTHTML5;// 1; // 1 request HTML5 player

module.exports = config;