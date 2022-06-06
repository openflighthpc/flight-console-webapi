'use strict'

const SSH = require('ssh2').Client
const async = require('async');
const debug = require('debug')('flight:console:SshSession')

const sshUtils = require('./sshUtils');
const HostChecker = require('./hostChecker');

// Manages a SSH session; creates the SSH connection; creates the SSH shell
// configures the socket, connection and stream appropriately.
class SshSession {
  constructor(socket) {
    this.initialCols = 80;
    this.initialRows = 24;
    this.socket = socket;
    this.session = this.socket.request.session;
    const sshConfig = this.sshConfig = this.session.ssh || {};
    this.hostChecker = new HostChecker(sshConfig.host, sshConfig.allowedSubnets);
  }

  // Return true if the request passes the pre flight checks.
  async preFlightChecks() {
    debug('Running preflight checks');
    return this.ensureSanity() && await this.isHostAllowed();
  }

  ensureSanity() {
    if (this.socket == null) {
      debug('No socket configured: ABORTED');
      return false;
    } else if (this.socket.request.session == null) {
      this.socket.emit('401 UNAUTHORIZED');
      debug('No Express Session: REJECTED');
      this.socket.disconnect(true);
      return false;
    }
    return true;
  }

  // If configured, check that the requsted host is permitted.
  async isHostAllowed() {
    const hostChecker = this.hostChecker;
    if (! (await (hostChecker.isAllowed()))) {
      console.log(
        'Flight console ' +
        'error: Requested host outside configured subnets: REJECTED'.red.bold +
        ' user=' + this.session.username.yellow.bold.underline +
        ' from=' + this.socket.handshake.address.yellow.bold.underline
      );
      this.socket.emit('ssherror', '401 UNAUTHORIZED');
      this.socket.disconnect(true);
      return false;
    }
    return true;
  }

  connect() {
    debug('Initializing new SSH connection');
    this.configureSocket();
    this.createSshConnection();

    if (this.session.username && this.sshConfig) {
      this.conn.connect(sshUtils.connectionOptions(this.session));
    } else {
      debug('Attempt to connect without session.username/password or session ' +
        'varialbles defined, potentially previously abandoned client session. ' +
        'disconnecting websocket client.\r\nHandshake information: \r\n  ' +
        JSON.stringify(this.socket.handshake)
      );
      this.terminateSession('WEBSOCKET ERROR');
    }

  }

  // Terminate the session and teardown all connections.
  terminateSession(message, prefix="") {
    this.socket.emit('ssherror', prefix + message);
    this.session.destroy();
    this.socket.disconnect(true);
    debug(message);
  }

  logLogin() {
    debug(
      'Login: user=%s from=%s host=%s port=%s sessionID=%s mrhsession=%s dir=%s term=%s',
      this.session.username,
      this.socket.handshake.address,
      this.sshConfig.host,
      this.sshConfig.port,
      this.socket.request.sessionID + '/' + this.socket.id,
      this.sshConfig.mrhsession,
      this.sshConfig.dir,
      this.sshConfig.term,
    );
  }

  logLogout() {
    debug(
      'Logout: user=%s from=%s host=%s port=%s sessionID=%s term=%s',
      this.session.username,
      this.socket.handshake.address,
      this.sshConfig.host,
      this.sshConfig.port,
      this.socket.request.sessionID + '/' + this.socket.id,
      this.sshConfig.term,
    )
  }

  // Configure the browser<->self socket.
  //
  // Some configuration cannot be done until we have a stream to the SSH
  // shell, but what can be done here is done here.
  configureSocket() {
    const self = this;

    this.socket.on('geometry', function socketOnGeometry (cols, rows) {
      debug('geometry: cols=%d rows=%d', cols, rows);
      self.initialCols = cols;
      self.initialRows = rows;
    });

    this.socket.on('disconnecting', function socketOnDisconnecting (reason) {
      debug('SOCKET DISCONNECTING: ' + reason);
    })

    this.socket.on('disconnect', function socketOnDisconnect (reason) {
      const err = { message: reason };
      self.handleError('CLIENT SOCKET DISCONNECT', err);
    })

    this.socket.on('error', function socketOnError (err) {
      self.handleError('SOCKET ERROR', err);
    })
    this.socket.emit('status', 'SOCKET CONFIGURED');
  }

  // Create and configure the SSH client connection.
  //
  // Once ready, we create the SSH shell.
  createSshConnection() {
    const self = this;
    const conn = this.conn = new SSH();

    conn.on('banner', function connOnBanner (data) {
      // Need to convert to cr/lf for proper formatting.
      data = data.replace(/\r?\n/g, '\r\n');
      self.socket.emit('data', data.toString('utf-8'));
    })

    conn.on('end', function connOnEnd (err) {
      self.handleError('CONN END BY HOST', err);
    });

    conn.on('close', function connOnClose (err) {
      self.handleError('CONN CLOSE', err);
    });

    conn.on('error', function connOnError (err) {
      self.handleError('CONN ERROR', err);
    });

    conn.on('keyboard-interactive', function connOnKeyboardInteractive (name, instructions, instructionsLang, prompts, finish) {
      debug('conn.on(\'keyboard-interactive\')')
      finish([self.socket.request.session.userpassword])
    });

    conn.on('ready', function connOnReady() {
      self.logLogin();
      self.socket.emit('status', 'SSH CONNECTION ESTABLISHED');
      self.createShell();
    });
  }

  // Create the SSH shell and connect it to the browser<->self socket.
  createShell() {
    const self = this;
    const conn = this.conn;

    debug(
      'Initializing SSH session term=%s cols=%s rows=%s', 
      this.sshConfig.term,
      this.initialCols,
      this.initialRows
    );

    conn.shell({
      term: this.sshConfig.term,
      cols: this.initialCols,
      rows: this.initialRows
    }, function connShell (err, stream) {
      if (err) {
        self.handleError('EXEC ERROR', err)
        conn.end();
      }

      self.socket.on('resize', function socketOnResize (data) {
        debug('resize: cols=%d rows=%d', data.cols, data.rows);
        stream.setWindow(data.rows, data.cols);
      })

      // Move to the given directory (if given).
      if (self.session.ssh.cwd) {
        stream.write(`cd "${self.session.ssh.cwd}"\n`);
      }

      self.socket.on('data', function socketOnData (data) {
        stream.write(data)
      })

      stream.on('data', function streamOnData (data) {
        self.socket.emit('data', data.toString('utf-8'));
      })

      stream.on('close', function streamOnClose (code, signal) {
        let messages = [];
        if (code)   { messages.push(`CODE: ${code}`); }
        if (signal) { messages.push(`SIGNAL: ${signal}`); }
        self.handleError('STREAM CLOSE', { message: messages.join(' ') })
      })

      stream.stderr.on('data', function streamStderrOnData (data) {
        console.log('STDERR: ' + data)
      })

      self.socket.emit('status', 'SSH SHELL ESTABLISHED');
    })
  }

  /**
  * Error handling for various events. Outputs error to client, logs to
  * server, destroys session and disconnects socket.
  * @param {string} event  Stylised event
  * @param {object} err    error object or error message
  */
  // eslint-disable-next-line complexity
  handleError(event, err) {
    if (!this.session) {
      // We shouldn't ever get here, but let's handle it anyway.
      this.socket.disconnect(true);
      const errMessage = err ? ': ' + err.message : '';
      debug(event + errMessage);
      return;
    }

    if (this.session.error == null) {
      this.session.error = (err ? err.message : undefined);
    }
    let errMessage = this.session.error ? ': ' + this.session.error : '';

    if (err == null) {
      // This is odd.  We shouldn't ever get here, but let's handle it anyway.
      this.logLogout();
      this.terminateSession(event + errMessage, 'SSH ');

    } else if (err.level === 'client-authentication') {
      console.log(
        'Flight console ' + 'error: Authentication failure'.red.bold +
        ' user=' + this.socket.request.session.username.yellow.bold.underline +
        ' from=' + this.socket.handshake.address.yellow.bold.underline
      );
      this.socket.emit('reauth');
      this.terminateSession(event + errMessage, 'SSH ');

    } else {
      this.logLogout();
      errMessage = err ? ': ' + err.message : '';
      debug('error %s', errMessage);
      this.terminateSession(event + errMessage, 'SSH ');
    }
  }
}

module.exports = SshSession;
