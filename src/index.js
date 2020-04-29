'use strict'
/* jshint esversion: 6, asi: true, node: true */
/*
 * index.js
 *
 * WebSSH2 - Web to SSH2 gateway
 * Bill Church - https://github.com/billchurch/WebSSH2 - May 2017
 *
 */

const npid = require('./pid');
var config = require('./app').config
var server = require('./app').server

var pid = npid.create(config.pidfile);
pid.removeOnExit();

process.on('uncaughtException', function(err) {
    console.log('Caught exception: ' + err);
    process.exit(1);
});

server.listen({ host: config.listen.ip, port: config.listen.port })

console.log('Flight Console listening on ' + config.listen.ip + ':' + config.listen.port)

server.on('error', function (err) {
  if (err.code === 'EADDRINUSE') {
    config.listen.port++
    console.warn('Flight Console Address in use, retrying on port ' + config.listen.port)
    setTimeout(function () {
      server.listen(config.listen.port)
    }, 250)
  } else {
    console.log('Flight Console server.listen ERROR: ' + err.code)
  }
})
