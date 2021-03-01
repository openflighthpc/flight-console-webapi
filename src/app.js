'use strict'
/* jshint esversion: 6, asi: true, node: true */
// app.js

const cors = require('cors');
const debug = require('debug')('flight:console');
const express = require('express');
const http = require('http');
const logger = require('morgan');
const socketIO = require('socket.io');
const validator = require('validator');
const fs = require('fs');

const cookieParser = require('cookie-parser');
const auth = require('./auth')
const checkAuthentication = require('./sshUtils').checkAuthentication;
const config = require('./config').config;
const expressOptions = require('./expressOptions')
const sshConnection = require('./sshConnection')
const ShutdownGuard = require('./shutdownGuard');

const apiRouter = express.Router();

const session = require('express-session')({
  secret: config.session.secret,
  name: config.session.name,
  resave: true,
  saveUninitialized: false,
  unset: 'destroy'
})

const app = express()
const server = http.Server(app);

// Creates the authentication object
var flightAuth
if (fs.existsSync(config.sso.shared_secret_path)) {
  console.log("Loading shared secret: " + config.sso.shared_secret_path);
  flightAuth = auth.flight_auth(fs.readFileSync(config.sso.shared_secret_path), config.sso.cookie_name);
  Object.freeze(flightAuth);
} else {
  throw "Could not locate shared secret: " + config.sso.shared_secret_path
}

// Ensures the private_key exists
var private_key
if (fs.existsSync(config.ssh.private_key_path)) {
  console.log("Using private key: " + config.ssh.private_key_path)
  private_key = fs.readFileSync(config.ssh.private_key_path, 'utf8')
} else {
  throw "Could not locate the private key: " + config.ssh.private_key_path
}

// express
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(safeShutdownGuard);
app.use(session);
app.use(cookieParser());
app.use(flightAuth);
if (config.accesslog) { app.use(logger('common')); }
app.disable('x-powered-by');

apiRouter.get('/ping', function(req, res, next) {
  // If we get here, the auth module has let us through.
  res.status(200).send('OK');
});

// eslint-disable-next-line complexity
apiRouter.get('/ssh/host/:host?', function (req, res, next) {
  debug('APP setting session variables: %O %O', req.params, req.query);
  // capture, assign, and validated variables
  req.session.ssh = {
    host: (validator.isIP(req.params.host + '') && req.params.host) ||
      (validator.isFQDN(req.params.host) && req.params.host) ||
      (/^(([a-z]|[A-Z]|[0-9]|[!^(){}\-_~])+)?\w$/.test(req.params.host) &&
      req.params.host) || config.ssh.host,
    port: (validator.isInt(req.query.port + '', { min: 1, max: 65535 }) &&
      req.query.port) || config.ssh.port,
    privateKey: private_key,
    localAddress: config.ssh.localAddress,
    localPort: config.ssh.localPort,
    algorithms: config.algorithms,
    keepaliveInterval: config.ssh.keepaliveInterval,
    keepaliveCountMax: config.ssh.keepaliveCountMax,
    allowedSubnets: config.ssh.allowedSubnets,
    term: (/^(([a-z]|[A-Z]|[0-9]|[!^(){}\-_~])+)?\w$/.test(req.query.sshterm) &&
      req.query.sshterm) || config.ssh.term,
    mrhsession: ((validator.isAlphanumeric(req.headers.mrhsession + '') && req.headers.mrhsession) ? req.headers.mrhsession : 'none'),
    readyTimeout: (validator.isInt(req.query.readyTimeout + '', { min: 1, max: 300000 }) &&
      req.query.readyTimeout) || config.ssh.readyTimeout
  }

  checkAuthentication(req.session)
    .then(() => { res.status(200).send('OK') })
    .catch((err) => {
      debug('checkAuthentication failed: %o', err);
      if (err.level === 'client-authentication') {
        res
          .status(422)
          .header('Content-Type', 'application/json')
          .send(JSON.stringify( { errors: [ { code: 'Missing SSH Configuration' } ]}));
      } else {
        res
          .status(500)
          .header('Content-Type', 'application/json')
          .send(JSON.stringify( { errors: [ { code: 'Internal Server Error' } ]}));
      }
    });

})

app.use('/', apiRouter);

// express error handling
app.use(function (req, res, next) {
  res
    .status(404)
    .header('Content-Type', 'application/json')
    .send(JSON.stringify( { errors: [ { code: 'Not Found' } ]}));
})

app.use(function (err, req, res, next) {
  console.error(err.stack)
  res
    .status(500)
    .header('Content-Type', 'application/json')
    .send(JSON.stringify( { errors: [ { code: 'Internal Server Error' } ]}));
})

// socket.io
const io = socketIO(server, { serveClient: false, path: '/ssh/socket.io' });

// expose express session with socket.request.session
io.use(function (socket, next) {
  (socket.request.res) ? session(socket.request, socket.request.res, next)
    : next(next)
})

// bring up socket
io.on('connection', sshConnection)

const shutdownGuard = new ShutdownGuard(io, server, config.safeShutdownDuration);

function safeShutdownGuard (req, res, next) {
  if (shutdownGuard.isShuttingDown) {
    res.status(503).end('Service unavailable: Server shutting down');
  } else {
    return next();
  }
}

io.on('connection', function (socket) {
  shutdownGuard.onConnection();

  socket.on('disconnect', function () {
    shutdownGuard.onDisconnection();
  })
})

const signals = ['SIGTERM', 'SIGINT']
signals.forEach(signal => process.on(signal, function () {
  shutdownGuard.shutdown();
}))

module.exports = { server: server }
