import express from 'express';        
import path from 'node:path';
import killable from 'killable';
import Twilio from 'twilio';
import { Server } from 'socket.io';
import http from 'http';
import Room from './room.js';
let cachedToken = null;
import config from './config.js';
let nofusers = 0;
let window;
let server: any;
let mainServer: boolean | string = true;
let rooms: Room[] = [];
function getNewToken(errors: boolean | string) {
    function token() {
        const twilio = Twilio(config.TWILIO_ACCOUNT_SID || "", config.TWILIO_AUTH_TOKEN || "");
        twilio.tokens.create({}, function (err, token) {
            if (!err && token) {
                cachedToken = token;
            }
        });
    }
    switch(errors) {
        case true:
        case 'true':
            console.log("Twilio info not provided. Cannot start")
            break;
        case false:
        case 'false':
            token();
            break;
    }
}

//this is the inital code running starting everything
switch(config.TWILIO_ACCOUNT_SID) {
    case null:
    case undefined:
    case "":
        getNewToken(true);
        break;
    default:
        getNewToken(false);
        main();
}

function getRoom(domain: string, game_id: number, sessionid: string) {
    for (let i=0; i<rooms.length; i++) {
        if (rooms[i].id === domain + ':' + game_id + ':' + sessionid) {
            return rooms[i];
        }
    }
    return null;
}

function checkAuth(authorization: any, passwordforserver: string) {
    if (!authorization) return false;
    const [username, password] = Buffer.from(authorization.replace('Basic ', ''), 'base64').toString().split(':')
    return username === 'admin' && password === passwordforserver;
}

function makeServer() {
    const app = express();
    server = http.createServer(app);
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.get('/', (req, res) => {
        const reject = () => {
            res.setHeader('www-authenticate', 'Basic');
            res.sendStatus(401);
        }
        if (!checkAuth(req.headers.authorization, config.passwordforserver)) {
            return reject();
        }
        //send the index.html file located at /website with all assets too
        app.use(express.static(path.join(__dirname, '../website/')))
        res.sendFile(path.join(__dirname, '../website/index.html'));
    });
    app.post('/startstop', (req: any, res: any) => {
        const reject = () => {
            res.setHeader('www-authenticate', 'Basic');
            res.sendStatus(401);
        }
        if (!checkAuth(req.headers.authorization, config.passwordforserver)) {
            return reject();
        }
        if (req.body.function === "stop") {
            mainServer = false;
            res.end('true');
            server.kill(() => {
                makeServer();
            });
        } else {
            mainServer = true;
            res.end('true');
            server.kill(function() {
                makeServer();
            });
        }
    });
    app.post('/check', (req: any, res: any) => {
        const reject = () => {
            res.setHeader('www-authenticate', 'Basic')
            res.sendStatus(401)
        }
        if (!checkAuth(req.headers.authorization, config.passwordforserver)) {
            return reject();
        }
        res.end(mainServer.toString());
    });
    app.post('/numusers', (req: any, res: any) => {
        const reject = () => {
            res.setHeader('www-authenticate', 'Basic')
            res.sendStatus(401)
        }
        if (!checkAuth(req.headers.authorization, config.passwordforserver)) {
            return reject();
        }
        res.end('{ "users": ' + nofusers + " }");
    });
    server.listen(3000, () => {
        console.log('listening on *:3000');
    });
    killable(server);
}

//this is the code that actually starts to run things
async function main() {
    setInterval(() => { getNewToken(false) }, 1000*60*10);
    if (mainServer === true) {
        makeServer();
        //makeSocket();
    }
    else {
        //makeServer();
    }
}
