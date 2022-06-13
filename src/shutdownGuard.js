'use strict'

class ShutdownGuard {
  constructor(io, server, safeShutdownDuration) {
    this.io = io;
    this.server = server;
    this.safeShutdownDuration = safeShutdownDuration;
    this.connectionCount = 0;
    this.isShuttingDown = false;
    this.sockets = {};
  }

  onConnection(socket) {
    this.sockets[socket.id] = socket;
    this.connectionCount++;
  }

  onDisconnection(socket) {
    delete this.sockets[socket.id];
    this.connectionCount--;
    if ((this.connectionCount <= 0) && this.isShuttingDown) {
      this.stop('All clients disconnected')
    }
  }

  shutdown() {
    if (this.isShuttingDown) {
      this.stop('Safe shutdown aborted, force quitting');
    } else if (this.connectionCount > 0) {
      this.safeShutdown();
    } else {
      this.stop();
    }
  }

  safeShutdown() {
    var remainingSeconds = this.safeShutdownDuration;
    this.isShuttingDown = true;

    var message = (this.connectionCount === 1) ? ' client is still connected'
      : ' clients are still connected'
    console.error(this.connectionCount + message)
    console.error('Starting a ' + remainingSeconds + ' seconds countdown')
    console.error('Press Ctrl+C again to force quit')

    const that = this;
    this.shutdownInterval = setInterval(function () {
      if ((remainingSeconds--) <= 0) {
        that.stop('Countdown is over');
      } else {
        that.io.sockets.emit('shutdownCountdownUpdate', remainingSeconds)
      }
    }, 1000)
  }

  stop(reason) {
    if (reason) console.log('Stopping: ' + reason)
    if (this.shutdownInterval) {
      clearInterval(this.shutdownInterval);
    }

    Object.values(this.sockets).forEach((socket) => {
      socket.disconnect(true);
    });

    this.io.close();
    this.server.close();
    process.exit(0);
  }
}

module.exports = ShutdownGuard;
