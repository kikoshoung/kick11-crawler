/**
 * @author nttdocomo
 */
var http = require("http"), cheerio = require('cheerio'),StringDecoder = require('string_decoder').StringDecoder,mysql = require('mysql'),moment = require('moment'),Crawler = require("simplecrawler"),
pool  = require('../pool'),trim = require('../utils').trim,
host = 'http://www.transfermarkt.co.uk';
crawler = require('../crawler');
crawler.discoverResources = false;
crawler.on("fetchcomplete",function(queueItem, responseBuffer, response){
    var decoder = new StringDecoder('utf8');
    if(/^\/\S+\/gesamtspielplan\/wettbewerb\/\S+?$/.test(queueItem.path)){
    	var $ = cheerio.load(decoder.write(responseBuffer)),
    	tables = $('#main > .six.columns'),
    	year = $("select[name='saison_id']").find("option:selected").val(),
    	season = $("select[name='saison_id']").find("option:selected").text(),
    	competition_url = $('#submenue > li').eq(1).find('a').attr('href'),
    	competition_id = competition_url.replace(/^\/\S+?\/([A-Z\d]{2,4})(\/\S+?)?(\/saison_id\/\d{4})?$/,'$1');
    	console.log(year + season.replace(/\d{2}(\/\d{2})/,'$1'));
    	console.log(competition_id);
		var sql = mysql.format("SELECT events.id AS id FROM `events` JOIN (SELECT competition.id AS competitions_id FROM `competition` JOIN (SELECT * FROM `transfermarket_competition` WHERE competition_id = ?)`transfermarket_competition` ON transfermarket_competition.competition_name = competition.name)`competition` ON events.competition_id = competition.competitions_id JOIN (SELECT seasons.id AS seasons_id FROM `seasons` WHERE name = ?)`seasons` ON events.season_id = seasons_id", [competition_id,year + season.replace(/\d{2}(\/\d{2})/,'$1')]);
		pool.getConnection(function(err, connection) {
			connection.query(sql, function(err,rows) {
			    if (err) throw err;
			    var event_id = rows[0].id;
			    connection.release();
				tables.each(function(index,el){
					var $el = $(el),
					matchday = $el.find('.table-header').text(),
					date,
					data_array = [],
					time,
					play_at,
					table = $el.find('> table'),
					trow = table.find('> tbody > tr');
					getRound(event_id,matchday,index+1,(function(tr){
						return function(matchday_id){
							for (var i = 0; i < tr.length; i++) {
								var row = $(tr[i]),td = row.children(),
								date = td.eq(0).find('a').text() || date,
								time = trim(td.eq(1).text()) || time,
								team_1_id = td.eq(2).find('a').attr('href').replace(/\S+?(\d{1,})\/\S+?$/,'$1'),
								team_2_id = td.eq(6).find('a').attr('href').replace(/\S+?(\d{1,})\/\S+?$/,'$1'),
								team_1_name = td.eq(3).find('img').attr('title'),
								team_2_name = td.eq(5).find('img').attr('title'),
								result = td.eq(4).find('a'),
								result = result.length ? result.text().split(':') : undefined,
								score1 = result ? result[0] : undefined,
								score2 = result ? result[1] : undefined,
								time = time == '-' ? '00:00':time,
								play_at = moment([date,time].join(' ')).format('YYYY-MM-DD HH:mm:ss');
								console.log([matchday_id,play_at,team_1_name,score1,score2,team_2_name].join('<<<>>>'));
								getTeamIdByTeamName(team_1_name,(function(team_name,matchday_id,play_at){
									return function(team_1_id){
										getTeamIdByTeamName(team_name,function(team_2_id){
											pool.getConnection(function(err, connection) {
												var sql = mysql.format('INSERT INTO `matchs` (round_id,team1_id,team2_id,play_at'+ (score1 && score2 ? ',score1, score2' : '') +') SELECT ? FROM dual WHERE NOT EXISTS(SELECT round_id,team1_id,team2_id,play_at'+ (score1 && score2 ? ',score1, score2' : '') +' FROM `matchs` WHERE round_id = ? AND team1_id = ? AND team2_id = ? AND play_at = ?)', [score1 && score2 ? [matchday_id,team_1_id,team_2_id,play_at,score1,score2] : [matchday_id,team_1_id,team_2_id,play_at],matchday_id,team_1_id,team_2_id,play_at]);
												connection.query(sql, function(err,rows) {
													if (err) throw err;
													connection.release();
												});
											});
										})
									}
								})(team_2_name,matchday_id,play_at,score1,score2))
								data_array.push(date);
								//console.log([matchday_id,play_at,team_1_name,team_2_name].join('-------'));
							};
							updateRound(data_array);
						}
					})(trow));
				});
			});
		});
    };
}).on('complete',function(){
	console.log('complete');
}).on('fetcherror',function(queueItem, response){
	crawler.queueURL(host + queueItem.path);
}).on('fetchtimeout',function(queueItem, response){
	crawler.queueURL(host + queueItem.path);
}).on('fetchclienterror',function(queueItem, response){
	crawler.queueURL(host + queueItem.path);
});
/*crawler.queueURL(host + '/cristiano-ronaldo/transfers/spieler/8198');
crawler.start();*/
pool.getConnection(function(err, connection) {
	connection.query("SELECT transfermarket_competition.uri FROM `competition` JOIN `nation` ON competition.nation_id = nation.id JOIN `transfermarket_nation` ON nation.full_name = transfermarket_nation.name JOIN `transfermarket_competition` ON transfermarket_competition.nation_id = transfermarket_nation.id WHERE transfermarket_competition.competition_name IN (SELECT name FROM `competition`)", function(err,rows) {
	    if (err) throw err;
	    for (var i = rows.length - 1; i >= 0; i--) {
		    var path = rows[i].uri;
		    path = path.replace('startseite','gesamtspielplan');
	    	crawler.queueURL(host + path);
	    };
	    connection.release();
	    crawler.start();
	});
});
function getTeamIdByTeamName(team_name,callback){
	pool.getConnection(function(err, connection) {
		var sql = mysql.format("SELECT id FROM team WHERE team_name = ?", [team_name]);
		connection.query(sql, function(err,rows) {
		    if (err) throw err;
		    callback(rows[0].id)
		    connection.release();
		});
	});
}
function updateRound(data_array){
	pool.getConnection(function(err, connection) {
		connection.query('UPDATE `rounds` SET ?', {
			start_at:moment(data_array[0]).format('YYYY-MM-DD'),
			end_at:moment(data_array[data_array.length - 1]).format('YYYY-MM-DD')
		}, function(err,rows) {
			if (err) throw err;
			connection.release();
		});
	});
}
function getRound(event_id,matchday,pos,callback){
	pool.getConnection(function(err, connection) {
		connection.query('SELECT id FROM `rounds` WHERE event_id = ? AND name = ?', [event_id,matchday], function(err,rows) {
			if(rows.length){
				callback(rows[0].id)
			} else {
				insertRound(event_id,matchday,pos,callback);
			}
			connection.release();
		});
	});
}
function insertRound(event_id,matchday,pos,callback){
	pool.getConnection(function(err, connection) {
		var sql = mysql.format('INSERT INTO `rounds` (event_id,name,pos) VALUES (?)', [[event_id, matchday, pos]]);
		console.log(sql);
		connection.query(sql, function(err,rows) {
			if (err) throw err;
			getRound(event_id,matchday,pos,callback);
			connection.release();
		});
	});
}