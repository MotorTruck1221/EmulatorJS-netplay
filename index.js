// Before this application is released, this needs to be cleaned up.
// We need to use "let" and "const" instead of var and use semi colons

// I already fixed the cors error

const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const killable = require('killable');
let webrtcServers = [];
let config;
if (process.env.NP_PASSWORD) {
    config = {
        "passwordforserver" : process.env.NP_PASSWORD
    }
} else {
    config = require('./config.json');
}
const Room = require('./room.js');

let window;
let server;
global.rooms = [];
let mainserver = true;

function getRoom(domain, game_id, sessionid) {
    for (let i=0; i<global.rooms.length; i++) {
        if (global.rooms[i].id === domain + ':' + game_id + ':' + sessionid) {
            return global.rooms[i];
        }
    }
    return null;
}

if (mainserver == true) {
    makeServer(process.env.PORT);
} else if (mainserver == false) {
    makeServer(process.env.PORT, false);
} else {
    console.error("Error: Default server status no set!");
}

function checkAuth(authorization, passwordforserver) {
    if (!authorization) return false;
    const [username, password] = Buffer.from(authorization.replace('Basic ', ''), 'base64').toString().split(':')
    return username === 'admin' && password === passwordforserver;
}

function makeServer(port, startIO) {
    const app = express();
    server = http.createServer(app);
    const router = express.Router();
    app.use(express.urlencoded());
    app.use(express.json());
    router.get('/', (req, res) => {
        const reject = () => {
            res.setHeader('www-authenticate', 'Basic')
            res.sendStatus(401)
        }
        if (!checkAuth(req.headers.authorization, config.passwordforserver)) {
            return reject();
        }
        res.sendFile(path.join(__dirname + '/index.html'));
    });
    router.get('/img/:imageName', function(req, res) {
        var image = req.params['imageName'];
        try {
            res.sendFile(path.join(__dirname + '/img/' + image));
        } catch (err) {
            res.sendStatus(401)
        }
    });
    app.use('/', router);
    app.post('/startstop', (req, res) => {
        const reject = () => {
            res.setHeader('www-authenticate', 'Basic');
            res.sendStatus(401);
        }
        if (!checkAuth(req.headers.authorization, config.passwordforserver)) {
            return reject();
        }
        console.log(req.body.function);
        if (req.body.function === "stop") {
            mainserver = false;
            res.end('true');
            server.kill(() => {
                makeServer(process.env.PORT, false);
            });
        } else {
            mainserver = true;
            res.end('true');
            server.kill(function() {
                makeServer(process.env.PORT);
            });
        }
    });
    app.post('/check', (req, res) => {
        const reject = () => {
            res.setHeader('www-authenticate', 'Basic')
            res.sendStatus(401)
        }
        if (!checkAuth(req.headers.authorization, config.passwordforserver)) {
            return reject();
        }
        res.end(mainserver.toString());
    });
    app.post('/numusers', (req, res) => {
        const reject = () => {
            res.setHeader('www-authenticate', 'Basic')
            res.sendStatus(401)
        }
        if (!checkAuth(req.headers.authorization, config.passwordforserver)) {
            return reject();
        }
        let nofusers = 0;
        res.end('{ "users": ' + nofusers + " }");
    });

    if (startIO !== false) {
        app.get('/webrtc', (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(webrtcServers));
        });
        app.get('/list', function(req, res) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json');
            var args = transformArgs(req.url)
            if (!args.game_id || !args.domain || !args.coreVer) {
                res.end('{}');
                return;
            }
            args.game_id = parseInt(args.game_id);
            args.coreVer = parseInt(args.coreVer);
            let rv = {};
            for (let i=0; i<global.rooms.length; i++) {
                //console.log(global.rooms[i].domain, args.domain);
                //console.log(global.rooms[i].game_id, args.game_id);
                if (global.rooms[i].domain !== args.domain ||
                    global.rooms[i].game_id !== args.game_id ||
                    global.rooms[i].coreVer !== args.coreVer) continue;
                rv[global.rooms[i].sessionid] = {
                    owner_name: global.rooms[i].owner.extra.name,
                    room_name: global.rooms[i].name,
                    country: 'US',
                    max: global.rooms[i].max,
                    current: global.rooms[i].current,
                    password: (global.rooms[i].password.trim() ? 1 : 0)
                }
            }
            res.end(JSON.stringify(rv));
        })
        const io = require("socket.io")(server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"],
                credentials: true
            }
        });
        io.on('connection', (socket) => {
            let url = socket.handshake.url;
            let args = transformArgs(url);
            let room = null;
            let extraData = JSON.parse(args.extra);

            function disconnect() {
                try {
                    if (room === null) return;
                    io.to(room.id).emit('user-disconnected', args.userid);
                    for (let i=0; i<room.users.length; i++) {
                        if (room.users[i].userid === args.userid) {
                            room.users.splice(i, 1);
                            break;
                        }
                    }
                    if (!room.users[0]) {
                        for (let i=0; i<global.rooms.length; i++) {
                            if (global.rooms[i].id === room.id) {
                                global.rooms.splice(i, 1);
                            }
                        }
                    } else {
                        if (room.owner.userid === args.userid) {
                            room.owner = room.users[0];
                            room.owner.socket.emit('set-isInitiator-true', args.sessionid);
                        }
                        room.current = room.users.length;
                    }
                    socket.leave(room.id);
                    room = null;
                } catch (e) {
                    console.warn(e);
                }
            }
            socket.on('disconnect', disconnect);


            socket.on('close-entire-session', function(cb) {
                io.to(room.id).emit('closed-entire-session', args.sessionid, extraData);
                if (typeof cb === 'function') cb(true);
            })
            socket.on('open-room', function(data, cb) {
                room = new Room(data.extra.domain, data.extra.game_id, args.sessionid, data.extra.room_name, args.maxParticipantsAllowed, 1, data.password.trim(), args.userid, socket, data.extra, args.coreVer);
                global.rooms.push(room);
                extraData = data.extra;

                socket.emit('extra-data-updated', null, extraData);
                socket.emit('extra-data-updated', args.userid, extraData);

                socket.join(room.id);
                cb(true, undefined);
            })


            socket.on('check-presence', function(roomid, cb) {
                cb(getRoom(extraData.domain, extraData.game_id, roomid)!==null, roomid, null);
            })
            socket.on('join-room', function(data, cb) {

                room = getRoom(data.extra.domain, data.extra.game_id, data.sessionid);
                if (room === null) {
                    cb(false, 'USERID_NOT_AVAILABLE');
                    return;
                }
                if (room.current >= room.max) {
                    cb(false, 'ROOM_FULL');
                    return;
                }
                if (room.hasPassword && !room.checkPassword(data.password)) {
                    cb(false, 'INVALID_PASSWORD');
                    return;
                }

                room.users.forEach(user => {
                    socket.to(room.id).emit("netplay", {
                        "remoteUserId": user.userid,
                        "message": {
                            "newParticipationRequest": true,
                            "isOneWay": false,
                            "isDataOnly": true,
                            "localPeerSdpConstraints": {
                                "OfferToReceiveAudio": false,
                                "OfferToReceiveVideo": false
                            },
                            "remotePeerSdpConstraints": {
                                "OfferToReceiveAudio": false,
                                "OfferToReceiveVideo": false
                            }
                        },
                        "sender": args.userid,
                        "extra": extraData
                    })
                })

                room.addUser({
                    userid: args.userid,
                    socket,
                    extra: data.extra
                });

                socket.to(room.id).emit('user-connected', args.userid);

                socket.join(room.id);

                cb(true, null);
            })
            socket.on('set-password', function(password, cb) {
                if (room === null) {
                    if (typeof cb === 'function') cb(false);
                    return;
                }
                if (typeof password === 'string' && password.trim()) {
                    room.password = password;
                    room.hasPassword = true;
                } else {
                    room.password = password.trim();
                    room.hasPassword = false;
                }
                if (typeof cb === 'function') cb(true);
            });
            socket.on('changed-uuid', function(newUid, cb) {
                if (room === null) {
                    if (typeof cb === 'function') cb(false);
                    return;
                }
                for (let i=0; i<room.users.length; i++) {
                    if (room.users[i].userid === args.userid) {
                        room.users[i].userid = newUid;
                        break;
                    }
                }
                if (typeof cb === 'function') cb(true);
            });
            socket.on('disconnect-with', function(userid, cb) {
                //idk
                if (typeof cb === 'function') cb(true);
            })
            socket.on('netplay', function(msg) {
                if (room === null) return;
                const outMsg = JSON.parse(JSON.stringify(msg));
                outMsg.extra = extraData;
                socket.to(room.id).emit('netplay', outMsg);
                if (msg && msg.message && msg.message.userLeft === true) disconnect();
            })
            socket.on('extra-data-updated', function(msg) {
                if (room === null) return;
                var outMsg = JSON.parse(JSON.stringify(msg))
                outMsg.country = 'US';
                extraData = outMsg;

                for (let i=0; i<room.users.length; i++) {
                    if (room.users[i].userid === args.userid) {
                        room.users[i].extra = extraData;
                        break;
                    }
                }

                io.to(room.id).emit('extra-data-updated', args.userid, outMsg);
            })
            socket.on('get-remote-user-extra-data', function(id) {
                if (room === null) return;
                for (let i=0; i<room.users.length; i++) {
                    if (room.users[i].userid === id) {
                        socket.emit('extra-data-updated', room.users[i].extra);
                    }
                }
            })
        });
    }


    server.listen(port || 3000, '0.0.0.0', () => {
        console.log('The Main Server is now running on port :' + (port || 3000));
    });
    killable(server);
}

function transformArgs(url) {
    var args = {}
    var idx = url.indexOf('?')
    if (idx != -1) {
        var s = url.slice(idx + 1)
        var parts = s.split('&')
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i]
            var idx2 = p.indexOf('=')
            args[decodeURIComponent(p.slice(0, idx2))] = decodeURIComponent(p.slice(idx2 + 1, s.length))
        }
    }
    return args
}

function getWebrtcServers() {
    https.get('https://webrtc.emulatorjs.org/', resp => {
        let chunks = [];
        resp.on('data', chunk => chunks.push(chunk));
        resp.on('end', () => {
            let body = Buffer.concat(chunks);
            webrtcServers = JSON.parse(body.toString());
        });
    }).on('error', (e) => {
        res.end("error");
    });
}
getWebrtcServers();
setInterval(getWebrtcServers, 900000);