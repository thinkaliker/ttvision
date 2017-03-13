var request = require('request');
var express = require('express');
var fs      = require('fs');
var path    = require('path');
var https   = require('https');
var http    = require('http');
var firebase = require('firebase');
var favicon = require('serve-favicon');
var bodyParser = require('body-parser')
var app = express();

app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
})); 

app.use(favicon(__dirname + '/favicon.ico'));

//Get your own Twitch application clientID and clientSecret at:
//https://www.twitch.tv/settings/connections
//Create your own Firebase Project at:
//https://console.firebase.google.com/?pli=1
var client_id;
var client_secret;
var firebase_apikey;
fs.readFile(__dirname + '/config.json', 'utf8', function(err, data) {
	if(err) throw err;

	var fs_parse = JSON.parse(data);
	client_id = fs_parse.client_id;
	client_secret = fs_parse.client_secret;
	firebase_apikey = fs_parse.firebase_apikey;
}); 

//Firebase config settings for ttvision
var config = {
  apiKey: firebase_apikey,
  authDomain: "ttvision-23b0e.firebaseapp.com",
  databaseURL: "https://ttvision-23b0e.firebaseio.com",
  storageBucket: "ttvision-23b0e.appspot.com",
};
firebase.initializeApp(config);
var database = firebase.database();

//Local user database - sync'd up with Firebase database regularly
var user_list = {
	name: [],
	mobile_key: [],
	auth_token: [],
	access_token: [],
}

function user_data(name, auth_token, access_token, channels) {
	this.name = name;
	this.auth_token = auth_token;
	this.access_token = access_token;
	this.channels = [];
}


//Generate random string literal for mobile remote authentication
//Referenced: http://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
function makeid()
{
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    for( var i=0; i < 4; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

sync_database = function(user_list)
{
	console.log("Syncing with Firebase...");
	var user_list_ref = firebase.database().ref('users/');
	var in_user_list = 0;
	user_list_ref.once('value', function(snapshot) {
		snapshot.forEach(function(snapshot) {
			in_user_list = 0;
			for(var i = 0; i < user_list.name.length; i++)
			{
				//console.log("[%d]: %s with %s", i, user_list.name[i], snapshot.key);
				if(user_list.name[i] == snapshot.key)
				{
					//console.log("Previous iteration of user: %s found. Updating values...", snapshot.key);
					user_list.mobile_key[i] = snapshot.child('mobile_key').val();
					user_list.auth_token[i] = snapshot.child('auth_token').val();
					user_list.access_token[i] = snapshot.child('access_token').val();
					in_user_list = 1;
					break;
				}
			}
			if(in_user_list == 0)
			{
				//console.log("Did not find %s in local storage. Adding...", snapshot.key);
				user_list.name.push(snapshot.key);
				user_list.mobile_key.push(snapshot.child('mobile_key').val());
				user_list.auth_token.push(snapshot.child('auth_token').val());
				user_list.access_token.push(snapshot.child('access_token').val());
				//console.log("User: %s ", snapshot.key);
				//console.log("Mobile_Key: %s", snapshot.child('mobile_key').val());
				//console.log(snapshot.child('auth_token').val());
			}
		});
	});

	/*
	console.log("Syncing with Firebase...");
	var user_list_ref = firebase.database().ref('users/');
	user_list_ref.once('value', function(snapshot) {
		snapshot.forEach(function(snapshot) {
			
			user_list.name.push(snapshot.key);
			user_list.mobile_key.push(snapshot.child('mobile_key').val());
			user_list.auth_token.push(snapshot.child('auth_token').val());
			console.log("User: %s ", snapshot.key);
			console.log("Mobile_Key: %s", snapshot.child('mobile_key').val());
			console.log(snapshot.child('auth_token').val());
		});
	});
	*/
	
}

//Retrieve list of top games on Twitch, sorted by viewer count.
syncDatabaseBrowseList = function()
{
	//GET Request Options
	console.log('syncDatabaseBrowseList: Retrieve list of top games on Twitch, sorted by viewer count. \nThen update Firebase with this data for future use.');
    var options = {
        url: 'https://api.twitch.tv/kraken/games/top' + '?limit=100',
        method: 'GET',
        headers: {
            'Client-ID': client_id,
        },
    }
	//Handle GET Request
    function callback(error, response, body) {
        if(!error && response.statusCode == 200) {
			var top_game_arr = {
				game: ['Featured'],
			}
			var readfile = JSON.parse(body);
			var top_object = readfile.top;
			if(Object.keys(top_object).length > 0)
			{
				for(var i = 0; i < Object.keys(top_object).length; i++)
				{
					var game_object = JSON.stringify(top_object[i].game.name).replace(/["]+/g, '');
					//console.log(game_object);
					top_game_arr.game.push(game_object);
				}
			}
			else
			{
				console.log("No top games available.");
			}
			writeTopGames(top_game_arr);
		}
		else
		{
            console.log('Error: ' + response.statusCode);
            console.log(body);
		}
    }
	//Make GET Request
    request(options, callback);
}

writeUserData = function(user_leaf)
{
	var mobile_key = makeid();
	console.log("Sending to firebase user data...");
	console.log(JSON.stringify(user_leaf));
	firebase.database().ref('users/' + user_leaf.name).set({
		auth_token: user_leaf.auth_token,
		access_token: user_leaf.access_token,
		channels: user_leaf.channels,
		command: "",
		current_channel: user_leaf.channels[0],
		mobile_connected: false,
		mobile_key: mobile_key,
		heartbeat: false,
		muted: true,
		volume: 1,
	});
	
	firebase.database().ref('IDs/' + user_leaf.auth_token).set({
		username: user_leaf.name,
	});
	console.log("Adding: %s with mobile key: %s to user list...", user_leaf.name, mobile_key);
	
	sync_database(user_list);
	//setTimeout(1000, function() {
	//	sync_databse(user_list);
	//});
	//sync_database(user_list);
	//Add name and mobile key as a local copy for validation in /remote later
	//Maybe change this to update based on firebase values later
	//user_list.name.push(user_snippet.name);
	//user_list.mobile_key.push(user_snippet.mobile_key);
}

writeTopGames = function(top_game_arr)
{
	console.log("Sending to firebase top game data for browsing...");
	//console.log(JSON.stringify(top_game_arr));
	firebase.database().ref('games/').set(top_game_arr.game);
}

//Initally check IDs tree for duplicate auth_token entries caused by an update to an existing
//auth token. Purge these in order to place an updated auth_token in.
removeDuplicateEntries = function(user_leaf)
{
	console.log("removeDuplicateEntries: Check local database for outdated, duplicate entries and remove said duplicates.")
	var auth_token_ref = firebase.database().ref('IDs/').orderByChild('username').equalTo(user_leaf.name);
	auth_token_ref.once('value', function(snapshot) {
		snapshot.forEach(function(snapshot) {
			if(snapshot.key == user_leaf.auth_token)
			{
				
			}
			else
			{
				console.log("Removing %s...", snapshot.key);
				snapshot.ref.remove();
			}

		});
	});
	writeUserData(user_leaf);
}

//Get user's username via auth token.
getUserName = function(user_leaf)
{
	console.log('getUserName: Get user\'s username via auth token.')
	//GET Request Options
	var options = {
		url: 'https://api.twitch.tv/kraken/user',
        method: 'GET',
        headers: {
            'Client-ID': client_id,
            'Authorization': 'OAuth ' + user_leaf.access_token,
        },
	}
	//Handle GET Request
	function callback(error, response, body) {
		console.log('Requesting for user information...')
        if(!error && response.statusCode == 200) {
			var res = JSON.parse(body);
			//console.log(JSON.stringify(body));
			//console.log(res.name);
			user_leaf.name = res.name;
			removeDuplicateEntries(user_leaf);
			user_list.name.push(user_leaf.name);
			user_list.access_token.push(user_leaf.access_token);
			user_list.auth_token.push(user_leaf.auth_token);
		}
	}
	//Make GET Request
	request(options, callback);
}


//Get user's list of followed/subscribed streams using client's access_token.
getFollowList = function(user_leaf)
{
	//GET Request Options
	console.log('getFollowList: Retrieve user\'s list of followed/subscribed streams.');
    var options = {
        url: 'https://api.twitch.tv/kraken/streams/followed' + '?stream_type=all',
        method: 'GET',
        headers: {
            'Client-ID': client_id,
            'Authorization': 'OAuth ' + user_leaf.access_token,
        },
    }
	//Handle GET Request
    function callback(error, response, body) {
        //console.log('Requesting user follow list...');
        if(!error && response.statusCode == 200) {
			var res = JSON.parse(body);
			var stream_object = res.streams;
			if(Object.keys(stream_object).length > 0)
			{
				for(var i = 0; i < Object.keys(stream_object).length; i++)
				{
					var channel = JSON.stringify(stream_object[i].channel.display_name).replace(/["]+/g, '');
					//console.log(channel);
					user_leaf.channels.push(channel);
				}
			}
			else
			{
				console.log("No channels online for the user. Adding default channels.");
				user_leaf.channels.push('food');
				user_leaf.channels.push('monstercat');
			}
			getUserName(user_leaf);
		}
        else
        {
            console.log('Error: ' + response.statusCode);
            console.log(body);
        }
    }
	//Make GET Request
    request(options, callback);
}

//Get user's list of followed/subscribed streams using client's access_token.
//Does not identify the username; assumes it is already given and proceeds directly to
//update Firebase with the channel information.
//Also returns a json containing the user channels.
getFollowListUpdate = function(following_user_leaf)
{
	if(typeof following_user_leaf.name === "undefined")
	{
		console.log("Nothing in name. This should never happen.");
	}
	else
	{
		//GET Request Options
		console.log('getFollowListUpdate: Retrieve user\'s list of followed/subscribed streams upon returning from "Following".');
		var options = {
			url: 'https://api.twitch.tv/kraken/streams/followed' + '?stream_type=all',
			method: 'GET',
			headers: {
				'Client-ID': client_id,
				'Authorization': 'OAuth ' + following_user_leaf.access_token,
			},
		}
		//Handle GET Request
		function callback(error, response, body) {
			//console.log('Requesting user follow list...');
			if(!error && response.statusCode == 200) {
				var res = JSON.parse(body);
				var stream_object = res.streams;
				if(Object.keys(stream_object).length > 0)
				{
					for(var i = 0; i < Object.keys(stream_object).length; i++)
					{
						var channel = JSON.stringify(stream_object[i].channel.display_name).replace(/["]+/g, '');
						//console.log(channel);
						following_user_leaf.channels.push(channel);
					}
				}
				else
				{
					console.log("No channels online for the user. Adding default channels.");
					following_user_leaf.channels.push('food');
					following_user_leaf.channels.push('monstercat');
				}
				writeUserData(following_user_leaf);
				return following_user_leaf.channels;
			}
			else
			{
				console.log('Error: ' + response.statusCode);
				console.log(body);
			}
		}
		//Make GET Request
		request(options, callback);
	}
}

//Retrieve user access token from Twitch with passed in auth_token.
getAccessToken = function(auth_token)
{
	console.log('getAccessToken: Retrieve user access token from Twitch.');
	//POST Request options
	var options = {
		url: 'https://api.twitch.tv/kraken/oauth2/token',
		form: {
			'client_id': client_id,
			'client_secret': client_secret,
			'grant_type': 'authorization_code',
			'redirect_uri': 'http://ttvision.cc/home',
			'code': auth_token,
		},
		method: 'POST',
	};

	//Callback to POST request
	function callback(error, response, body) {
		if(!error && response.statusCode == 200) {
			var info2 = JSON.parse(body);
			console.log('Client access_token: ' + info2.access_token);
			var user_leaf = new user_data;
			user_leaf.auth_token = auth_token;
			user_leaf.access_token = info2.access_token;
			getFollowList(user_leaf);
		}
		else
		{
			console.log('Error:' + response.statusCode);
			console.log(body);
		}
	}
	//Make POST Request
	request(options, callback);
}

checkAccessCode = function(access_token)
{
	if(typeof access_token === "undefined")
	{
		return 1;
	}
	
	/*var access_token_ref = firebase.database().ref('users/');
	access_token_ref.once('value', function(snapshot) {
		snapshot.forEach(function(snapshot) {
			if(snapshot.child('access_token').val() == access_token);
			{
				sync_database(user_list);
				return 1;
			}
			console.log("Access Token: %s", access_token);
		});
	});*/
	
}

/*checkHeartBeat = function()
{
	console.log("SetInterval: Checking user heartbeats...");
	var heartbeat_ref = firebase.database().ref('users/');
	heartbeat_ref.once('value', function(snapshot) {
		snapshot.forEach(function(snapshot) {
			if(snapshot.child('heart_beat').val() == true);
			{
				firebase.database().ref('users/' + snapshot.key + ')
				return 1;
			}
			console.log("Access Token: %s", access_token);
		});
	});
}*/

//Routing
//app.use(bodyParser.urlencoded({extended: true}));
//app.use(bodyParser.json());

var port = process.envPORT || 3000;

var router = express.Router();

router.use(function(req, res, next) {
	console.log("GET Request recieved!");
	next();
});

router.get('/get_user', function(req, res) {
	res.setTimeout(1000, function() {
		console.log("Grabbing username with ref to auth_token");
		var auth_token_code = req.query.code;
		
		console.log("Auth_token_Code: %s", auth_token_code);
		if(typeof auth_token_code === "undefined" || auth_token_code == "undefined")
		{
			console.log("You're not supposed to be in here!");
			//res.redirect('/');
			res.end();
		}
		else
		{
			console.log("Auth_token for comparison: %s", auth_token_code);
			for(var i = 0; i < user_list.auth_token.length; i++)
			{
				console.log("%s", user_list.auth_token[i]);
				if(user_list.auth_token[i] == auth_token_code)
				{
					var key_user = {
						user: user_list.name[i],
					}
					console.log(user_list.name[i]);
					res.json(key_user);
					break;
				}
			}	
			res.end();
		}
		
	});
	
});

//Make GET /streams/featured call to Twitch API. Return this to firebase and to the webpage
//that made the request.
router.get('/browse', function(req, res) {
	if(req.query.game == "Featured")
	{
		console.log("Grabbing featured channels from Twitch API.");
		var options = {
			url: 'https://api.twitch.tv/kraken/streams/featured' + '?limit=25',
			method: 'GET',
			headers: {
				'Client-ID': client_id,
			},
		}
		//Handle GET Request
		function callback(error, response, body) {
			if(!error && response.statusCode == 200) {
				var readfile = JSON.parse(body);
				var featured_object = readfile.featured;
				//console.log("featured_object length: " + featured_object.length);
				var featured_channels_arr = {
					channels: [],
				};
				if(Object.keys(featured_object).length > 0)
				{
					for(var i = 0; i < Object.keys(featured_object).length; i++)
					{
						var featured_channel_object = JSON.stringify(featured_object[i].stream.channel.display_name).replace(/["]+/g, '');
						//console.log(featured_channel_object);
						featured_channels_arr.channels.push(featured_channel_object);
					}
				}
				else
				{
					console.log("No featured channels to grab.");
				}
				res.json(featured_channels_arr);
			}
			else
			{
				console.log('Error: ' + response.statusCode);
				console.log(body);
			}
    }
	//Make GET Request
    request(options, callback);
	}
	else{
		console.log("Grabbing top streams for \"%s\" from Twitch API.", req.query.game);
		var browse_game = req.query.game.replace(/[ ]+/g, '+');
		var options = {
			url: 'https://api.twitch.tv/kraken/streams/' + '?game=' + browse_game,
			method: 'GET',
			headers: {
				'Client-ID': client_id,
			},
		}
		//Handle GET Request
		function callback(error, response, body) {
			if(!error && response.statusCode == 200) {
				var readfile = JSON.parse(body);
				var streams_object = readfile.streams;
				//console.log("streams_object length: " + streams_object.length);
				var channels_arr = {
					channels: [],
				};
				if(Object.keys(streams_object).length > 0)
				{
					for(var i = 0; i < Object.keys(streams_object).length; i++)
					{
						var channel_object = JSON.stringify(streams_object[i].channel.name).replace(/["]+/g, '');
						//console.log(channel_object);
						channels_arr.channels.push(channel_object);
					}
				}
				else
				{
					console.log("Unable to grab channels for \"%s\".", req.query.game);
				}
				res.json(channels_arr);
			}
			else
			{
				console.log('Error: ' + response.statusCode);
				console.log(body);
			}
		}
		//Make GET Request
		request(options, callback);
	}
});

router.get('/following', function(req, res) {
	var following_auth_code = req.query.code;
	console.log("User code: %s", following_auth_code);
	var following_user_leaf = new user_data;
	for(var i = 0; i < user_list.auth_token.length; i++)
	{
		console.log("%s", user_list.auth_token[i]);
		if(user_list.auth_token[i] == following_auth_code)
		{
			console.log("Found a match!");
			following_user_leaf.name = user_list.name[i];
			following_user_leaf.auth_token = user_list.auth_token[i];
			following_user_leaf.access_token = user_list.access_token[i];
			break;
		}
	}	
	var following_channels = getFollowListUpdate(following_user_leaf);
	res.json(following_channels);
});

app.use('/api', router);

//Server Webhosting
app.get('/', function (req, res) {
	res.sendFile(__dirname + '/login.html');
	console.log('login.html served up!');
	sync_database(user_list);
	syncDatabaseBrowseList();
});

app.get('/home', function (req, res) {
    res.sendFile(__dirname + '/home.html');
	console.log('Process client request on /home.');
	console.log('    Client auth_token: ' + req.query.code);
	if(checkAccessCode(req.query.code) == 1)
	{
		console.log("Previous user detected!");
		
		res.setTimeout(2000, function() {
			res.redirect('/');
		});
		//res.redirect('/');
		//setTimeout(function() {
		//	//console.log("redirect activated");
		//	res.redirect('/');
		//	res.end();
		//}, 2000);
	}
	else
	{
		console.log("New user detected!");
	    getAccessToken(req.query.code);
	}
});

app.get('/remote', function (req, res) {
	res.sendFile(__dirname + '/remote.html');
});

app.get('/connect', function (req, res) {
	res.sendFile(__dirname + '/connect.html');
});

app.post('/remote', function (req, res) {
	//Replace all this with forEach(snapshot.key) for the username + mobile key
		//To validate
		console.log("Hit connect!");
		
		console.log(req.body);
		//console.log(res.body);
		var user_to_check = req.body.username;
		var key_to_check = req.body.mobile_key;
		
		console.log(user_to_check);
		console.log(key_to_check);
		
		var user_found = 0;
		var key_found = 0;
		
		for(var i = 0; i < user_list.name.length; i++)
		{
			//console.log(user_list.name[i]);
			if(user_to_check == user_list.name[i])
			{
				console.log("Found matching ID!");
				user_found = 1;
				break;
			}
		}
		if(user_found == 1)
		{
			for(var j = 0; j < user_list.mobile_key.length; j++)
			{
				//console.log(user_list.mobile_key[j]);
				if(key_to_check == user_list.mobile_key[j])
				{
					console.log("Found matching key!");
					key_found = 1;
					break;
				}
			}
		}
		//Add mobile
		if(user_found == 1 && key_found == 1)
		{
			console.log("POST Success!");
			//res.json({message: 'Success.'});
            firebase.database().ref('/users/' + user_to_check + '/mobile_connected').set(true);
			res.redirect('/remote');
		}
		if(user_found == 0 || key_found == 0)
		{
			console.log("POST FAIL!");
			//res.json({});
			res.redirect('/connect?fail');
		}
        res.end();
});

app.get('/favicon.png', function(req, res) {
    res.sendFile(__dirname + '/favicon.png');
});

app.listen(3000, function () {
	console.log('ttVision listening on port 3000!');
});

//setInterval(checkHeartBeat, 30000);s
