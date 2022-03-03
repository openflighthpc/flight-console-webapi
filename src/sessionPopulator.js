'use strict'

const validator = require('validator');
const debug = require('debug')('flight:console');

// Populates the session from the request and server configuration.
class SessionPopulator {
  constructor(req, config, privateKey) {
    this.req = req;
    this.config = config;
    this.privateKey = privateKey;
  }

  populate() {
    debug('Populating session: params=%O query=%O', this.req.params, this.req.query);

    this.req.session.requestedDir = this.req.query.dir;
    this.req.session.ssh = {
      host: this.determineHost(),
      port: this.determinePort(),
      privateKey: this.privateKey,
      localAddress: this.config.ssh.localAddress,
      localPort: this.config.ssh.localPort,
      algorithms: this.config.algorithms,
      keepaliveInterval: this.config.ssh.keepaliveInterval,
      keepaliveCountMax: this.config.ssh.keepaliveCountMax,
      allowedSubnets: this.config.ssh.allowedSubnets,
      term: this.determineTerm(),
      mrhsession: this.determineMrhsession(),
      readyTimeout: this.determineReadyTimeout(),
    };
    debug(
      'Populated session: requestedDir=%O ssh=%O',
      this.req.session.requestedDir,
      {...this.req.session.ssh, privateKey: "[REDACTED]"},
    );
  }

  determineHost() {
    const requested = this.req.params.host;
    if (requested && hostIsValid(requested)) {
      return requested;
    } else {
      return this.config.ssh.host;
    }
  }

  determinePort() {
    const requested = this.req.query.port;
    if (requested && validator.isInt(requested, {min: 1, max: 65535})) {
      return requested; 
    } else {
      return this.config.ssh.port;
    }
  }

  determineTerm() {
    const requested = this.req.query.sshterm;
    const regexp = /^(([a-z]|[A-Z]|[0-9]|[!^(){}\-_~])+)?\w$/;
    if (requested && regexp.test(requested) ) {
      return requested;
    } else {
      return this.config.ssh.term;
    }
  }

  determineMrhsession() {
    const requested = this.req.headers.mrhsession;
    if (requested && validator.isAlphanumeric(requested)) {
      return requested;
    } else {
      return "none";
    }
  }

  determineReadyTimeout() {
    const requested = this.req.query.readyTimeout;
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
