'use strict'

const util = require('util')
const SSH = require('ssh2').Client;
const debug = require('debug');
const debugSFTP = debug('flight:console:sftp');
const debugSSH = debug('ssh2');
const async = require('async');

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
      async.waterfall([
        // Establish the SFTP connection
        function(cb) {
          debugSFTP("Starting SFTP check")
          conn.sftp((err, sftp) => {
            if (err) {
              cb(err, null);
            } else {
              debugSFTP('Established SFTP client')
              cb(null, sftp);
            }
          })
        },

        // Determine the PWD
        function(sftp, cb) {
          debugSFTP("Determining PWD");
          sftp.realpath('.', (err, path) => {
            if (err) {
              cb(err);
            } else {
              session.ssh.pwd = path;
              debug('Determined PWD: ' + path)
              cb(null, sftp);
            }
          });
        },

        // Resolve the unverified_dir to an absolute path
        function(sftp, cb) {
          if (session.unverified_dir) {
            debugSFTP("Resolving: " + session.unverified_dir);
            sftp.realpath(session.unverified_dir, (err, dir) => {
              if (err) {
                cb(err);
              } else {
                debugSFTP("Resolved: " + dir);
                cb(null, sftp, dir);
              }
            });
          } else {
            // Trigger the next callback without a dir
            cb(null, sftp, null)
          }
        },

        // Check if the directory exists
        function(sftp, dir, cb) {
          if (dir) {
            debugSFTP("Checking Directory Exists: " + dir);
            sftp.stat(dir, (err, stat) => {
              if (err && err.message == "No such file") {
                cb(new Error("?dir:Missing Directory"));
              } else if (err) {
                cb(err)
              } else if (stat.permissions >= 0o40000 && stat.permissions < 0o50000) {
                // Checks the permissions to ensure it is a directory
                debugSFTP("Directory Exists: " + dir)
                cb(null, sftp, dir)
              } else {
                debugSFTP("Path is not a directory! " + stat.permissions.toString(8))
                cb(new Error("?dir:Not A Directory"))
              }
            });
          } else {
            cb(null, sftp, null);
          }
        },

        // Check the user can open the directory
        function(sftp, dir, cb) {
          if (dir) {
            debugSFTP("Checking Directory Permissions: " + dir);
            sftp.opendir(dir, (err, _) => {
              if (err) {
                cb(new Error("?dir:Permission Denied"))
              } else {
                session.ssh.cwd = dir;
                debugSFTP("Checked Directory Permissions")
                cb(null)
              }
            });
          } else {
            cb(null)
          }
        }
      ],

        // Final Callback, handle errors and close the connection
        function(err) {
          conn.end()
          if (err) {
            // Handle unexpected errors
            debugSFTP("The following error occurred during SFTP checks:");
            debugSFTP(err);

            // Ensure the SFTP variables are unset
            session.ssh.pwd = null;
            session.ssh.cwd = null;

            // Pass control back to the caller
            reject(err);
          } else {
            // Pass control back to the caller
            resolve();
          }
        }
      )
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
