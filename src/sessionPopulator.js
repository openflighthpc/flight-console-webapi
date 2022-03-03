'use strict'

const validator = require('validator');
const debug = require('debug')('flight:console');

// Populates the session from the request and server configuration.
class SessionPopulator {
  constructor(config, privateKey) {
    this.config = config;
    this.privateKey = privateKey;
  }

  populate(req) {
    debug('Populating session: params=%O query=%O', req.params, req.query);

    req.session.requestedDir = req.query.dir;
    req.session.ssh = {
      host: this.determineHost(req),
      port: this.determinePort(req),
      privateKey: this.privateKey,
      localAddress: this.config.ssh.localAddress,
      localPort: this.config.ssh.localPort,
      algorithms: this.config.algorithms,
      keepaliveInterval: this.config.ssh.keepaliveInterval,
      keepaliveCountMax: this.config.ssh.keepaliveCountMax,
      allowedSubnets: this.config.ssh.allowedSubnets,
      term: this.determineTerm(req),
      mrhsession: this.determineMrhsession(req),
      readyTimeout: this.determineReadyTimeout(req),
    };
    debug(
      'Populated session: requestedDir=%O ssh=%O',
      req.session.requestedDir,
      {...req.session.ssh, privateKey: "[REDACTED]"},
    );
  }

  determineHost(req) {
    const requested = req.params.host;
    if (requested && hostIsValid(requested)) {
      return requested;
    } else {
      return this.config.ssh.host;
    }
  }

  determinePort(req) {
    const requested = req.query.port;
    if (requested && validator.isInt(requested, {min: 1, max: 65535})) {
      return requested; 
    } else {
      return this.config.ssh.port;
    }
  }

  determineTerm(req) {
    const requested = req.query.sshterm;
    const regexp = /^(([a-z]|[A-Z]|[0-9]|[!^(){}\-_~])+)?\w$/;
    if (requested && regexp.test(requested) ) {
      return requested;
    } else {
      return this.config.ssh.term;
    }
  }

  determineMrhsession(req) {
    const requested = req.headers.mrhsession;
    if (requested && validator.isAlphanumeric(requested)) {
      return requested;
    } else {
      return "none";
    }
  }

  determineReadyTimeout(req) {
    const requested = req.query.readyTimeout;
    if (requested && validator.isInt(requested, { min: 1, max: 300000 })) {
      return requested;
    } else {
      return this.config.ssh.readyTimeout;
    }
  }

  hostIsValid(host) {
    return validator.isIP(host + '') ||
      validator.isFQDN(host + '') ||
      /^(([a-z]|[A-Z]|[0-9]|[!^(){}\-_~])+)?\w$/.test(host);
  }
}

module.exports = SessionPopulator;
