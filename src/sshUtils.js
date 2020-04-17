'use strict'

const SSH = require('ssh2').Client;
const debugSSH = require('debug')('ssh2');

exports.checkAuthentication = function checkAuthentication(session) {
  const result = new Promise((resolve, reject) => {
    let rejected = false;
    const conn = new SSH();

    conn.on('ready', () => {
      conn.end();
      resolve();
    });
    conn.on('error', reject);
    // XXX Duplicate connection options.
    const options = {
      ...connectionOptions(session),
      keepaliveInterval: 0,
      keepaliveCountMax: 0,
      tryKeyboard: false,
    };
    conn.connect(options);
  });

  return result;
}

function connectionOptions(session) {
  return {
    host: session.ssh.host,
    port: session.ssh.port,
    localAddress: session.ssh.localAddress,
    localPort: session.ssh.localPort,
    username: session.username,
    password: session.userpassword,
    privateKey: session.privatekey,
    tryKeyboard: true,
    algorithms: session.ssh.algorithms,
    readyTimeout: session.ssh.readyTimeout,
    keepaliveInterval: session.ssh.keepaliveInterval,
    keepaliveCountMax: session.ssh.keepaliveCountMax,
    debug: debugSSH,
  };
}
exports.connectionOptions = connectionOptions;
