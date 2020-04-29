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

const auth = require('./auth')
const checkAuthentication = require('./sshUtils').checkAuthentication;
const config = require('./config').config;
const expressOptions = require('./expressOptions')
const sshConnection = require('./sshConnection')

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
auth.setDefaultCredentials(config.user.name, config.user.password, config.user.privatekey)

// express
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(safeShutdownGuard);
app.use(session);
app.use(auth.basicAuth);
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
          .status(401)
          .header('Content-Type', 'application/json')
          .send(JSON.stringify( { errors: [ { code: 'Unauthorized' } ]}));
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

// safe shutdown
var shutdownMode = false
var shutdownInterval = 0
var connectionCount = 0

function safeShutdownGuard (req, res, next) {
  if (shutdownMode) {
    res.status(503).end('Service unavailable: Server shutting down');
  } else {
    return next();
  }
}

io.on('connection', function (socket) {
  connectionCount++

  socket.on('disconnect', function () {
    if ((--connectionCount <= 0) && shutdownMode) {
      stop('All clients disconnected')
    }
  })
})

const signals = ['SIGTERM', 'SIGINT']
signals.forEach(signal => process.on(signal, function () {
  if (shutdownMode) {
    stop('Safe shutdown aborted, force quitting');
  } else if (connectionCount > 0) {
    var remainingSeconds = config.safeShutdownDuration
    shutdownMode = true

    var message = (connectionCount === 1) ? ' client is still connected'
      : ' clients are still connected'
    console.error(connectionCount + message)
    console.error('Starting a ' + remainingSeconds + ' seconds countdown')
    console.error('Press Ctrl+C again to force quit')

    shutdownInterval = setInterval(function () {
      if ((remainingSeconds--) <= 0) {
        stop('Countdown is over')
      } else {
        io.sockets.emit('shutdownCountdownUpdate', remainingSeconds)
      }
    }, 1000)
  } else {
    stop();
  }
}))

// clean stop
function stop (reason) {
  shutdownMode = false
  if (reason) console.log('Stopping: ' + reason)
  if (shutdownInterval) clearInterval(shutdownInterval)
  io.close();
  server.close();
  process.exit(0);
}

module.exports = { server: server }
