import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const backendTarget = process.env.ISUKA_API_URL || 'http://localhost:3000';

export default defineConfig({
  plugins: [{
    name: 'isuka-land-crops-route',
    configureServer(server) {
      server.middlewares.use('/dashboard/land-crops/', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'land-crops.html')).pipe(response);
      });
      server.middlewares.use('/dashboard/climate-risk/', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'climate-risk.html')).pipe(response);
      });
      server.middlewares.use('/dashboard/inputs-practices/', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'inputs-practices.html')).pipe(response);
      });
      server.middlewares.use('/dashboard/district-explorer/', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'district-explorer.html')).pipe(response);
      });
      server.middlewares.use('/dashboard/forecasting/analysis/', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'forecasting-analysis.html')).pipe(response);
      });
      server.middlewares.use('/dashboard/forecasting/', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'forecasting.html')).pipe(response);
      });
      server.middlewares.use('/dashboard/loss-planner/', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'loss-planner.html')).pipe(response);
      });
      server.middlewares.use('/account/signup', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'account-signup.html')).pipe(response);
      });
      server.middlewares.use('/account/login', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'account-login.html')).pipe(response);
      });
      server.middlewares.use('/account/setup', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'account-setup.html')).pipe(response);
      });
      server.middlewares.use('/account/dashboard', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'account-dashboard.html')).pipe(response);
      });
      server.middlewares.use('/admin/login', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'admin-login.html')).pipe(response);
      });
      server.middlewares.use('/admin/upload', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'admin-upload.html')).pipe(response);
      });
      server.middlewares.use('/admin/datasets', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'admin-datasets.html')).pipe(response);
      });
      server.middlewares.use('/admin/reports', (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'admin-reports.html')).pipe(response);
      });
      server.middlewares.use('/admin', (request, response, next) => {
        if (request.method !== 'GET') return next();
        if (request.url && request.url !== '/admin' && request.url !== '/admin/') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, 'admin-dashboard.html')).pipe(response);
      });
      const accountPages = { '/account/my-farm': 'account-my-farm.html', '/account/assistant': 'account-assistant.html', '/account/alerts': 'account-alerts.html', '/account/settings': 'account-settings.html' };
      Object.entries(accountPages).forEach(([route, file]) => server.middlewares.use(route, (request, response, next) => {
        if (request.method !== 'GET') return next();
        response.setHeader('Content-Type', 'text/html');
        fs.createReadStream(path.resolve(__dirname, file)).pipe(response);
      }));
    }
  }],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true
      },
      '/www': {
        target: backendTarget,
        changeOrigin: true
      },
      '/assets': {
        target: backendTarget,
        changeOrigin: true
      }
    }
  }
});
