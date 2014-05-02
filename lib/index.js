/**
 *
 * An implementation of  connect session with Mongoose.
 * It also supports passport authentication automatically.
 *
 * Specified https://github.com/senchalabs/connect/blob/master/lib/middleware/session/store.js
 */

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
  var dbURI = 'mongodb://' + dbConfig.host
    + ':' + dbConfig.port + '/' + dbConfig.db;


  Mongoose.connection.on('connected', function () {
    util.log('Mongoose connected to ' + dbURI);
  });

  Mongoose.connection.on('error', function (error) {
    util.log('Mongoose connected error ' + error);
  });

  Mongoose.connection.on('disconnected', function () {
    util.log('Mongoose disconnected');
  });

  process.on('SIGINT', function () {
    Mongoose.connection.close(function () {
      util.log('Mongoose disconnected through app termination');
      process.exit(0);
    });
  });

  Mongoose.connect(dbURI);

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


module.exports = function (connect) {

  var Store = connect.session.Store,
    maxAge,
    autoRemoveExpiredSession,
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
   * @param {Function} next
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
      port: options.port || 27017,
      db: options.db || 'sessionStore'
    };
    _initialize(dbConfig);
    Session        =  Mongoose.model('Session', sessionSchema);
    SessionHistory =  Mongoose.model('SessionHistory', sessionHistroySchema);
  };

  /**
   * Attempt to fetch session by the given `sid`.
   * @param {String} sid
   * @param {Function} next
   * @api public
   */
  SessionStore.prototype.get = function (sid, next) {
    var self = this;
    self._findSessions(sid, function (err, session) {
      try {
        if (session) {
          if (!session.expires || new Date() < session.expires) {
            if (session.session.passport && session.session.passport.user) {
              session.session.user = session.session.passport.user;
            }
            session.session.sid = sid;
            var sessData = self._unserialize_session(session.session);
            next && next(null, sessData);
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
    Session.findOne({_id: sid}, function (err, session) {
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
    var param = {expires: {$lt: new Date()}};
    this.addToHistory(param, function (err) {
      Session.remove(param, function (err) {
        if (err) {
          util.log(util.inspect(err));
        }
      });
    });
  }

  /**
   * Add to history
   * @param sid
   * @param next
   */
  SessionStore.prototype.addToHistory = function (criteria, next) {
    Session.find(criteria, function (err, sessionDataArr) {
      if (err) {
        next && next(err);
      }
      else if (sessionDataArr) {
        var fns = [];
        sessionDataArr.forEach(function(sessionData){
          fns.push(function(callback){
            var sessionHistory = new SessionHistory(sessionData.toObject());
            sessionHistory.save(function (err) {
              if (err) {
                util.log(util.inspect(err));
              }
              // dont want to break any features passing error as null always.
              callback(null);
            })
          });
        });
        async.parallel(fns, function(err1, result){
          next(err1);
        });
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
      var validSession = false,
        self = this;
      if (session.user) {
        validSession = true;
      } else if (session && session.passport && session.passport.user) {
        validSession = true;
      }
      if (!validSession) {
        next();
      } else {

        // removing functions
        var sessionToStore = _removeFunctionsFromObject(session);
        if (sessionToStore &&  sessionToStore.cookie && (typeof sessionToStore.cookie.toJSON === "function")) {
          sessionToStore.cookie = sessionToStore.cookie.toJSON();
        }
        var s = {_id: sid, session: self._serialize_session(sessionToStore)};
        if (maxAge > session.cookie.originalMaxAge) {
          util.log("Session store max age should be lower than the session cookie max age. Authentication failed.");
          next({message: "Session store max age should be lower than the session cookie max age. Authentication failed." });
          return;
        }

        s.expires = new Date(new Date().valueOf() + maxAge);

        Session.findById(sid, function (err, storedSession) {
          if (err) {
            next && next(err);
          } else if (storedSession) {
            storedSession.set("session", s.session);
            storedSession.markModified("session");
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
      }

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
    this.addToHistory({_id: sid }, function(err){
      Session.remove({ _id: sid }, function (err) {
        next(err);
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