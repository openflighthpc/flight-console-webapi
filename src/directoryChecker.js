'use strict'

const async = require('async');
const debug = require('debug')('flight:console:directoryChecker');

class DirectoryChecker {
  constructor(conn, requestedDir) {
    this.conn = conn;
    this.requestedDir = requestedDir;

    // The path that relative directories are expanded against.  This would
    // ideally be the user's home directory, but it is easier to use the
    // directory that the user's non-interactive shell ends up in.  These are
    // expected to be the same directory for almost all users.
    this.pwd = null;

    // The absolute path to the directory that has been requested.
    this.cwd = null;
  }

  checkDirectory(callback) {
    async.waterfall([
      this.establishSFTPConnection.bind(this),
      this.determinePWD.bind(this),
      this.resolveGivenDirectory.bind(this),
      this.checkDirExists.bind(this),
      this.checkPermissions.bind(this),
      this.returnDirectories.bind(this),
    ],
      callback
    );
  }

  establishSFTPConnection(cb) {
    debug("Starting directory check via SFTP");
    this.conn.sftp((err, sftp) => {
      if (err) {
        cb(err, null);
      } else {
        debug('Established SFTP client')
        cb(null, sftp);
      }
    })
  }


  // This will be used as the base directory from which relative paths are
  // expanded.
  //
  // It would perhaps be better to expand from the user's home directory, but
  // that would require determining the difference between a absolute and
  // relative path before running the call to CD.
  determinePWD(sftp, cb) {
    debug("Determining PWD");
    sftp.realpath('.', (err, path) => {
      if (err) {
        cb(err);
      } else {
        this.pwd = path;
        debug('Determined PWD: ' + path)
        cb(null, sftp);
      }
    });
  }

  resolveGivenDirectory(sftp, cb) {
    if (this.requestedDir && this.requestedDir.match(/^[0-9a-zA-Z_ u./-]*$/)) {
      debug("Resolving: " + this.requestedDir);
      sftp.realpath(this.requestedDir, (err, dir) => {
        if (err && err.message == "No such file") {
          cb(new Error("?dir:Missing Directory"));
        } else if (err) {
          cb(err);
        } else {
          debug("Resolved: " + dir);
          cb(null, sftp, dir);
        }
      });
    } else if (this.requestedDir) {
      debug("Invalid dir: " + this.requestedDir)
      cb(new Error("?dir:Invalid Characters"));
    } else {
      // Trigger the next callback without a dir
      cb(null, sftp, null)
    }
  }

  checkDirExists(sftp, dir, cb) {
    if (dir) {
      debug("Checking directory exists: " + dir);
      sftp.stat(dir, (err, stat) => {
        if (err && err.message == "No such file") {
          cb(new Error("?dir:Missing Directory"));
        } else if (err) {
          cb(err);
        } else if (stat.isDirectory()) {
          debug("Directory exists: " + dir);
          cb(null, sftp, dir);
        } else {
          debug("Path is not a directory.");
          cb(new Error("?dir:Not A Directory"));
        }
      });
    } else {
      cb(null, sftp, null);
    }
  }

  checkPermissions(sftp, dir, cb) {
    if (dir) {
      debug("Checking directory permissions: " + dir);
      sftp.opendir(dir, (err, _) => {
        if (err) {
          cb(new Error("?dir:Permission Denied"))
        } else {
          this.cwd = dir;
          debug("Checked directory permissions")
          cb(null)
        }
      });
    } else {
      cb(null)
    }
  }

  returnDirectories(cb) {
    cb(null, this.pwd, this.cwd);
  }
}

module.exports = DirectoryChecker;
