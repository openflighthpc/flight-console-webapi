'use strict'

const debug = require('debug')('flight:console:HostChecker')
const dns = require('dns');
const util = require('util');

const dnsLookup = util.promisify(dns.lookup);

// If configured, check that the requsted host is in a permitted subnet.
class HostChecker {
  constructor(host, allowedSubnets) {
    this.host = host;
    this.allowedSubnets = allowedSubnets || [];
  }

  async isAllowed() {
    if (this.allowedSubnets.length < 1) {
      // Allowed subnets is not configured, so we allow everything.
      return true
    }

    const hostIp = (await dnsLookup(this.host)).address;
    debug(
      "Validating host matches allowedSubnets: host=%s IP=%s allowedSubnets=%O",
      this.host, hostIp, this.allowedSubnets,
    );
    const matcher = new CIDRMatcher(this.allowedSubnets)
    const allowed = matcher.contains(hostIp);
    return allowed;
  }
}

module.exports = HostChecker;
