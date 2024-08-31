import express from 'express';

const AppController = require('../controllers/AppController');

const route = express.Router();

route.get('/status', AppController.getStatus);
route.get('/stats', AppController.getStats);

module.exports = route;
