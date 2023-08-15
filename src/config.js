'use strict'

const fs = require('fs');
const path = require('path')

const nodeRoot = path.dirname(require.main.filename)
const configPath = path.join(nodeRoot, '..', 'etc', 'config.json')

// Sane defaults if config.json is missing.
const defaultConfig = {
  listen: {
    ip: '0.0.0.0',
    port: 6312
  },
  ruby: '/opt/flight/bin/ruby',
  pidfile: null,
  ssh: {
    hosts: [
      { host: null, port: 22 }
    ],
    private_key_path: path.join(configPath, '..', 'flight_console_api_key'),
    public_key_path: path.join(configPath, '..', 'flight_console_api_key.pub'),
    term: 'xterm-color',
    readyTimeout: 20000,
    keepaliveInterval: 120000,
    keepaliveCountMax: 10,
    allowedSubnets: []
  },
  sso: {
    cookie_name: 'flight_login',
    shared_secret_path: path.join(configPath, '..', 'shared-secret.conf')
  },
  session: {
    name: 'WebSSH2',
    secret: 'mysecret'
  },
  options: {
  },
  algorithms: {
    kex: [
      'ecdh-sha2-nistp256',
      'ecdh-sha2-nistp384',
      'ecdh-sha2-nistp521',
      'diffie-hellman-group-exchange-sha256',
      'diffie-hellman-group14-sha1'
    ],
    cipher: [
      'aes128-ctr',
      'aes192-ctr',
      'aes256-ctr',
      'aes128-gcm',
      'aes128-gcm@openssh.com',
      'aes256-gcm',
      'aes256-gcm@openssh.com',
      'aes256-cbc'
    ],
    hmac: [
      'hmac-sha2-256',
      'hmac-sha2-512',
      'hmac-sha1'
    ],
    compress: [
      'none',
      'zlib@openssh.com',
      'zlib'
    ]
  },
  accesslog: false,
  verify: false,
  // safeShutdownDuration: 300
  safeShutdownDuration: 3
}

let config;
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      console.log('Reading config from: ' + configPath);
      config = require('read-config-ng')(configPath)
    } else {
      config = defaultConfig;
      console.error(
        '\n\nERROR: Missing config ' + configPath +
        ' Using default config: ' + JSON.stringify(config)
      );
      console.error('\n  See config.json.sample for details\n\n')
    }
  } catch (err) {
    config = defaultConfig;
    console.error(
      '\n\nERROR: Missing config ' + configPath +
      ' Using default config: ' + JSON.stringify(config)
    );
    console.error('\n  See config.json.sample for details\n\n')
    console.error('ERROR:\n\n  ' + err)
  }
}

loadConfig();
module.exports = { config: config };
