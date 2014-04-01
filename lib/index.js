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
    expires: {
      type: Date,
      index: true
    }
  });

}

function _initialize (dbConfig) {
  var dbURI = 'mongodb://' + dbConfig.host
    + ':' + dbConfig.port + '/' + dbConfig.db;

  Mongoose.connect(dbURI);

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
    Session;

  function SessionStore(options, next) {
    var self = this;
    maxAge = options.maxAge || (60 * 60 * 1000);
    autoRemoveExpiredSession = (typeof options.autoRemoveExpiredSession !== 'undefined') ? options.autoRemoveExpiredSession : false;
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
    var server;
    //defining the database collection name.
    var sessionSchema   = options.schema || _getDefaultSessionSchema();
    var dbConfig = { host: options.host || '127.0.0.1',
      port: options.port || 27017,
      db: options.db || 'mongo-session-store'
    };

    _initialize(dbConfig);

    Session =  Mongoose.model('Session', sessionSchema);
  };

  /**
   * Attempt to fetch session by the given `sid`.
   * @param {String} sid
   * @param {Function} next
   * @api public
   */
  SessionStore.prototype.get = function (sid, next) {

    util.log("Getting from the session");
    
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
            next(null, sessData);
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
   * Save the given `sess` object associated with the given `sid`.
   *
   * @param {String} sid
   * @param {Session} session obj
   * @param {Function} next
   * @api public
   */
  SessionStore.prototype.set = function (sid, session, next) {
    util.log("Setting in the session");

    try {
      var validSession = false,
        self = this;
      if (session.user) {
        validSession = true;
      } else if (session.passport && session.passport.user) {
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
        var session = new Session(s);
        Session.findByIdAndUpdate(sid, { session: s.session, expires: s.expires  },{ upsert: true }, function (err, savedSession) {
          next(err);
          if (autoRemoveExpiredSession === true) {
            Session.remove({expires: {$lt: new Date()}}, function (err) {
              if (err) {
                util.log(util.inspect(err));
              }
            });
          }
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
    Session.remove({ _id: sid }, function (err) {
      next(err);
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
    Session.drop(function () {
      next && next();
    });
  };

  return SessionStore;
};