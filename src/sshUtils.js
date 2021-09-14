'use strict'

const util = require('util')
const SSH = require('ssh2').Client;
const debugSSH = require('debug')('ssh2');

function checkAuthentication(session) {
  const result = new Promise((resolve, reject) => {
    let rejected = false;
    const conn = new SSH();

    const close_connection = (error) => {
      debugSSH(error);
      conn.end();
      reject(error);
    }

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          close_connection(err);
        } else {
          sftp.realpath('.', (err, path) => {
            if (err) {
              close_connection(err);
            } else {
              session.ssh.pwd = path;
              conn.end();
              resolve();
            }
          })
        }
      })
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
