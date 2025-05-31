/**
 * CryptoPulse Pro - Advanced Cryptocurrency Analysis Tool
 * Version: 2.1.0
 * 
 * Features:
 * - Real-time market analysis
 * - AI-powered insights
 * - Cross-platform compatibility
 * - Advanced error handling
 * - Performance monitoring
 */

// Strict mode for better error handling
'use strict';

// Configuration Manager
class Config {
  static get API_BASE_URL() {
    return process.env.API_BASE_URL || 'https://api.cryptopulsepro.com/v1';
  }

  static get ENDPOINTS() {
    return {
      ANALYSIS: '/analyze',
      MARKET_DATA: '/market',
      TRENDING: '/trending',
      HISTORICAL: '/historical'
    };
  }

  static get SETTINGS() {
    return {
      MAX_HISTORY: 7,
      DEBOUNCE_DELAY: 350,
      LOADING_MIN_DISPLAY: 500,
      API_TIMEOUT: 10000,
      CACHE_TTL: 300000 // 5 minutes
    };
  }

  static get STORAGE_KEYS() {
    return {
      THEME: 'cryptoPulseTheme',
      HISTORY: 'cryptoSearchHistory',
      SESSION: 'cryptoPulseSession',
      SETTINGS: 'cryptoPulseSettings'
    };
  }
}

// Analytics Manager
class Analytics {
  static track(eventName, payload = {}) {
    if (typeof window.ga === 'function') {
      window.ga('send', 'event', 'Interaction', eventName, JSON.stringify(payload));
    }
    console.debug(`[Analytics] ${eventName}`, payload);
  }

  static error(error, context = {}) {
    if (typeof window.ga === 'function') {
      window.ga('send', 'exception', {
        exDescription: `${error.message} (${context.component})`,
        exFatal: false
      });
    }
    console.error(`[Error] ${context.component}: ${error.message}`, error.stack, context);
  }
}

// Cache Manager
class AppCache {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
  }

  set(key, value, ttl = Config.SETTINGS.CACHE_TTL) {
    this.clearTimeout(key);
    this.cache.set(key, value);
    this.timers.set(key, setTimeout(() => this.delete(key), ttl));
  }

  get(key) {
    return this.cache.get(key);
  }

  delete(key) {
    this.clearTimeout(key);
    return this.cache.delete(key);
  }

  clearTimeout(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
  }
}

// Main Application Class
class CryptoPulsePro {
  constructor() {
    this.cache = new AppCache();
    this.initDOMReferences();
    this.initState();
    this.setupEventListeners();
    this.initServiceWorker();
    this.initPerformanceMonitoring();
  }

  // DOM References
  initDOMReferences() {
    this.dom = {
      searchInput: document.getElementById('cryptoSearch'),
      analyzeBtn: document.getElementById('analyzeBtn'),
      resultsArea: document.getElementById('resultsArea'),
      historyContainer: document.getElementById('historyContainer'),
      loadingIndicator: document.getElementById('loadingIndicator'),
      themeToggle: document.querySelector('.theme-toggle'),
      currentYear: document.getElementById('currentYear'),
      buildDate: document.getElementById('buildDate'),
      searchSuggestions: document.getElementById('searchSuggestions'),
      newsTicker: document.querySelector('.news-ticker .ticker-content')
    };
  }

  // Application State
  initState() {
    this.state = {
      currentAnalysis: null,
      searchHistory: this.loadHistory(),
      isLoading: false,
      theme: this.loadTheme(),
      lastSearch: null,
      sessionStart: new Date(),
      performanceMetrics: {
        loadTime: window.performance.timing.domContentLoadedEventEnd - 
                window.performance.timing.navigationStart,
        apiCalls: 0,
        errors: 0
      }
    };

    // Set initial UI state
    this.updateYear();
    this.updateBuildDate();
    document.documentElement.setAttribute('data-theme', this.state.theme);
    this.updateThemeIcon();
    this.renderHistory();
  }

  // Service Worker Registration
  async initServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        console.log('ServiceWorker registered:', registration.scope);
      } catch (error) {
        Analytics.error(error, { component: 'ServiceWorker' });
      }
    }
  }

  // Performance Monitoring
  initPerformanceMonitoring() {
    window.addEventListener('beforeunload', () => {
      Analytics.track('SessionEnd', {
        duration: new Date() - this.state.sessionStart,
        searches: this.state.searchHistory.length,
        ...this.state.performanceMetrics
      });
    });
  }

  // Event Listeners
  setupEventListeners() {
    // Theme toggle
    this.dom.themeToggle.addEventListener('click', () => this.toggleTheme());

    // Search button
    this.dom.analyzeBtn.addEventListener('click', () => 
      this.handleSearch(this.dom.searchInput.value.trim()));

    // Debounced search input
    this.dom.searchInput.addEventListener('input', this.debounce(() => {
      const query = this.dom.searchInput.value.trim();
      if (query.length > 1) {
        this.showSuggestions(query);
      } else {
        this.hideSuggestions();
      }
    }, Config.SETTINGS.DEBOUNCE_DELAY / 2));

    // Keyboard support
    this.dom.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleSearch(this.dom.searchInput.value.trim());
      }
    });

    // Window events
    window.addEventListener('online', this.handleConnectionChange.bind(this, true));
    window.addEventListener('offline', this.handleConnectionChange.bind(this, false));
  }

  // Utility Methods
  debounce(func, delay) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  }

  throttle(func, limit) {
    let lastFunc;
    let lastRan;
    return (...args) => {
      if (!lastRan) {
        func.apply(this, args);
        lastRan = Date.now();
      } else {
        clearTimeout(lastFunc);
        lastFunc = setTimeout(() => {
          if ((Date.now() - lastRan) >= limit) {
            func.apply(this, args);
            lastRan = Date.now();
          }
        }, limit - (Date.now() - lastRan));
      }
    };
  }

  // Data Methods
  async fetchWithRetry(endpoint, options = {}, retries = 3) {
    const url = `${Config.API_BASE_URL}${endpoint}`;
    this.state.performanceMetrics.apiCalls++;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), Config.SETTINGS.API_TIMEOUT);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Version': '2.1.0'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.fetchWithRetry(endpoint, options, retries - 1);
      }
      Analytics.error(error, { component: 'API', endpoint });
      throw new Error('Network request failed. Please check your connection.');
    }
  }

  // UI Methods
  setLoadingState(isLoading) {
    this.state.isLoading = isLoading;
    this.dom.loadingIndicator.hidden = !isLoading;
    this.dom.resultsArea.hidden = isLoading;

    if (isLoading) {
      const startTime = Date.now();
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / 2000 * 100, 90); // Cap at 90% until complete
        this.dom.loadingIndicator.querySelector('progress').value = progress;
      }, 100);

      this.loadingInterval = progressInterval;
    } else if (this.loadingInterval) {
      clearInterval(this.loadingInterval);
      this.dom.loadingIndicator.querySelector('progress').value = 100;
      setTimeout(() => {
        this.dom.loadingIndicator.querySelector('progress').value = 0;
      }, 300);
    }
  }

  // ... (rest of the methods follow the same pattern of improvement)

  // Initialization
  static init() {
    if (!window.cryptoPulseApp) {
      window.cryptoPulseApp = new CryptoPulsePro();
      document.dispatchEvent(new Event('cryptoPulseReady'));
    }
    return window.cryptoPulseApp;
  }
}

// Initialize the application when DOM is fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', CryptoPulsePro.init);
} else {
  CryptoPulsePro.init();
}

// Export for testing purposes
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CryptoPulsePro, Config, Analytics };
}