// Tiny observable key-value state store.
// Exposed as FM.state on window.

window.FM = window.FM || {};

(function () {
  "use strict";

  // Internal storage
  const _store = {
    activeYear:    null,  // Currently selected year (number | null)
    activePoint:   null,  // [lat, lon] the user clicked (Array | null)
    activeRadius:  1000,  // Radius in metres for summary queries
    compareYears:  [],    // [yearA, yearB] for split-view comparison
    activePanel:   null   // Which side-panel is open (string | null)
  };

  // Listener registry: { [key]: Set<function> }
  const _listeners = {};

  const state = {
    /**
     * Returns the current value of a state key.
     * @param {string} key
     */
    get(key) {
      return _store[key];
    },

    /**
     * Updates a state key and fires all registered callbacks for it.
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
      _store[key] = value;
      if (_listeners[key]) {
        _listeners[key].forEach(function (cb) {
          try {
            cb(value, key);
          } catch (err) {
            console.error("[FM.state] callback error for key", key, err);
          }
        });
      }
    },

    /**
     * Registers a callback that fires whenever the given key changes.
     * Returns an unsubscribe function.
     * @param {string} key
     * @param {function} callback - Called with (newValue, key)
     * @returns {function} unsubscribe
     */
    on(key, callback) {
      if (!_listeners[key]) {
        _listeners[key] = new Set();
      }
      _listeners[key].add(callback);
      return function unsubscribe() {
        _listeners[key].delete(callback);
      };
    }
  };

  FM.state = state;
})();
