'use strict'
/* jshint esversion: 6, asi: true, node: true */
// app.js

const cors = require('cors');
const debug = require('debug')('flight:console');
const express = require('express');
const http = require('http');
const logger = require('morgan');
const socketIO = require('socket.io');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const async = require('async');

const cookieParser = require('cookie-parser');
const auth = require('./auth')
const checkAuthentication = require('./sshUtils').checkAuthentication;
const config = require('./config').config;
const expressOptions = require('./expressOptions')
const SshSession = require('./sshSession')
const ShutdownGuard = require('./shutdownGuard');
const SessionPopulator = require('./sessionPopulator');

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

// Ensures the privateKey exists
var private_key
if (fs.existsSync(config.ssh.private_key_path)) {
  console.log("Using private key: " + config.ssh.private_key_path)
  private_key = fs.readFileSync(config.ssh.private_key_path, 'utf8')
  Object.freeze(private_key)
} else {
  throw "Could not locate the private key: " + config.ssh.private_key_path
}

// Ensures the public_key exists
var public_key
if (fs.existsSync(config.ssh.public_key_path)) {
  console.log("Using public key: " + config.ssh.public_key_path)
  public_key = fs.readFileSync(config.ssh.public_key_path, 'utf8')
  Object.freeze(public_key)
} else {
  throw "Could not locate the public key: " + config.ssh.public_key_path
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
  const populator = new SessionPopulator(config, private_key).populate(req);

  checkAuthentication(req.session)
    .then(() => { res.status(200).send({
      pwd: req.session.ssh.pwd,
      cwd: req.session.ssh.cwd || req.session.ssh.pwd
    }) })
    .catch((err) => {
      debug('checkAuthentication failed: %o', err);
      const dir_regex = /^\?dir:/;
      if (err.message === 'Unexpected packet before version') {
        res
          .status(422)
          .header('Content-Type', 'application/json')
          .send(JSON.stringify( { errors: [ {
            code: 'Unexpected SFTP STDOUT', recoverable: true
          }]}))
      } else if (err.message.match(dir_regex)) {
        res.status(422)
           .header('Content-Type', 'application/json')
           .send(JSON.stringify({ errors: [{
             code: err.message.substring(5), recoverable: true
           }]}));
      } else if (err.level === 'client-authentication') {
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

// Adds the public key to the users authorized_keys file
// NOTE: The service is pre-configured with the public key
// It does not accept a key from the user by design
apiRouter.put('/ssh/authorized_key', function(req, res, next) {
  const args = [
    `${__dirname}/../libexec/add_key.rb`, req.session.username, public_key
  ];
  const child = spawnSync(config.ruby, args, { 'env': {}, 'shell': false });
  debug(`Ran add_key.rb`);
  debug("STATUS:");
  debug(child.status);
  if (child.stdout != null) {
    debug("STDOUT:");
    debug(child.stdout.toString('utf8'));
  }
  if (child.stdout != null) {
    debug("STDERR:");
    debug(child.stderr.toString('utf8'));
  }
  if (child.status === 0) {
    res.statusCode = 200;
    res.end(child.stdout.toString('utf8'));;
  } else {
    debug("Failed to add the authorized_keys");
    res.statusCode = 500;
    res.end("Failed to add the key");
  }
});

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

// Bring up socket

// XXX This is a hack.  There should be a registry of HTTP sessions to SSH
// sessions. Eventually we'd support multiple possible sessions per user, but
// perhaps a single session per user is sufficient to start with.
let sshSession;

io.on('connection', async (socket) => {
  if (sshSession) {
    sshSession.reconnect(socket);

  } else {
    sshSession = new SshSession(socket);
    const isOK = await (sshSession.preFlightChecks());
    if (isOK) {
      sshSession.connect();
    }
  }
});

const shutdownGuard = new ShutdownGuard(io, server, config.safeShutdownDuration);

function safeShutdownGuard (req, res, next) {
  if (shutdownGuard.isShuttingDown) {
    res.status(503).end('Service unavailable: Server shutting down');
  } else {
    return next();
  }
}

io.on('connection', function (socket) {
  shutdownGuard.onConnection(socket);

  socket.on('disconnect', function () {
    shutdownGuard.onDisconnection(socket);
  })
})

const signals = ['SIGTERM', 'SIGINT']
signals.forEach(signal => process.on(signal, function () {
  shutdownGuard.shutdown();
}))

module.exports = { server: server }
