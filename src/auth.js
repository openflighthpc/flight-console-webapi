'use strict'
/* jshint esversion: 6, asi: true, node: true */
// util.js

// private
require('colors') // allow for color property extensions in log messages
const debug = require('debug')('flight:console')
const jwt = require('jsonwebtoken')

exports.flight_auth = function(shared_secret, sso_cookie_name) {
  return function (req, res, next) {
    var decoded;
    var token = '';
    var cookie = req.cookies[sso_cookie_name];
    var authHeader = req.headers.authorization
    var credentials = {};
    if (cookie) {
      token = cookie;
    } else if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7, authHeader.length);
    }

    try {
      decoded = jwt.verify(token, shared_secret);
      if (decoded.username) {
        credentials.username = decoded.username;
        credentials.invalid = false;
        credentials.forbidden = false;
      } else {
        debug("Credentials do not include an username");
        credentials.invalid = true;
        credentials.forbidden = true;
      }
    } catch(err) {
      debug("Could not verify credentials: " + err.message)
      if (err.message == 'invalid signature') {
        credentials.forbidden = true
        credentials.invalid = true
      } else {
        credentials.forbidden = false
        credentials.invalid = true
      }
    }
    debug("Credentials: " + JSON.stringify(credentials))

    if (credentials.forbidden) {
      res.statusCode = 403
      debug("forbidden request (403)");
      res.end("You do not have permission to access this resource!")
      return
    } else if (credentials.invalid) {
      res.statusCode = 401
      debug("invalid credentials (401)")
      res.end("Could not verify your authentication credentials. Please check them an try again.")
      return
    } else {
      req.session.username = credentials.username
      req.session.userpassword = 'foobar'
    }

    next()
  }
}
