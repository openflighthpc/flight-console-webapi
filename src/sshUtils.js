'use strict'

const util = require('util')
const SSH = require('ssh2').Client;
const debug = require('debug');
const debugSSH = debug('ssh2');
const async = require('async');

const DirectoryChecker = require('./directoryChecker');

function checkAuthentication(session) {
  const result = new Promise((resolve, reject) => {
    let rejected = false;
    const conn = new SSH();

    const close_connection = (error) => {
      debugSSH(error);
      conn.end();
      reject(error);
    }

    const checker = new DirectoryChecker(conn, session.requestedDir);
    conn.on('ready', () => {
      debug('SSH connection ready. Checking directory.');
      checker.checkDirectory((err, pwd, cwd) => {
          conn.end()
          if (err) {
            // Handle unexpected errors
            debug("The following error occurred checking the requested directory:");
            debug(err);
            reject(err);
          } else {
            session.ssh.pwd = pwd;
            session.ssh.cwd = cwd;
            resolve();
          }
      });
    });

    conn.on('error', reject);
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
    privateKey: session.ssh.privateKey,
    tryKeyboard: true,
    algorithms: session.ssh.algorithms,
    readyTimeout: session.ssh.readyTimeout,
    keepaliveInterval: session.ssh.keepaliveInterval,
    keepaliveCountMax: session.ssh.keepaliveCountMax,
    debug: debugSSH,
  };
}

module.exports = {
  checkAuthentication: checkAuthentication,
  connectionOptions: connectionOptions,
};
