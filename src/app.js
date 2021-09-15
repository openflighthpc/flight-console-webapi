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
const path = require('path');
const { spawnSync } = require('child_process');
const async = require('async');

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
  debug('APP setting session variables: %O %O', req.params, req.query);

  // capture, assign, and validated variables
  req.session.unverified_dir = (
    (req.query.dir + '').match(/^[0-9a-zA-Z_ ./-]*$/) && req.query.dir
  ) || null

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
            code: 'Unexpected SFTP STDOUT', type: 'SFTP', basic: true
          }]}))
      } else if (err.message.match(dir_regex)) {
        res.status(422)
           .header('Content-Type', 'application/json')
           .send(JSON.stringify({ errors: [{
             code: err.message.substring(5), type: 'dir', basic: true
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
  var args = ['-e', `require 'json'; require 'etc'; puts Etc.getpwnam('${req.session.username}').to_h.to_json`]
  var child = spawnSync(config.ruby, args, { 'env': {}, 'shell': false, 'serialization': 'json' })
  if (child.error || child.status !== 0) {
    debug("Could not determine the users home directory");
    debug(
      child.error ? child.error.toString() : child.stderr.toString('utf8')
    );
    res.statusCode = 500;
    res.end("Failed to locate your authorized_keys");
    return
  }

  // Determine the user's authorized_keys file
  var stdout = JSON.parse(child.stdout.toString('utf8'));
  debug(stdout);
  var keys_path = path.join(stdout.dir, '.ssh', 'authorized_keys');
  var uid = stdout.uid;
  var gid = stdout.gid;
  debug("Determined the user's home/uid/guid")

  // Applies they key to the file
  res.statusCode = 500; // Default to an error has occurred
  async.waterfall(
    [
      // Reads the keys file
      function(c) {
        fs.readFile(keys_path, 'utf8', function(err, keys) {
          if (err && err.code === 'ENOENT') {
            fs.closeSync(fs.openSync(keys_path, 'w'));
            fs.chownSync(keys_path, uid, gid);
            c(null, '');
          } else if (err) {
            debug("Could not read: " + keys_path);
            debug(err);
            c("Failed to read your authorized_keys", null);
          } else if (keys.includes(public_key)) {
            res.statusCode = 200;
            c("Your authorized_keys have not been changed");
          } else {
            c(null, keys);
          }
        })
      },

      // Updates the keys file
      function(keys, c) {
        // Appends the public_key to the existing keys ensure it nicely padded with newlines
        if (keys.slice(-1)[0] != "\n") {
          keys = keys.concat("\n");
        }
        keys = keys.concat(public_key)
        if (keys.slice(-1)[0] != "\n") {
          keys = keys.concat("\n");
        }
        fs.writeFile(keys_path, keys, function(err) {
          if (err) {
            debug("Could not write: " + keys_path);
            debug(err);
            res.end("Failed to update your authorized_keys");
          } else {
            res.statusCode = 200
            c("Updated your authorized_keys", true)
          }
        })
      }
    ],
    function(msg, _) {
      res.end(msg);
    }
  )
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
