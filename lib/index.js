/**
 *
 * An implementation of  connect session with Mongoose.
 * It also supports passport authentication automatically.
 *
 * Specified https://github.com/senchalabs/connect/blob/master/lib/middleware/session/store.js
 */

'use strict';

var url          = require('url'),
  util           = require("util"),
  Mongoose       = require('mongoose'),
  ObjectId       = Mongoose.Types.ObjectId,
  async          = require('async'),
  MongooseSchema = Mongoose.Schema;


/**
 * Create a default mongoose schema
 * @returns {MongooseSchema}
 * @private
 */
function  _getDefaultSessionSchema() {

  return new MongooseSchema({
    sid: {type : String, index: true },
    session: {
      type: MongooseSchema.Types.Mixed
    },
    dateLoggedIn : {
      type    : Date,
      default : new Date()
    },
    lastAccessTime: {
      type    : Date,
      default : new Date()
    },
    expires   : {
      type  : Date,
      index : true
    }
  });

}


function _getDefaultSessionHistorySchema() {
  return new MongooseSchema({
    sid: String,
    session: {
      type: MongooseSchema.Types.Mixed
    },
    dateLoggedIn: {
      type    : Date
    },
    dateLoggedOut: {
      type    : Date,
      default : new Date()
    }
  });
}

function _initialize (dbConfig) {

  var dbURI, dbConn;

  if (dbConfig.userName && dbConfig.password) {
    dbURI = 'mongodb://' + dbConfig.userName + ':' + dbConfig.password + '@' + dbConfig.host
    + ':' + dbConfig.port + '/' + dbConfig.db;
  } else {
    dbURI = 'mongodb://' + dbConfig.host
    + ':' + dbConfig.port + '/' + dbConfig.db;
  }

  function _connectToDB() {
    try {
      dbConn = Mongoose.connect(dbURI, {db: {safe: true}, server : { auto_reconnect: true} });
    } catch (ex) {
      util.log(util.inspect(ex));
    }
  }
  _connectToDB();

  Mongoose.connection.on('connected', function () {
    util.log('Session Store connected to ' + dbURI);
  });

  Mongoose.connection.on('error', function (error) {
    util.log('Session Store connected error ' + error);
    if (dbConn && dbConn.connection && dbConn.connection._readyState == 0){
      setTimeout(_connectToDB, 1000);
    }
  });

  Mongoose.connection.on('disconnected', function () {
    util.log('Session Store disconnected');
  });

  process.on('SIGINT', function () {
    Mongoose.connection.close(function () {
      util.log('Session Store disconnected through app termination');
      process.exit(0);
    });
  });
}

function _getSessionUser (session) {

  if (session && session.user) {
    return session.user;

  } else if (session && session.passport && session.passport.user) {
    return session.passport.user;
  } else
    return null;

}

/**
 *
 * @param session
 * @returns {*|Function|Function|Connection.user|Connection.user|string|Credentials.user|.auth.user|.auth.user|.auth.user|.auth.user|*|*|Function|Function|Connection.user|Connection.user|string|Credentials.user|.auth.user|.auth.user|.auth.user|.auth.user}
 * @private
 */
function _hasValidUserData (session) {
  return _getSessionUser(session) !== null;
}



function _removeFunctionsFromObject(obj) {
  var objToStore = {};
  if(typeof obj === "object") {
    var key;
    for (key in  obj) {
      if (typeof obj[key] !== "function") {
        objToStore[key] = obj[key];
      }
    }
  }
  return objToStore;
}


// parse and format cookie object
function _pasreCookies(sessionToStore) {
  if (sessionToStore && sessionToStore.cookie && (typeof sessionToStore.cookie.toJSON === "function")) {
    sessionToStore.cookie = sessionToStore.cookie.toJSON();
  }
  return sessionToStore;
}


module.exports = function (connect) {

  var Store = connect.session.Store,
    maxAge,
    Session,
    SessionHistory;

  function SessionStore(options, next) {
    var self = this;
    maxAge = options.maxAge || (60 * 60 * 1000);
    options = options || {};
    Store.call(this, options);
    self.setUpDB(options);
    self.initiateSessionSerialization(options);
  }

  /**
   * Inherit from `Connect.Store`.
   */
  util.inherits(SessionStore, Store);


  /**
   * serialization method is defined.
   *
   * {@param {object} sid,{}}
   * @api public
   */
  SessionStore.prototype.initiateSessionSerialization = function (options) {
    if (options.hasOwnProperty('stringify') ? options.stringify : false) {
      this._serialize_session = JSON.stringify;
      this._unserialize_session = JSON.parse;
    } else {
      this._serialize_session = function (x) {
        return x;
      };
      this._unserialize_session = function (x) {
        return x;
      };
    }
  };


  /**
   * Database Setup
   * @param {Object} options
   * @param {Function} void
   * @api private
   */
  SessionStore.prototype.setUpDB = function (options) {
    var sessionSchema          = options.schema        || _getDefaultSessionSchema();
    var sessionHistroySchema   = options.historySchema || _getDefaultSessionHistorySchema();
    var dbConfig = { host: options.host || '127.0.0.1',
      port      : options.port || 27017,
      db        : options.db || 'sessionStore',
      userName  : options.userName,
      password  : options.password
    };
    _initialize(dbConfig);
    Session        = this.sessionModel        = options.sessionModel || Mongoose.model('Session', sessionSchema);
    SessionHistory = this.sessionHistoryModel = options.sessionHistoryModel || Mongoose.model('SessionHistory', sessionHistroySchema);
  };

  /**
   * Attempt to fetch session by the given `sid`.
   * @param {String} sid
   * @param {Function} next
   * @api public
   */
  SessionStore.prototype.get = function (sid, next) {

    var self = this;
    self._findSessions(sid, function (err, sessionData) {
      try {
        if (sessionData) {
          if (!sessionData.expires || new Date() < sessionData.expires) {
            sessionData.session.user = _getSessionUser(sessionData);
            sessionData.session.sid    = sid;
            next && next(null, self._unserialize_session(sessionData.session));
          } else {
            self.destroy(sid, next);
          }
        } else {
          next && next();
        }
      } catch (e) {
        util.log(util.inspect(e));
        next && next(e);
      }
    });
  };


  /**
   * Attempt to find session by the given `sid`.
   *
   * @param {Object} {sid}
   * @param {Function} next
   * @api private
   */
  SessionStore.prototype._findSessions = function (sid, next) {
    var self = this;
    Session.findOne({sid : sid}, function (err, session) {
      next && next(err, session);
    });
  };

  /**
   * Attempt to fetch session by the given `sid`.and set immediately
   *
   * @param {Object} {sid}
   * @param {Function} next
   * @api public
   */
  SessionStore.prototype.getAndReset = function (sid, next) {
    var self = this;
    self.get(sid, function (err, sessData) {
      if (sessData) {
        self.set(sid, sessData);
      }
    });
  };


  /**
   * Clear expired sessions
   * @constructor
   */
  SessionStore.prototype.clearExpiredSessions = function () {
    var me = this;
    Session.where('expires').lt(new Date()).exec(function (err, sessionData) {
      if (err) {
        util.log(util.inspect(err));
      } else {
        me.addSessionHistoryData(sessionData, function (err1) {
          if (err1) {
            util.log(util.inspect(err1));
          }
          sessionData.forEach(function (session) {
            session.remove();
          });
        });
      }
    });
  }

  /**
   *  Archiving the session data which has a valid user data.
   *
   * @param sessionDataArr - List of session db objects from mongoose.
   * @param next
   */
  SessionStore.prototype.addSessionHistoryData = function (sessionDataArr, next) {
    var fns = [];
    sessionDataArr.forEach(function (sessionData) {
      var session = sessionData.toObject();
      fns.push(function (callback) {
        var sessionHistory = new SessionHistory(session);
        if (sessionHistory._id) {
          sessionHistory._id = null;
        }
        sessionHistory.save(function (err, newData) {
          if (err) {
            util.log(util.inspect(err));
          }
          // dont want to break any features passing error as null always.
          callback(null);
        })
      });
    });
    async.parallel(fns, function (err1, result) {
      if (err1) {
        util.log(util.inspect(err1));
      }
      next && next(err1);
    });
  }

  /**
   * Add to history
   * @param sid
   * @param next
   */
  SessionStore.prototype.addToHistory = function (criteria, next) {
    var me = this;
    Session.find(criteria, function (err, sessionDataArr) {
      if (err) {
        next && next(err);
      }
      else if (sessionDataArr) {
        me.addSessionHistoryData(sessionDataArr, next);
      }
    });
  }

  /**
   * Save the given `sess` object associated with the given `sid`.
   *
   * @param {String} sid
   * @param {Session} session obj
   * @param {Function} next
   * @api public
   */
  SessionStore.prototype.set = function (sid, session, next) {

    try {
      // removing functions
      var self = this, sessionToStore = _removeFunctionsFromObject(session);
      sessionToStore = _pasreCookies(sessionToStore);
      var s = { sid: sid, session: self._serialize_session(sessionToStore)};
      if (maxAge > session.cookie.originalMaxAge) {
        util.log("Session store max age should be lower than the session cookie max age. Authentication failed.");
        next({message: "Session store max age should be lower than the session cookie max age. Authentication failed." });
        return;
      }
      s.expires = new Date(new Date().valueOf() + maxAge);
      Session.findOne({sid: sid} , function (err, storedSession) {
        if (err) {
          next && next(err);
        } else if (storedSession) {
          // if we need to work with sensitive session data and don't want to  modify the session data without a reason. then pass forceUpdate  = false
          if (s.session && s.session.forceUpdate && s.session.forceUpdate === true) {
            delete s.session.forceUpdate;
            storedSession.set("session", s.session);
            storedSession.markModified("session");
          }
          storedSession.set("lastAccessTime", new Date());
          storedSession.set("expires", s.expires);
          storedSession.save(function(err){
            next && next(err);
          });

        } else {
          var session = new Session(s);
          session.save(function (err) {
            next && next(err);
          });
        }
        process.nextTick(function () {
          self.clearExpiredSessions();
        });
      });

    } catch (err) {
      next && next(err);
    }
  };

  /**
   * Destroy the session associated with the given `sid`.
   *
   * @param {String} sid
   * @param {Function} next
   * @api public
   */
  SessionStore.prototype.destroy = function (sid, next) {
    this.addToHistory({sid : sid }, function(err){
      Session.remove({ sid : sid }, function (err) {
        next && next(err);
      });
    });
  };

  /**
   * Find number of sessions.
   *
   * @param {Function} next
   * @api public
   */
  SessionStore.prototype.length = function (next) {
    Session().count({}, function (err, count) {
      if (err) {
        next && next(err);
      } else {
        next && next(null, count);
      }
    });
  };

  /**
   * Clear all sessions.
   *
   * @param {Function} next
   * @api public
   */
  SessionStore.prototype.clear = function (next) {
    this.addToHistory({}, function(err){
      if(err){
        util.log(util.inspect(err));
      }
      Session.drop(function () {
        next && next();
      });
    });
  };

  return SessionStore;
};