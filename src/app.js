'use strict'
/* jshint esversion: 6, asi: true, node: true */
// app.js

var debugWebSSH2 = require('debug')('WebSSH2')
var path = require('path')
var fs = require('fs')
var nodeRoot = path.dirname(require.main.filename)
var configPath = path.join(nodeRoot, 'config.json')
console.log('WebSSH2 service reading config from: ' + configPath)
var express = require('express')
var cors = require('cors')
var logger = require('morgan')

var apiRouter = express.Router();

// sane defaults if config.json or parts are missing
let config = {
  listen: {
    ip: '0.0.0.0',
    port: 2222
  },
  user: {
    name: null,
    password: null,
    privatekey: null
  },
  ssh: {
    host: null,
    port: 22,
    term: 'xterm-color',
    readyTimeout: 20000,
    keepaliveInterval: 120000,
    keepaliveCountMax: 10,
    allowedSubnets: []
  },
  session: {
    name: 'WebSSH2',
    secret: 'mysecret'
  },
  options: {
  },
  algorithms: {
    kex: [
      'ecdh-sha2-nistp256',
      'ecdh-sha2-nistp384',
      'ecdh-sha2-nistp521',
      'diffie-hellman-group-exchange-sha256',
      'diffie-hellman-group14-sha1'
    ],
    cipher: [
      'aes128-ctr',
      'aes192-ctr',
      'aes256-ctr',
      'aes128-gcm',
      'aes128-gcm@openssh.com',
      'aes256-gcm',
      'aes256-gcm@openssh.com',
      'aes256-cbc'
    ],
    hmac: [
      'hmac-sha2-256',
      'hmac-sha2-512',
      'hmac-sha1'
    ],
    compress: [
      'none',
      'zlib@openssh.com',
      'zlib'
    ]
  },
  accesslog: false,
  verify: false,
  // safeShutdownDuration: 300
  safeShutdownDuration: 3
}

// test if config.json exists, if not provide error message but try to run
// anyway
try {
  if (fs.existsSync(configPath)) {
    console.log('ephemeral_auth service reading config from: ' + configPath)
    config = require('read-config-ng')(configPath)
  } else {
    console.error('\n\nERROR: Missing config.json for webssh. Current config: ' + JSON.stringify(config))
    console.error('\n  See config.json.sample for details\n\n')
  }
} catch (err) {
  console.error('\n\nERROR: Missing config.json for webssh. Current config: ' + JSON.stringify(config))
  console.error('\n  See config.json.sample for details\n\n')
  console.error('ERROR:\n\n  ' + err)
}

var session = require('express-session')({
  secret: config.session.secret,
  name: config.session.name,
  resave: true,
  saveUninitialized: false,
  unset: 'destroy'
})
var app = express()
var server = require('http').Server(app)
var myutil = require('./util')
myutil.setDefaultCredentials(config.user.name, config.user.password, config.user.privatekey)
var validator = require('validator')
var io = require('socket.io')(server, { serveClient: false, path: '/ssh/socket.io' })
var socket = require('./socket')
var expressOptions = require('./expressOptions')
var favicon = require('serve-favicon');

// express
app.use(cors({
  origin: true,
  credentials: true,
}))
app.use(safeShutdownGuard)
app.use(session)
app.use(myutil.basicAuth)
if (config.accesslog) app.use(logger('common'))
app.disable('x-powered-by')

// // favicon from root if being pre-fetched by browser to prevent a 404
// app.use(favicon(path.join(publicPath,'favicon.ico')));

apiRouter.get('/ssh/reauth', function (req, res, next) {
  var r = req.headers.referer || '/'
  res.status(401).send('<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=' + r + '"></head><body bgcolor="#000"></body></html>')
})

apiRouter.get('/ping', function(req, res, next) {
  // XXX Add checking of credentials here.
  res.status(200).send('OK');
});

// eslint-disable-next-line complexity
apiRouter.get('/ssh/host/:host?', function (req, res, next) {
  debugWebSSH2('APP setting session variables: %O %O', req.params, req.query);
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

  res.status(200).send('OK')
})

app.use('/console/api', apiRouter);

// express error handling
app.use(function (req, res, next) {
  res.status(404).send("Sorry can't find that!")
})

app.use(function (err, req, res, next) {
  console.error(err.stack)
  res.status(500).send('Something broke!')
})

// socket.io
// expose express session with socket.request.session
io.use(function (socket, next) {
  (socket.request.res) ? session(socket.request, socket.request.res, next)
    : next(next)
})

// bring up socket
io.on('connection', socket)

// safe shutdown
var shutdownMode = false
var shutdownInterval = 0
var connectionCount = 0

function safeShutdownGuard (req, res, next) {
  if (shutdownMode) res.status(503).end('Service unavailable: Server shutting down')
  else return next()
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
  if (shutdownMode) stop('Safe shutdown aborted, force quitting')
  else if (connectionCount > 0) {
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
  } else stop()
}))

// clean stop
function stop (reason) {
  shutdownMode = false
  if (reason) console.log('Stopping: ' + reason)
  if (shutdownInterval) clearInterval(shutdownInterval)
  io.close()
  server.close()
}

module.exports = { server: server, config: config }