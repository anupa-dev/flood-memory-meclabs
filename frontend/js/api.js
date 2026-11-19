// Thin fetch wrapper for all backend endpoints.
// Exposed as FM.api on window.

window.FM = window.FM || {};

(function () {
  "use strict";

  /**
   * Wraps fetch; on network failure (fetch itself throws) it re-throws a
   * structured offline error so callers can show a friendly message.
   */
  async function request(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (_networkError) {
      throw {
        offline: true,
        message: "Can't reach the Flood Map server. Check that it's running on port 5000."
      };
    }
    return response;
  }

  const api = {
    /**
     * Initialises the API layer: fetches the index route, reads available
     * years and stores them in DATA_YEARS.
     */
    async init() {
      const res = await request(API_BASE + "/");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.years)) {
          DATA_YEARS = data.years;
        }
      }
      return DATA_YEARS;
    },

    /**
     * Returns GeoJSON of flood extents for the given year.
     * @param {number|string} year - Four-digit year
     */
    async floods(year) {
      const res = await request(`${API_BASE}/api/floods?year=${year}`);
      return res.json();
    },

    /**
     * Tries to fetch a pre-rendered PNG overlay for the given year.
     * Falls back to floods() GeoJSON on a 404 response.
     * @param {number|string} year - Four-digit year
     * @returns {{ type: 'png', url: string } | { type: 'geojson', data: object }}
     */
    async overlay(year) {
      const url = `${API_BASE}/api/overlays/${year}.png`;
      let res;
      try {
        res = await request(url);
      } catch (err) {
        throw err;
      }
      if (res.status === 404) {
        const data = await api.floods(year);
        return { type: "geojson", data };
      }
      return { type: "png", url };
    },

    /**
     * Returns GeoJSON of road network.
     */
    async roads() {
      const res = await request(`${API_BASE}/api/roads`);
      return res.json();
    },

    /**
     * Returns GeoJSON of waterways.
     */
    async waterways() {
      const res = await request(`${API_BASE}/api/waterways`);
      return res.json();
    },

    /**
     * Returns a summary report for a geographic point.
     * @param {number} lat
     * @param {number} lon
     * @param {number} radius - Metres
     */
    async summary(lat, lon, radius) {
      const res = await request(
        `${API_BASE}/api/summary?lat=${lat}&lon=${lon}&radius=${radius}`
      );
      const data = await res.json();
      if (!res.ok) {
        data.status = res.status;
      }
      return data;
    },

    /**
     * Returns community reports for the given year.
     * @param {number|string} year - Four-digit year
     */
    async reports(year) {
      const res = await request(`${API_BASE}/api/reports?year=${year}`);
      return res.json();
    },

    /**
     * Submits a new community report as multipart form data.
     * @param {FormData} formData
     */
    async submitReport(formData) {
      const res = await request(`${API_BASE}/api/reports`, {
        method: "POST",
        body: formData
      });
      return res.json();
    }
  };

  FM.api = api;
})();
