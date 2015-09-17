var _ = require('underscore');
var fs = require('fs');
var path = require('path');
var Twitter = require('twitter');

String.prototype.splice = function( idx, rem, s ) {
    return (this.slice(0,idx) + s + this.slice(idx + Math.abs(rem)));
};

function TwitterFeed(core, ident, config) {
	var self = this;
	self.ident = ident;
	self.file = path.join(core.appFolder,'config/twitter-data-'+self.ident+'.json');

	self.twitter = new Twitter(config.auth);

	self.load = function(callback) {
		var tweets = core.readJSON(self.file);
		if(!tweets)
			return callback();
		self.digestTweets(tweets, callback);
	}

	self.fetch = function(callback) {
		self.twitter.get("statuses/user_timeline", config.args, function(error, tweets, response) {
			if(error)
				return callback(error);
			fs.writeFileSync(self.file, JSON.stringify(tweets,null,'\t'));
			self.digestTweets(tweets, callback);
		});
	}


	self.digestTweets = function(tweets, callback) {
		if(!tweets || !tweets.length)
			return callback({ error : "Unable to digest tweets"});
		var data = tweets;

		var entries = []

		_.each(data, function(t) {
			try {
				var entry = { }

				var t = t.retweeted_status ? t.retweeted_status : t;
				entry.ts = t.created_at.split(' ').slice(0,3).join(' ');
				var text = t.text;

				var subst = []
				/*
					METHOD: 
						Iterate through all substitution entries. 
						Sort all entries in reverse.
						Apply splice (backwards) as injecting strings changes positions that follow.

				*/

				var urls = t.entities.urls.reverse();
				_.each(urls, function(o) {
					subst.push({
						begin : o.indices[0],
						end :  o.indices[1],
						link : "<a href='"+o.url+"' target='_blank' title='"+o.expanded_url+"'>"
					})
				})

				var hashtags = t.entities.hashtags.reverse();
				_.each(hashtags, function(o) {
					subst.push({
						begin : o.indices[0],
						end :  o.indices[1],
						link : "<a href='https://twitter.com/hashtag/"+o.text+"?src=hash' target='_blank'>"
					})
				})

				var user_mentions = t.entities.user_mentions.reverse();
				_.each(user_mentions, function(o) {
					subst.push({
						begin : o.indices[0],
						end :  o.indices[1],
						link : "<a href='https://twitter.com/"+o.screen_name+"' target='_blank'>"
					})
				})

				subst = _.sortBy(subst, 'begin').reverse();
				_.each(subst, function(o) {
					if(o.end >= 140)
						text += "</a>";
					else
						text = text.splice(o.end, 0, "</a>");
					text = text.splice(o.begin, 0, o.link);
				})

				entry.text = text;

				/*if(t.retweeted_status) {
					entry.id = t.id;
					entry.user_id = t.retweeted_status.user.id;
					entry.user_image = t.retweeted_status.user.profile_image_url_https;
					entry.user_url = t.retweeted_status.user.url;
					entry.user_name = t.retweeted_status.user.name;
					entry.user_screen_name = t.retweeted_status.user.screen_name;
				}
				else {*/
					entry.id = t.id;
					entry.user_id = t.user.id;
					entry.user_image = t.user.profile_image_url_https;
					entry.user_url = t.user.url;
					entry.user_name = t.user.name;
					entry.user_screen_name = t.user.screen_name;
				//}

				// console.log("Twitter Entry:".cyan.bold, entry);

				entries.push(entry);

			} catch(ex) {
				console.log("Twitter Error:".magenta.bold,ex.stack);
			}
		})

		self.entries = entries;

		callback(null, entries);
	}
}


function Tweets(core, options) {
	var self = this;
	self.first = true;
	self.feeds = { }
	self.config = core.getConfig('twitter');
	options = options || {};

	_.each(self.config, function(userConfig, ident) {
		self.feeds[ident] = new TwitterFeed(core, ident, userConfig);
	})


	self.update = function(callback, manual) {
		var feeds = _.values(self.feeds);
		digest();
		function digest() {
			var feed = feeds.shift();
			if(!feed)
				return callback();

			feed.fetch(function(err) {
				if(err)
					console.log("Twitter Error:".magenta.bold,err);
				dpc((self.first || manual) ? 0 : core.config.twitter.rate, digest);
			})
		}
	}


	function monitor() {
		self.update(function() {
			self.flush();
			self.first = false;
			dpc(core.config.twitter.rate, monitor);
		})
	}


	self.load = function(callback) {
		var feeds = _.values(self.feeds);
		digest();
		function digest() {
			var feed = feeds.shift();
			if(!feed)
				return callback();

			feed.load(function(err) {
				dpc(digest);
			})
		}
	}


	self.flush = function() {
		var feeds = { }
		_.each(self.feeds, function(feed, ident) {
			feeds[ident] = { entries : feed.entries };
		})
		self.tweetsCache = feeds;
		core.updateTweets && core.updateTweets(feeds);
	}

	self.init = function() {
		console.log("Starting twitter monitoring...");
		self.load(function() {
			self.flush();
		})

		dpc(monitor);
	}

	self.initHttp = function(app){
		app.get(options.url || '/twitter', function(req, res, next) {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "public, max-age=0");
            res.json(self.tweetsCache);
        });
	}
}

module.exports = {
	Tweets: Tweets,
	Feed: TwitterFeed
}
