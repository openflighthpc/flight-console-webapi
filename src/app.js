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

// Adds the public key to the users authorized_keys file
// NOTE: The service is pre-configured with the public key
// It does not accept a key from the user by design
apiRouter.put('/ssh/authorized_key', function(req, res, next) {
  fs.readFile('/etc/passwd', 'utf8', function(err, passwd) {
    if (err) {
      debug("Could not load: /etc/passwd");
      debug(err)
      res.statusCode = 500;
      res.end("Failed to locate your authorized_keys");
      return
    }

    // Determine the user's authorized_keys file
    var entry = passwd.split("\n")
                      .map(v => v.split(':'))
                      .find( v => v[0] == req.session.username);
    var keys_path = path.join(entry.slice(-2)[0], '.ssh', 'authorized_keys');
    var uid = parseInt(entry[2]);
    var guid = parseInt(entry[3]);

    // Ensure the keys file exists
    if (! fs.existsSync(keys_path)) {
      fs.closeSync(fs.openSync(keys_path, 'w'));
      fs.chownSync(keys_path, uid, guid);
    }

    // Applies they key to the file
    fs.readFile(keys_path, 'utf8', function(err, keys) {
      if (err) {
        debug("Could not read: " + keys_path);
        debug(err)
        res.statusCode = 500;
        res.end("Failed to read your authorized_keys");
        return
      }

      if (keys.includes(public_key)) {
        res.statusCode = 200;
        res.end("Your authorized_keys have not been changed");
        return
      } else {
        // Appends the public_key to the existing keys ensure it nicely padded with newlines
        if (keys.slice(-1)[0] != "\n") {
          keys = keys.concat("\n");
        }
        keys = keys.concat(public_key)
        if (keys.slice(-1)[0] != "\n") {
          keys = keys.concat("\n");
        }

        // Write the updated keys file
        fs.writeFile(keys_path, keys, function(err) {
          if (err) {
            debug("Could not write: " + keys_path);
            debug(err);
            res.statusCode = 500;
            res.end("Failed to update your authorized_keys");
            return
          }

          res.statusCode = 200;
          res.end("Updated your authorized_keys");
          return
        });
      }
    });
  });
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
