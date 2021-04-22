/* eslint-disable complexity */
'use strict'
/* jshint esversion: 6, asi: true, node: true */

const async = require('async');
const debug = require('debug')('flight:console')
const SSH = require('ssh2').Client
const CIDRMatcher = require('cidr-matcher')

const sshUtils = require('./sshUtils');

let termCols, termRows;

// If configured, check that the requsted host is in a permitted subnet.
function isHostAllowed(sshConfig) {
  const allowedSubnets = sshConfig.allowedSubnets || [];

  if (allowedSubnets.length < 1) {
    // Allowed subnets is not configured, so we allow everything.
    return true
  }

  const matcher = new CIDRMatcher(allowedSubnets)
  const allowed = matcher.contains(sshConfig.host);
  return allowed;
}

// public
module.exports = function socket (socket) {
  // If a websocket connection arrives without an express session, kill it.
  if (!socket.request.session) {
    socket.emit('401 UNAUTHORIZED')
    debug('SOCKET: No Express Session / REJECTED')
    socket.disconnect(true)
    return
  }

  const session = socket.request.session;
  const sshConfig = session.ssh || {};

  if (!isHostAllowed(sshConfig)) {
    console.log(
      'Flight console ' +
      'error: Requested host outside configured subnets / REJECTED'.red.bold +
      ' user=' + session.username.yellow.bold.underline +
      ' from=' + socket.handshake.address.yellow.bold.underline
    );
    socket.emit('ssherror', '401 UNAUTHORIZED');
    socket.disconnect(true);
    return
  }

  const conn = new SSH();
  socket.on('geometry', function socketOnGeometry (cols, rows) {
    termCols = cols;
    termRows = rows;
  });
  conn.on('banner', function connOnBanner (data) {
    // Need to convert to cr/lf for proper formatting.
    data = data.replace(/\r?\n/g, '\r\n');
    socket.emit('data', data.toString('utf-8'));
  })

  async.waterfall([
      // Wait until the connection is ready
      function(waterfall) {
        conn.on('ready', function connOnReady() {
          console.log(
            'Flight console Login:' +
            ' user=' + session.username +
            ' from=' + socket.handshake.address +
            ' host=' + sshConfig.host +
            ' port=' + sshConfig.port +
            ' sessionID=' + socket.request.sessionID + '/' + socket.id +
            ' mrhsession=' + sshConfig.mrhsession +
            ' dir=' + sshConfig.dir +
            ' term=' + sshConfig.term
          );
          socket.emit('status', 'SSH CONNECTION ESTABLISHED');

          waterfall(null, null);
        })
      },

      // Determine if the requested directory exists using SFTP
      function(_, waterfall) {
        if (sshConfig.dir) {
          conn.sftp(function(err, sftp) {
            if (err) {
              SSHError('EXEC ERROR' + err);
              waterfall(true, null);
            } else {
              sftp.opendir(sshConfig.dir, function(err, _buffer) {
                // Assumable the directory does not exist
                // TODO: Check permissions issues?
                if (err) {
                  debug("Requested directory: " + sshConfig.dir);
                  debug(err);
                  waterfall(null, null);

                // The directory does exist
                } else {
                  waterfall(null, sshConfig.dir);
                }
              })
            }
          });

        // Skip SFTP if the directory isn't given
        } else {
          waterfall(null, null);
        }
      },

      // Establish the SSH connection in a PTY
      function(working_dir, waterfall) {
        conn.shell({
          term: sshConfig.term,
          cols: termCols,
          rows: termRows
        }, function connShell (err, stream) {
          if (err) {
            SSHerror('EXEC ERROR' + err)
            conn.end();
            waterfall(true, null);
          }

          // Move to the given directory (if given)
          if (working_dir) {
            stream.write(`cd ${working_dir}\n`);
          }

          socket.on('data', function socketOnData (data) {
            stream.write(data)
          })

          socket.on('resize', function socketOnResize (data) {
            stream.setWindow(data.rows, data.cols)
          })

          socket.on('disconnecting', function socketOnDisconnecting (reason) {
            debug('SOCKET DISCONNECTING: ' + reason)
          })

          socket.on('disconnect', function socketOnDisconnect (reason) {
            debug('SOCKET DISCONNECT: ' + reason)
            err = { message: reason }
            SSHerror('CLIENT SOCKET DISCONNECT', err)
            conn.end()
            // socket.request.session.destroy()
          })

          socket.on('error', function socketOnError (err) {
            SSHerror('SOCKET ERROR', err)
            conn.end()
          })

          stream.on('data', function streamOnData (data) {
            socket.emit('data', data.toString('utf-8'));
          })

          stream.on('close', function streamOnClose (code, signal) {
            let messages = [];
            if (code)   { messages.push(`CODE: ${code}`); }
            if (signal) { messages.push(`SIGNAL: ${signal}`); }
            SSHerror('STREAM CLOSE', { message: messages.join(' ') })
            waterfall(true, null);
          })
        })
      }
    ],

    // Close the connection
    function(_, _a) { conn.end(); }
  )

  conn.on('end', function connOnEnd (err) {
    SSHerror('CONN END BY HOST', err);
  });

  conn.on('close', function connOnClose (err) {
    SSHerror('CONN CLOSE', err);
  });

  conn.on('error', function connOnError (err) {
    SSHerror('CONN ERROR', err);
  });

  conn.on('keyboard-interactive', function connOnKeyboardInteractive (name, instructions, instructionsLang, prompts, finish) {
    debug('conn.on(\'keyboard-interactive\')')
    finish([socket.request.session.userpassword])
  });

  if (session.username && sshConfig) {
    conn.connect(sshUtils.connectionOptions(session));
  } else {
    debug('Attempt to connect without session.username/password or session ' +
      'varialbles defined, potentially previously abandoned client session. ' +
      'disconnecting websocket client.\r\nHandshake information: \r\n  ' +
      JSON.stringify(socket.handshake)
    );
    socket.emit('ssherror', 'WEBSOCKET ERROR')
    socket.request.session.destroy()
    socket.disconnect(true)
  }

  /**
  * Error handling for various events. Outputs error to client, logs to
  * server, destroys session and disconnects socket.
  * @param {string} event  Stylised event
  * @param {object} err    error object or error message
  */
  // eslint-disable-next-line complexity
  function SSHerror (event, err) {
    let theError;
    if (session) {
      // We just want the first error of the session to pass to the client.
      session.error = session.error || (err ? err.message : undefined);
      theError = session.error ? ': ' + session.error : '';
      // log unsuccessful login attempt
      if (err && (err.level === 'client-authentication')) {
        console.log(
          'Flight console ' + 'error: Authentication failure'.red.bold +
          ' user=' + socket.request.session.username.yellow.bold.underline +
          ' from=' + socket.handshake.address.yellow.bold.underline
        );
        socket.emit('reauth')
      } else {
        console.log(
          'Flight console Logout:' +
          ' user=' + session.username +
          ' from=' + socket.handshake.address +
          ' host=' + sshConfig.host +
          ' port=' + sshConfig.port +
          ' sessionID=' + socket.request.sessionID + '/' + socket.id +
          ' term=' + sshConfig.term
        )
        if (err) {
          theError = (err) ? ': ' + err.message : ''
          console.log('Flight console error' + theError)
        }
      }
      socket.emit('ssherror', 'SSH ' + event + theError)
      session.destroy()
      socket.disconnect(true)
    } else {
      theError = (err) ? ': ' + err.message : ''
      socket.disconnect(true)
    }
    debug('SSHerror ' + event + theError)
  }
}
