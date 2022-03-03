'use strict'

const validator = require('validator');
const debug = require('debug')('flight:console');

class RoundRobinHostConfig {
  constructor(hosts) {
    this.hosts = hosts;
    this.idx = -1;
  }

  advance() {
    if (this.idx > this.hosts.length - 1) {
      this.idx = -1;
    }
    this.idx++;
  }

  get() {
    const hostConfig = this.hosts[this.idx];
    debug('Round robin to host idx=%d config=%O', this.idx, hostConfig);
    return hostConfig;
  }
}

// Populates the session from the request and server configuration.
class SessionPopulator {
  static roundRobin = null;

  constructor(config, privateKey) {
    this.config = config;
    this.privateKey = privateKey;
    this.constructor.roundRobin = this.constructor.roundRobin ||
      new RoundRobinHostConfig(config.ssh.hosts);
    this.roundRobin = this.constructor.roundRobin;
  }

  populate(req) {
    debug('Populating session: params=%O query=%O', req.params, req.query);

    req.session.requestedDir = req.query.dir;
    req.session.ssh = {
      ...this.determineHostAndPort(req),
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

  determineHostAndPort(req) {
    const requestedHost = req.params.host;
    if (requestedHost && this.hostIsValid(requestedHost)) {
      const hostConfig = this.config.ssh.hosts.find(hc => hc.host === requestedHost);
      return hostConfig || {host: requestedHost, port: null};
    } else {
      this.roundRobin.advance();
      return this.roundRobin.get();
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
